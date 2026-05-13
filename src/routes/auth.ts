import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { InviteStatus, UserRole } from '@prisma/client';
import { createAuthTokens, revokeRefreshToken, rotateRefreshToken } from '../services/mobileAuth.js';
import { ensureSalonServiceCategories } from '../services/salonCategorySetup.js';
import { ensureSalonAccessSeed } from '../services/accessControl.js';
import { activateInvite, hashPlainToken, validateInvite } from '../services/inviteService.js';
import { createPhoneVerification, verifyPhoneCode } from '../services/phoneVerification.js';
import { normalizeDigitsOnly } from '../services/phoneValidation.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

async function ensureIdentityAndMembershipFromLegacy(input: {
  salonUserId: number;
  salonId: number;
  email: string;
  phone?: string | null;
  passwordHash: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  role: string;
  secondaryRoles?: any;
  isActive: boolean;
  passwordResetRequired: boolean;
  lastLoginAt?: Date | null;
}) {
  const identity = await prisma.userIdentity.upsert({
    where: input.phone ? { phone: input.phone } : { email: input.email },
    update: {
      email: input.email || undefined,
      phone: input.phone || undefined,
      passwordHash: input.passwordHash,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
      displayName: input.displayName || undefined,
      isActive: input.isActive,
    },
    create: {
      email: input.email || null,
      phone: input.phone || null,
      passwordHash: input.passwordHash,
      firstName: input.firstName || null,
      lastName: input.lastName || null,
      displayName: input.displayName || null,
      isActive: input.isActive,
    },
  });

  const membership = await prisma.salonMembership.upsert({
    where: { salonId_identityId: { salonId: input.salonId, identityId: identity.id } },
    update: {
      role: input.role,
      secondaryRoles: input.secondaryRoles || null,
      isActive: input.isActive,
      passwordResetRequired: input.passwordResetRequired,
      lastLoginAt: input.lastLoginAt || null,
      legacySalonUserId: input.salonUserId,
    },
    create: {
      salonId: input.salonId,
      identityId: identity.id,
      role: input.role,
      secondaryRoles: input.secondaryRoles || null,
      isActive: input.isActive,
      passwordResetRequired: input.passwordResetRequired,
      lastLoginAt: input.lastLoginAt || null,
      legacySalonUserId: input.salonUserId,
    },
  });

  return { identity, membership };
}

router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes working' });
});

router.post('/test-post', (req, res) => {
  res.json({ message: 'POST routes working', body: req.body });
});

router.post('/register-salon', async (req: any, res: any) => {
  const { email, password, salonName } = req.body;

  if (!email || !password || !salonName) {
    throw new BusinessError('VALIDATION_FAILED', 'Email, password, and salonName are required.', 400);
  }

  try {
    const existingUser = await prisma.userIdentity.findFirst({ where: { email } });
    if (existingUser) {
      throw new BusinessError('CONFLICT', 'Bu email adresi ile zaten bir kullanici var.', 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const salon = await prisma.salon.create({ data: { name: salonName } });
    const legacyUser = await prisma.salonUser.create({
      data: {
        salonId: salon.id,
        email,
        passwordHash: hashedPassword,
        role: UserRole.OWNER,
        isActive: true,
      },
    });
    const identity = await prisma.userIdentity.create({
      data: {
        email,
        passwordHash: hashedPassword,
        isActive: true,
      },
    });
    const membership = await prisma.salonMembership.create({
      data: {
        salonId: salon.id,
        identityId: identity.id,
        role: UserRole.OWNER,
        isActive: true,
        legacySalonUserId: legacyUser.id,
      },
    });

    try {
      await ensureSalonServiceCategories(salon.id);
    } catch (categoryError) {
      console.error('Salon category bootstrap warning:', categoryError);
    }
    try {
      await ensureSalonAccessSeed(salon.id);
    } catch (accessSeedError) {
      console.error('Salon access seed warning:', accessSeedError);
    }

    const { accessToken, refreshToken } = await createAuthTokens({
      legacyUserId: legacyUser.id,
      membershipId: membership.id,
      identityId: identity.id,
      salonId: salon.id,
      role: membership.role as string,
    } as any);

    res.status(201).json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: { id: identity.id, email: identity.email, role: membership.role, salonId: salon.id, membershipId: membership.id },
    });
  } catch (error) {
    console.error('Salon registration error:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Sunucu hatasi.', 500);
  }
});

router.post('/login', async (req: any, res: any) => {
  const identifier = String(req.body?.identifier || req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    throw new BusinessError('VALIDATION_FAILED', 'identifier and password are required.', 400);
  }

  try {
    const normalizedEmail = identifier.toLowerCase();
    const normalizedPhone = normalizeDigitsOnly(identifier);
    const identity = await prisma.userIdentity.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])],
      },
      include: {
        memberships: {
          where: { isActive: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!identity) {
      throw new BusinessError('UNAUTHORIZED', 'Hatali giris bilgileri.', 401);
    }

    if (!identity.isActive) {
      throw new BusinessError('FORBIDDEN', 'User account is inactive.', 403);
    }
    const passwordOk = await bcrypt.compare(password, identity.passwordHash);
    if (!passwordOk) {
      throw new BusinessError('UNAUTHORIZED', 'Hatali giris bilgileri.', 401);
    }

    const memberships = identity.memberships;
    if (!memberships.length) {
      throw new BusinessError('FORBIDDEN', 'Aktif salon uyeligi bulunamadi.', 403);
    }

    if (memberships.length > 1 && !req.body?.salonId) {
      return res.status(200).json({
        requiresSalonSelection: true,
        salons: memberships.map((m) => ({
          salonId: m.salonId,
          role: m.role,
          email: identity.email || '',
          userId: m.legacySalonUserId || m.id,
          membershipId: m.id,
        })),
      });
    }

    const requestedSalonId = Number(req.body?.salonId || 0);
    const membership = requestedSalonId > 0 ? memberships.find((m) => m.salonId === requestedSalonId) || null : memberships[0];
    if (!membership) {
      throw new BusinessError('NOT_FOUND', 'Selected salon membership was not found.', 404);
    }

    let legacyUserId = membership.legacySalonUserId || 0;
    if (!legacyUserId) {
      const legacy = await prisma.salonUser.create({
        data: {
          salonId: membership.salonId,
          email: identity.email || `legacy-${identity.id}@kedy.local`,
          phone: identity.phone || null,
          passwordHash: identity.passwordHash,
          role: membership.role,
          secondaryRoles: membership.secondaryRoles || null,
          firstName: identity.firstName || null,
          lastName: identity.lastName || null,
          displayName: identity.displayName || null,
          isActive: membership.isActive,
          passwordResetRequired: membership.passwordResetRequired,
        },
      });
      legacyUserId = legacy.id;
      await prisma.salonMembership.update({
        where: { id: membership.id },
        data: { legacySalonUserId: legacy.id },
      });
    }

    const { accessToken, refreshToken } = await createAuthTokens({
      legacyUserId,
      identityId: identity.id,
      membershipId: membership.id,
      salonId: membership.salonId,
      role: membership.role as string,
    } as any);
    await ensureSalonAccessSeed(membership.salonId);

    return res.status(200).json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: {
        id: identity.id,
        membershipId: membership.id,
        email: identity.email,
        role: membership.role,
        salonId: membership.salonId,
        passwordResetRequired: membership.passwordResetRequired === true,
      },
      salons: memberships.map((m) => ({
        salonId: m.salonId,
        role: m.role,
        email: identity.email || '',
        userId: m.legacySalonUserId || m.id,
        membershipId: m.id,
      })),
    });
  } catch (error) {
    console.error('Login error:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Sunucu hatasi.', 500);
  }
});

router.post('/invites/validate', async (req: any, res: any) => {
  try {
    const payload = await validateInvite({ code: req.body?.code, token: req.body?.token });
    if (!payload) {
      throw new BusinessError('NOT_FOUND', 'Invite not found or expired.', 404);
    }
    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Invite validation failed.' });
  }
});

router.post('/invites/send-otp', async (req: any, res: any) => {
  try {
    const validated = await validateInvite({ code: req.body?.code, token: req.body?.token });
    if (!validated) {
      throw new BusinessError('NOT_FOUND', 'Invite not found or expired.', 404);
    }
    const phone = normalizeDigitsOnly(req.body?.phone || validated.user.phone || '');
    if (!phone) {
      throw new BusinessError('VALIDATION_FAILED', 'phone is required.', 400);
    }
    const verification = await createPhoneVerification({
      salonId: validated.salon.id,
      phone,
      countryIso: String(req.body?.countryIso || 'TR').trim().toUpperCase(),
      purpose: 'BOOKING_REGISTER',
      payload: { authFlow: 'invite_activation', inviteId: validated.inviteId },
      customerId: null,
    });
    return res.status(200).json({ verificationId: verification.id });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Unable to send OTP.' });
  }
});

router.post('/invites/verify-otp', async (req: any, res: any) => {
  const verificationId = String(req.body?.verificationId || '');
  const code = String(req.body?.code || '');
  if (!verificationId || !code) {
    throw new BusinessError('VALIDATION_FAILED', 'verificationId and code are required.', 400);
  }
  try {
    const verificationRef = await prisma.customerPhoneVerification.findUnique({
      where: { id: verificationId },
      select: { salonId: true },
    });
    if (!verificationRef) {
      throw new BusinessError('NOT_FOUND', 'Verification not found.', 404);
    }
    const verification = await verifyPhoneCode({ verificationId, salonId: verificationRef.salonId, code });
    return res.status(200).json({ verified: true, verificationId: verification.id });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'OTP verification failed.' });
  }
});

router.post('/invites/activate', async (req: any, res: any) => {
  try {
    const verificationId = String(req.body?.verificationId || '').trim();
    if (!verificationId) {
      throw new BusinessError('VALIDATION_FAILED', 'verificationId is required.', 400);
    }
    const verification = await prisma.customerPhoneVerification.findUnique({ where: { id: verificationId } });
    if (!verification || verification.status !== 'VERIFIED') {
      throw new BusinessError('VALIDATION_FAILED', 'Phone verification is required before activation.', 400);
    }

    const result = await activateInvite({
      code: req.body?.code,
      token: req.body?.token,
      password: req.body?.password,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      phone: req.body?.phone,
      email: req.body?.email,
    });
    const tokens = await createAuthTokens({
      legacyUserId: result.legacyUserId,
      identityId: result.identityId,
      membershipId: result.membershipId,
      salonId: result.salonId,
      role: result.role,
    } as any);
    return res.status(200).json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: result.identityId,
        membershipId: result.membershipId,
        email: result.email,
        role: result.role,
        salonId: result.salonId,
      },
    });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Invite activation failed.' });
  }
});

/**
 * POST /memberships/accept  (mounted at /auth and /api/auth)
 *
 * Authenticated counterpart to /invites/activate. Used by the multi-salon
 * switcher's "Mevcut Salona Katıl" flow when an already-logged-in user
 * pastes an 8-character invite code for another salon.
 *
 * Body: { code: string }
 *
 * Behavior:
 *  1) Look up the active Invite by hashed code.
 *  2) If invite.invitedMembership.identityId === current user identity →
 *     activate that membership (skip OTP, identity already verified).
 *  3) If invite.invitedMembership.identityId !== current user → 403 with
 *     a Turkish message that explains the user needs the right account.
 *  4) If invite has no pre-allocated identity (invitedMembershipId NULL),
 *     attach the caller's identity to a freshly-created SalonMembership
 *     in that salon, then activate.
 *  5) Mark the invite ACCEPTED.
 *
 * Response: { salon: { id, name, slug }, role, membershipId }
 */
router.post('/memberships/accept', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const identityId = Number(req.user.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Oturum bilgisi eksik.', 401);
  }

  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code || code.length < 4) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçerli bir davet kodu gerekli.', 400);
  }

  const codeHash = hashPlainToken(code);
  const invite = await prisma.invite.findFirst({
    where: { inviteCodeHash: codeHash },
    include: {
      salon: { select: { id: true, name: true, slug: true } },
      invitedMembership: {
        include: { identity: { select: { id: true, email: true, phone: true } } },
      },
    },
  });

  if (!invite) {
    throw new BusinessError('NOT_FOUND', 'Davet bulunamadı.', 404);
  }
  if (invite.status !== InviteStatus.PENDING) {
    // Treat already-accepted / revoked as not-found for safety.
    throw new BusinessError('NOT_FOUND', 'Davet artık geçerli değil.', 404);
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw new BusinessError('GONE', 'Davet süresi doldu.', 410);
  }

  const targetIdentityId = invite.invitedMembership?.identityId ?? null;
  if (targetIdentityId && targetIdentityId !== identityId) {
    throw new BusinessError(
      'FORBIDDEN',
      'Bu davet sana ait değil. Hesabını e-posta/telefonla ayrıştırman gerek.',
      403,
    );
  }

  // Resolve the salon-scoped identity helpers we'll need.
  const identity = await prisma.userIdentity.findUnique({
    where: { id: identityId },
    select: { id: true, email: true, phone: true, firstName: true, lastName: true, displayName: true, passwordHash: true, isActive: true },
  });
  if (!identity || !identity.isActive) {
    throw new BusinessError('FORBIDDEN', 'Kullanıcı oturumu geçersiz.', 403);
  }

  const result = await prisma.$transaction(async (tx) => {
    let membershipId: number;
    let role: string;

    if (invite.invitedMembership) {
      // CASE 1: invite is locked to this caller's identity.
      // Activate the pre-existing membership in-place. We don't touch the
      // identity itself (caller is already authenticated, password etc.
      // are already set on the identity from a previous registration).
      const updated = await tx.salonMembership.update({
        where: { id: invite.invitedMembership.id },
        data: {
          isActive: true,
          passwordResetRequired: false,
        },
      });

      // Ensure a legacy SalonUser exists, matching the pattern used in
      // /switch-salon and /invites/activate so downstream queries keep
      // working.
      let legacyUserId = updated.legacySalonUserId || 0;
      if (!legacyUserId) {
        const legacy = await tx.salonUser.create({
          data: {
            salonId: updated.salonId,
            email: identity.email || `legacy-${identity.id}@kedy.local`,
            phone: identity.phone || null,
            passwordHash: identity.passwordHash,
            firstName: identity.firstName || null,
            lastName: identity.lastName || null,
            displayName: identity.displayName || null,
            role: updated.role,
            secondaryRoles: updated.secondaryRoles || null,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
          },
        });
        legacyUserId = legacy.id;
        await tx.salonMembership.update({
          where: { id: updated.id },
          data: { legacySalonUserId: legacyUserId },
        });
      } else {
        await tx.salonUser.update({
          where: { id: legacyUserId },
          data: {
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
          },
        });
      }

      membershipId = updated.id;
      role = String(updated.role);
    } else {
      // CASE 2: open invite (no pre-allocated identity). Bind the caller's
      // identity to a new membership in the invite's salon. Default role
      // STAFF — owner-style memberships always come pre-allocated via
      // inviteService.createOwnerPendingProvisioning so we wouldn't hit
      // this branch for those.
      const newMembership = await tx.salonMembership.create({
        data: {
          salonId: invite.salonId,
          identityId,
          role: UserRole.STAFF,
          isActive: true,
          passwordResetRequired: false,
        },
      });

      const legacy = await tx.salonUser.create({
        data: {
          salonId: invite.salonId,
          email: identity.email || `legacy-${identity.id}@kedy.local`,
          phone: identity.phone || null,
          passwordHash: identity.passwordHash,
          firstName: identity.firstName || null,
          lastName: identity.lastName || null,
          displayName: identity.displayName || null,
          role: UserRole.STAFF,
          isActive: true,
          passwordResetRequired: false,
          activationCompletedAt: new Date(),
        },
      });

      await tx.salonMembership.update({
        where: { id: newMembership.id },
        data: { legacySalonUserId: legacy.id },
      });

      membershipId = newMembership.id;
      role = String(newMembership.role);
    }

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    return { membershipId, role };
  });

  return res.status(200).json({
    salon: {
      id: invite.salon.id,
      name: invite.salon.name,
      slug: invite.salon.slug,
    },
    role: result.role,
    membershipId: result.membershipId,
  });
});

router.post('/password/forgot/start', async (req: any, res: any) => {
  const phone = normalizeDigitsOnly(req.body?.phone || '');
  if (!phone) {
    throw new BusinessError('VALIDATION_FAILED', 'phone is required.', 400);
  }
  const identity = await prisma.userIdentity.findFirst({
    where: { phone, isActive: true },
    include: { memberships: { where: { isActive: true }, select: { id: true, salonId: true } } },
  });
  if (!identity || !identity.memberships.length) {
    throw new BusinessError('NOT_FOUND', 'User not found for phone.', 404);
  }
  try {
    const membership = identity.memberships[0];
    const verification = await createPhoneVerification({
      salonId: membership.salonId,
      phone,
      countryIso: String(req.body?.countryIso || 'TR').trim().toUpperCase(),
      purpose: 'BOOKING_REGISTER',
      payload: { authFlow: 'password_reset', identityId: identity.id },
      customerId: null,
    });
    return res.status(200).json({ verificationId: verification.id });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Unable to send verification code.' });
  }
});

router.post('/password/forgot/verify', async (req: any, res: any) => {
  try {
    const verificationId = String(req.body?.verificationId || '');
    const verificationRef = await prisma.customerPhoneVerification.findUnique({ where: { id: verificationId }, select: { salonId: true } });
    if (!verificationRef) {
      throw new BusinessError('NOT_FOUND', 'Verification not found.', 404);
    }
    const verification = await verifyPhoneCode({ verificationId, salonId: verificationRef.salonId, code: String(req.body?.code || '') });
    return res.status(200).json({ verified: true, verificationId: verification.id });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Verification failed.' });
  }
});

router.post('/password/forgot/complete', async (req: any, res: any) => {
  const verificationId = String(req.body?.verificationId || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!verificationId || newPassword.length < 8) {
    throw new BusinessError('VALIDATION_FAILED', 'verificationId and min 8-char newPassword are required.', 400);
  }
  const verification = await prisma.customerPhoneVerification.findUnique({ where: { id: verificationId } });
  if (!verification || verification.status !== 'VERIFIED') {
    throw new BusinessError('VALIDATION_FAILED', 'Verification is not completed.', 400);
  }
  const payload = (verification.payload || {}) as any;
  const identityId = Number(payload.identityId || 0);
  if (!identityId) {
    throw new BusinessError('VALIDATION_FAILED', 'Invalid verification payload.', 400);
  }
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.userIdentity.update({ where: { id: identityId }, data: { passwordHash: hashedPassword } });
  await prisma.salonMembership.updateMany({ where: { identityId }, data: { passwordResetRequired: false } });
  return res.status(200).json({ ok: true });
});

router.post('/refresh', async (req: any, res: any) => {
  const { refreshToken } = req.body || {};
  const startedAt = Date.now();

  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new BusinessError('VALIDATION_FAILED', 'refreshToken is required.', 400, { code: 'AUTH_RECOVERY_FAILED' });
  }

  try {
    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      console.warn(`[auth/refresh] rejected latencyMs=${Date.now() - startedAt} reason=invalid-refresh-token`);
      throw new BusinessError('UNAUTHORIZED', 'Invalid refresh token.', 401, { code: 'AUTH_RECOVERY_FAILED' });
    }
    if (!rotated.user.isActive) {
      console.warn(`[auth/refresh] rejected latencyMs=${Date.now() - startedAt} reason=user-inactive userId=${rotated.user.id}`);
      throw new BusinessError('FORBIDDEN', 'User account is inactive.', 403, { code: 'AUTH_RECOVERY_FAILED' });
    }

    console.info(`[auth/refresh] success latencyMs=${Date.now() - startedAt} userId=${rotated.user.id} salonId=${rotated.user.salonId}`);
    return res.status(200).json({
      token: rotated.accessToken,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        role: rotated.user.role,
        salonId: rotated.user.salonId,
        passwordResetRequired: rotated.user.passwordResetRequired === true,
      },
    });
  } catch (error) {
    console.error(`[auth/refresh] failed latencyMs=${Date.now() - startedAt} reason=exception`, error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error.', 500, { code: 'AUTH_RECOVERY_FAILED' });
  }
});

router.post('/logout', async (req: any, res: any) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new BusinessError('VALIDATION_FAILED', 'refreshToken is required.', 400);
  }

  try {
    await revokeRefreshToken(refreshToken);
    return res.status(204).send();
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
});

router.post('/switch-salon', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }

  const identityId = Number(req.user.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Oturum bilgisi eksik.', 401);
  }

  const requestedSalonId = Number(req.body?.salonId || 0);
  if (!Number.isInteger(requestedSalonId) || requestedSalonId <= 0) {
    throw new BusinessError('VALIDATION_FAILED', 'salonId pozitif tam sayi olmali.', 400);
  }

  try {
    const membership = await prisma.salonMembership.findUnique({
      where: { salonId_identityId: { salonId: requestedSalonId, identityId } },
      include: {
        salon: { select: { id: true, name: true, slug: true, logoUrl: true } },
        identity: { select: { id: true, email: true, phone: true, isActive: true, passwordHash: true } },
      },
    });

    if (!membership || !membership.isActive || !membership.identity?.isActive) {
      throw new BusinessError('FORBIDDEN', 'Bu salonda aktif uyeliginiz yok.', 403);
    }

    // Mirror the legacy SalonUser provisioning used in /login so we always
    // have a legacySalonUserId for the JWT payload and downstream queries.
    let legacyUserId = membership.legacySalonUserId || 0;
    if (!legacyUserId) {
      const legacy = await prisma.salonUser.create({
        data: {
          salonId: membership.salonId,
          email: membership.identity.email || `legacy-${membership.identity.id}@kedy.local`,
          phone: membership.identity.phone || null,
          passwordHash: membership.identity.passwordHash,
          role: membership.role,
          secondaryRoles: membership.secondaryRoles || null,
          isActive: membership.isActive,
          passwordResetRequired: membership.passwordResetRequired,
        },
      });
      legacyUserId = legacy.id;
      await prisma.salonMembership.update({
        where: { id: membership.id },
        data: { legacySalonUserId: legacy.id },
      });
    }

    // Revoke the caller's existing refresh sessions for the PREVIOUS salon
    // scope. MobileAuthSession rows are per-(membership, salon), so a switch
    // means the old session is no longer valid for this device's context.
    const previousMembershipId = Number(req.user.membershipId || 0);
    if (previousMembershipId && previousMembershipId !== membership.id) {
      await prisma.mobileAuthSession.updateMany({
        where: {
          membershipId: previousMembershipId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    const { accessToken, refreshToken } = await createAuthTokens({
      legacyUserId,
      identityId,
      membershipId: membership.id,
      salonId: membership.salonId,
      role: membership.role as string,
    } as any);
    await ensureSalonAccessSeed(membership.salonId);

    return res.status(200).json({
      accessToken,
      refreshToken,
      salon: {
        id: membership.salon.id,
        name: membership.salon.name,
        slug: membership.salon.slug,
        logoUrl: membership.salon.logoUrl,
      },
    });
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    console.error('Switch salon error:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Sunucu hatasi.', 500);
  }
});

/**
 * GET /memberships  (mounted at /auth and /api/auth)
 *
 * Returns every active SalonMembership for the calling identity so the
 * frontend salon switcher can render them. The user's currently-active
 * salon is included; the client picks it out via the access-token's salonId.
 *
 * Response shape: { memberships: [{ salonId, name, slug, logoUrl, role }] }
 */
router.get('/memberships', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }

  const identityId = Number(req.user.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Oturum bilgisi eksik.', 401);
  }

  const memberships = await prisma.salonMembership.findMany({
    where: { identityId, isActive: true },
    include: {
      salon: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
    orderBy: { id: 'asc' },
  });

  return res.status(200).json({
    memberships: memberships.map((m) => ({
      salonId: m.salon.id,
      name: m.salon.name,
      slug: m.salon.slug,
      logoUrl: m.salon.logoUrl,
      role: m.role,
    })),
  });
});

router.get('/me', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  try {
    const membership = await prisma.salonMembership.findUnique({
      where: { id: Number(req.user.membershipId || 0) },
      include: { identity: { select: { id: true, email: true, phone: true, displayName: true } } },
    });

    if (!membership) {
      throw new BusinessError('NOT_FOUND', 'User not found.', 404);
    }

    res.status(200).json({
      user: {
        id: membership.identity.id,
        membershipId: membership.id,
        email: membership.identity.email,
        phone: membership.identity.phone,
        displayName: membership.identity.displayName,
        role: membership.role,
        salonId: membership.salonId,
      },
    });
  } catch (error) {
    console.error('Get user info error:', error);
    throw error;
  }
});

export default router;
