import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { UserRole } from '@prisma/client';
import { createAuthTokens, revokeRefreshToken, rotateRefreshToken } from '../services/mobileAuth.js';
import { ensureSalonServiceCategories } from '../services/salonCategorySetup.js';
import { ensureSalonAccessSeed } from '../services/accessControl.js';
import { activateInvite, validateInvite } from '../services/inviteService.js';
import { createPhoneVerification, verifyPhoneCode } from '../services/phoneVerification.js';
import { normalizeDigitsOnly } from '../services/phoneValidation.js';

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
    return res.status(400).json({ message: 'Email, password, and salonName are required.' });
  }

  try {
    const existingUser = await prisma.userIdentity.findFirst({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'Bu email adresi ile zaten bir kullanici var.' });
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
    res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.post('/login', async (req: any, res: any) => {
  const identifier = String(req.body?.identifier || req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    return res.status(400).json({ message: 'identifier and password are required.' });
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
      return res.status(401).json({ message: 'Hatali giris bilgileri.' });
    }

    if (!identity.isActive) {
      return res.status(403).json({ message: 'User account is inactive.' });
    }
    const passwordOk = await bcrypt.compare(password, identity.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Hatali giris bilgileri.' });
    }

    const memberships = identity.memberships;
    if (!memberships.length) {
      return res.status(403).json({ message: 'Aktif salon uyeligi bulunamadi.' });
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
      return res.status(404).json({ message: 'Selected salon membership was not found.' });
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
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.post('/invites/validate', async (req: any, res: any) => {
  try {
    const payload = await validateInvite({ code: req.body?.code, token: req.body?.token });
    if (!payload) {
      return res.status(404).json({ message: 'Invite not found or expired.' });
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
      return res.status(404).json({ message: 'Invite not found or expired.' });
    }
    const phone = normalizeDigitsOnly(req.body?.phone || validated.user.phone || '');
    if (!phone) {
      return res.status(400).json({ message: 'phone is required.' });
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
    return res.status(400).json({ message: 'verificationId and code are required.' });
  }
  try {
    const verificationRef = await prisma.customerPhoneVerification.findUnique({
      where: { id: verificationId },
      select: { salonId: true },
    });
    if (!verificationRef) {
      return res.status(404).json({ message: 'Verification not found.' });
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
      return res.status(400).json({ message: 'verificationId is required.' });
    }
    const verification = await prisma.customerPhoneVerification.findUnique({ where: { id: verificationId } });
    if (!verification || verification.status !== 'VERIFIED') {
      return res.status(400).json({ message: 'Phone verification is required before activation.' });
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

router.post('/password/forgot/start', async (req: any, res: any) => {
  const phone = normalizeDigitsOnly(req.body?.phone || '');
  if (!phone) {
    return res.status(400).json({ message: 'phone is required.' });
  }
  const identity = await prisma.userIdentity.findFirst({
    where: { phone, isActive: true },
    include: { memberships: { where: { isActive: true }, select: { id: true, salonId: true } } },
  });
  if (!identity || !identity.memberships.length) {
    return res.status(404).json({ message: 'User not found for phone.' });
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
      return res.status(404).json({ message: 'Verification not found.' });
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
    return res.status(400).json({ message: 'verificationId and min 8-char newPassword are required.' });
  }
  const verification = await prisma.customerPhoneVerification.findUnique({ where: { id: verificationId } });
  if (!verification || verification.status !== 'VERIFIED') {
    return res.status(400).json({ message: 'Verification is not completed.' });
  }
  const payload = (verification.payload || {}) as any;
  const identityId = Number(payload.identityId || 0);
  if (!identityId) {
    return res.status(400).json({ message: 'Invalid verification payload.' });
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
    return res.status(400).json({ message: 'refreshToken is required.', code: 'AUTH_RECOVERY_FAILED' });
  }

  try {
    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      console.warn(`[auth/refresh] rejected latencyMs=${Date.now() - startedAt} reason=invalid-refresh-token`);
      return res.status(401).json({ message: 'Invalid refresh token.', code: 'AUTH_RECOVERY_FAILED' });
    }
    if (!rotated.user.isActive) {
      console.warn(`[auth/refresh] rejected latencyMs=${Date.now() - startedAt} reason=user-inactive userId=${rotated.user.id}`);
      return res.status(403).json({ message: 'User account is inactive.', code: 'AUTH_RECOVERY_FAILED' });
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
    return res.status(500).json({ message: 'Internal server error.', code: 'AUTH_RECOVERY_FAILED' });
  }
});

router.post('/logout', async (req: any, res: any) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ message: 'refreshToken is required.' });
  }

  try {
    await revokeRefreshToken(refreshToken);
    return res.status(204).send();
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/me', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }
  try {
    const membership = await prisma.salonMembership.findUnique({
      where: { id: Number(req.user.membershipId || 0) },
      include: { identity: { select: { id: true, email: true, phone: true, displayName: true } } },
    });

    if (!membership) {
      return res.status(404).json({ message: 'User not found.' });
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
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
