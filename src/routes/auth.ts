import { Router } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { prisma } from '../prisma.js';
import { authenticateToken, authenticateIdentity } from '../middleware/auth.js';
import { InviteStatus, UserRole } from '@prisma/client';
import { createAuthTokens, createIdentityTokens, revokeRefreshToken, rotateRefreshToken } from '../services/mobileAuth.js';
import { ensureSalonServiceCategories } from '../services/salonCategorySetup.js';
import { ensureSalonAccessSeed } from '../services/accessControl.js';
import { activateInvite, hashPlainToken, validateInvite, redeemInviteForIdentity } from '../services/inviteService.js';
import { startSetupPeriod } from '../services/onboarding/lifecycle.js';
import { createPhoneVerification, verifyPhoneCode } from '../services/phoneVerification.js';
import { normalizeDigitsOnly } from '../services/phoneValidation.js';
import { isR2Configured, uploadBufferToR2 } from '../lib/r2.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

const ONBOARDING_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ONBOARDING_PHOTO_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const onboardingPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ONBOARDING_PHOTO_MAX_BYTES },
});

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

// DEPRECATED — kept functional so old mobile app builds keep working
// through the rollout window. New flow: POST /api/auth/onboarding/start
// (no invite) → magic-link verify → POST /api/auth/onboarding/:id/activate
// (identity-only tokens) → POST /api/salons (creates salon, full tokens).
// Telemetry-friendly: emits a Deprecation header so we can spot which
// client builds still hit this endpoint.
router.post('/register-salon', async (req: any, res: any) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Fri, 19 Jun 2026 00:00:00 GMT');
  console.warn('[deprecated] POST /auth/register-salon used by client', {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
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
    // Stamp the new salon with the default acquisition offer and start
    // the 14-day setup clock. Failure here is non-fatal — the lifecycle
    // cron will reconcile next tick — but we log loudly so we notice
    // the funnel is broken in staging.
    try {
      await startSetupPeriod(salon.id);
    } catch (lifecycleError) {
      console.error('Salon setup period start warning:', lifecycleError);
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
    if (error instanceof BusinessError) throw error;
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
          include: {
            salon: { select: { id: true, name: true, slug: true, logoUrl: true } },
          },
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
    // Salonless identity: user registered via /kayit but hasn't joined
    // or opened a salon yet. Mint an identity-only token so the client
    // can land on /app/welcome and pick a path (open salon / redeem
    // invite). Mirrors what activateOnboarding returns for SELF_REGISTER.
    if (!memberships.length) {
      const tokens = await createIdentityTokens({ identityId: identity.id });
      return res.json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: identity.id,
          email: identity.email,
          salonId: null,
          membershipId: null,
          role: null,
        },
      });
    }

    if (memberships.length > 1 && !req.body?.salonId) {
      return res.status(200).json({
        requiresSalonSelection: true,
        salons: memberships.map((m: any) => ({
          salonId: m.salonId,
          salonName: m.salon?.name || `Salon #${m.salonId}`,
          salonSlug: m.salon?.slug || null,
          salonLogoUrl: m.salon?.logoUrl || null,
          role: m.role,
          email: identity.email || '',
          userId: m.legacySalonUserId || m.id,
          membershipId: m.id,
          lastLoginAt: m.lastLoginAt || null,
        })),
      });
    }

    const requestedSalonId = Number(req.body?.salonId || 0);
    // Tolerate stale lastSelectedSalonId in localStorage: if the
    // requested salon isn't one this identity is a member of, fall
    // through to the first available membership instead of 404'ing.
    // The salon-picker view (returned earlier when memberships > 1)
    // handles explicit salon selection; this branch is the cold-start
    // path where the client's hint just happens to be wrong.
    const membership =
      (requestedSalonId > 0 ? memberships.find((m) => m.salonId === requestedSalonId) : null) ||
      memberships[0];
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
    if (error instanceof BusinessError) throw error;
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

// ─────────────────────────────────────────────────────────────────
// New step-by-step onboarding (magic-link based).
//
// Replaces the all-at-once /invites/activate flow with a flow that
// collects (ad → soyad → cinsiyet → telefon → telefon doğrulama →
// email → email doğrulama → foto → şifre) in discrete steps, with
// magic-link verification for phone (kedyekip WhatsApp template) and
// email.
// ─────────────────────────────────────────────────────────────────
// Cheap availability check for the registration form. The UI calls
// this on blur of the email and phone fields so the user finds out
// "you already have an account" *while typing* instead of at the
// final activate step when their session has already burned its
// OTP budget. Returns booleans only — never leaks anything else
// about the existing identity.
router.post('/onboarding/check-identity', async (req: any, res: any) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const rawPhone = typeof req.body?.phone === 'string' ? normalizeDigitsOnly(req.body.phone) : '';
  const out: { emailTaken: boolean; phoneTaken: boolean } = {
    emailTaken: false,
    phoneTaken: false,
  };
  if (rawEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
    const hit = await prisma.userIdentity.findFirst({
      where: { email: rawEmail },
      select: { id: true },
    });
    out.emailTaken = Boolean(hit);
  }
  if (rawPhone && rawPhone.length >= 8) {
    const hit = await prisma.userIdentity.findFirst({
      where: { phone: rawPhone },
      select: { id: true },
    });
    out.phoneTaken = Boolean(hit);
  }
  return res.json(out);
});

router.post('/onboarding/start', async (req: any, res: any) => {
  try {
    const { startOnboarding } = await import('../services/onboardingService.js');
    const result = await startOnboarding({ code: req.body?.code, token: req.body?.token });
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Onboarding başlatılamadı.' });
  }
});

router.post('/onboarding/:sessionId/patch', async (req: any, res: any) => {
  try {
    const { patchOnboarding } = await import('../services/onboardingService.js');
    await patchOnboarding(String(req.params.sessionId), {
      firstName: typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : undefined,
      lastName: typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : undefined,
      gender:
        req.body?.gender === 'female' || req.body?.gender === 'male' || req.body?.gender === 'other'
          ? req.body.gender
          : undefined,
      photoUrl: typeof req.body?.photoUrl === 'string' ? req.body.photoUrl.trim() : undefined,
    });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Adım kaydedilemedi.' });
  }
});

router.post('/onboarding/:sessionId/send-phone-link', async (req: any, res: any) => {
  try {
    const { sendPhoneMagicLink } = await import('../services/onboardingService.js');
    await sendPhoneMagicLink({
      sessionId: String(req.params.sessionId),
      phone: String(req.body?.phone || ''),
    });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'WhatsApp doğrulama linki gönderilemedi.' });
  }
});

router.post('/onboarding/:sessionId/send-email-link', async (req: any, res: any) => {
  try {
    const { sendEmailMagicLink } = await import('../services/onboardingService.js');
    await sendEmailMagicLink({
      sessionId: String(req.params.sessionId),
      email: String(req.body?.email || ''),
    });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'E-posta doğrulama linki gönderilemedi.' });
  }
});

router.get('/onboarding/:sessionId/status', async (req: any, res: any) => {
  try {
    const { getOnboardingStatus } = await import('../services/onboardingService.js');
    const status = await getOnboardingStatus(String(req.params.sessionId));
    return res.status(200).json(status);
  } catch (error: any) {
    return res.status(404).json({ message: error?.message || 'Oturum bulunamadı.' });
  }
});

router.post(
  '/onboarding/:sessionId/photo',
  onboardingPhotoUpload.single('image'),
  async (req: any, res: any) => {
    const sessionId = String(req.params.sessionId);
    if (!isR2Configured()) {
      return res.status(503).json({ message: 'Foto depolama şu an kullanılabilir değil.' });
    }
    const file = req.file as Express.Multer.File | undefined;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({ message: 'image alanı gerekli.' });
    }
    const mime = (file.mimetype || '').toLowerCase();
    const normalized = mime === 'image/jpg' ? 'image/jpeg' : mime;
    if (!ONBOARDING_PHOTO_ALLOWED.has(normalized)) {
      return res.status(400).json({ message: 'Sadece JPEG, PNG veya WebP yükleyebilirsin.' });
    }
    try {
      const ext = normalized === 'image/png' ? 'png' : normalized === 'image/webp' ? 'webp' : 'jpg';
      const objectKey = `avatars/onboarding/${sessionId}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
      const publicUrl = await uploadBufferToR2({
        objectKey,
        body: file.buffer,
        contentType: normalized,
      });
      const { patchOnboarding } = await import('../services/onboardingService.js');
      await patchOnboarding(sessionId, { photoUrl: publicUrl });
      return res.status(200).json({ photoUrl: publicUrl });
    } catch (error: any) {
      console.error('Onboarding photo upload error:', error);
      return res.status(500).json({ message: 'Fotoğraf yüklenemedi.' });
    }
  },
);

router.post('/onboarding/:sessionId/activate', async (req: any, res: any) => {
  try {
    const { activateOnboarding } = await import('../services/onboardingService.js');
    const result = await activateOnboarding({
      sessionId: String(req.params.sessionId),
      password: String(req.body?.password || ''),
    });

    // Self-register: identity-only token (no salon yet). Client should
    // route to the "Salon Aç" / "Davete Katıl" empty dashboard.
    if (result.flow === 'SELF_REGISTER') {
      return res.status(200).json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: {
          id: result.identityId,
          email: result.email,
          salonId: null,
          membershipId: null,
          role: null,
        },
      });
    }

    // Legacy invite flow: full token with salon scope.
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
    return res.status(400).json({ message: error?.message || 'Aktivasyon başarısız.' });
  }
});

// Minimal identity bootstrap for salonless sessions.
//
// /api/mobile/bootstrap requires a full salon-scoped token. Identity-
// only tokens (issued by activateOnboarding SELF_REGISTER, or by
// /auth/login when an identity has no memberships) get rejected
// there. This endpoint returns just enough for the client to render
// the WelcomePage chooser without 401'ing the entire UI.
router.get('/me', authenticateIdentity, async (req: any, res: any) => {
  const identityId = Number(req.identity?.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);
  }
  const identity = await prisma.userIdentity.findUnique({
    where: { id: identityId },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      memberships: {
        where: { isActive: true },
        select: {
          id: true,
          role: true,
          salon: { select: { id: true, name: true, slug: true, logoUrl: true } },
        },
      },
    },
  });
  if (!identity) {
    throw new BusinessError('NOT_FOUND', 'Kimlik bulunamadı.', 404);
  }
  return res.json({
    user: {
      id: identity.id,
      email: identity.email,
      phone: identity.phone,
      firstName: identity.firstName,
      lastName: identity.lastName,
      displayName: identity.displayName,
    },
    memberships: identity.memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      salon: m.salon,
    })),
  });
});

// Self-serve identity profile edit. Lets a logged-in user (with or
// without a salon) update their own name + phone + email. Re-using
// /api/salon/* legacy patch endpoints isn't an option here because
// those expect a SalonUser row tied to a salonId — identity-only
// sessions don't have one.
//
// Email and phone changes invalidate the corresponding verifiedAt
// timestamps; downstream flows can re-issue a magic-link via
// /auth/onboarding/* if the user needs to re-verify. Skipping that
// re-verification step is deliberate scope cut — most edits are
// typo fixes, and we don't want to interrupt the flow with another
// OTP cycle. If we need to gate this later, the timestamps are the
// hook.
router.patch('/me/profile', authenticateIdentity, async (req: any, res: any) => {
  const identityId = Number(req.identity?.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);
  }
  const firstName =
    typeof req.body?.firstName === 'string' ? req.body.firstName.trim().slice(0, 80) : undefined;
  const lastName =
    typeof req.body?.lastName === 'string' ? req.body.lastName.trim().slice(0, 80) : undefined;
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;
  const rawPhone = typeof req.body?.phone === 'string' ? normalizeDigitsOnly(req.body.phone) : undefined;

  if (rawEmail !== undefined && rawEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz e-posta.', 400);
  }
  if (rawPhone !== undefined && rawPhone && rawPhone.length < 8) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz telefon.', 400);
  }

  // Block trying to claim somebody else's email/phone.
  if (rawEmail) {
    const taken = await prisma.userIdentity.findFirst({
      where: { email: rawEmail, id: { not: identityId } },
      select: { id: true },
    });
    if (taken) throw new BusinessError('CONFLICT', 'Bu e-posta başka bir hesapta kullanılıyor.', 409);
  }
  if (rawPhone) {
    const taken = await prisma.userIdentity.findFirst({
      where: { phone: rawPhone, id: { not: identityId } },
      select: { id: true },
    });
    if (taken) throw new BusinessError('CONFLICT', 'Bu telefon başka bir hesapta kullanılıyor.', 409);
  }

  const current = await prisma.userIdentity.findUnique({ where: { id: identityId } });
  if (!current) throw new BusinessError('NOT_FOUND', 'Kimlik bulunamadı.', 404);

  const data: any = {};
  if (firstName !== undefined) data.firstName = firstName || null;
  if (lastName !== undefined) data.lastName = lastName || null;
  if (firstName !== undefined || lastName !== undefined) {
    const f = firstName !== undefined ? firstName : current.firstName || '';
    const l = lastName !== undefined ? lastName : current.lastName || '';
    data.displayName = `${f} ${l}`.trim() || null;
  }
  if (rawEmail !== undefined && rawEmail !== current.email) {
    data.email = rawEmail || null;
    data.emailVerifiedAt = null;
  }
  if (rawPhone !== undefined && rawPhone !== current.phone) {
    data.phone = rawPhone || null;
    data.phoneVerifiedAt = null;
  }

  const updated = await prisma.userIdentity.update({
    where: { id: identityId },
    data,
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
    },
  });
  return res.json({ user: updated });
});

// Self-serve password change. Requires the old password so a
// stolen access token can't change creds on its own. Returns 200
// with no body on success — the client doesn't need to do
// anything else.
router.post('/me/password', authenticateIdentity, async (req: any, res: any) => {
  const identityId = Number(req.identity?.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);
  }
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) {
    throw new BusinessError('VALIDATION_FAILED', 'Yeni şifre en az 8 karakter olmalı.', 400);
  }
  const identity = await prisma.userIdentity.findUnique({ where: { id: identityId } });
  if (!identity) throw new BusinessError('NOT_FOUND', 'Kimlik bulunamadı.', 404);
  const ok = await bcrypt.compare(currentPassword, identity.passwordHash);
  if (!ok) throw new BusinessError('UNAUTHORIZED', 'Mevcut şifre hatalı.', 401);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.userIdentity.update({
    where: { id: identityId },
    data: { passwordHash },
  });
  // Mirror to any legacy SalonUser rows so logging in via legacy
  // (e.g. older mobile builds, password reset flows) keeps working.
  if (identity.email) {
    await prisma.salonUser.updateMany({
      where: { email: identity.email },
      data: { passwordHash },
    });
  }
  return res.json({ ok: true });
});

// Authenticated invite redemption.
//
// The new self-register flow: user already has a UserIdentity (no
// salon yet), they paste an 8-char invite code, and we attach them
// to the salon as STAFF/OWNER per the invite's pre-baked role. The
// response includes fresh salon-scoped tokens so the client can
// replace its identity-only token.
//
// Contrast with /invites/activate (legacy): that one accepted name +
// phone + email + password in the same payload and created the
// identity inline. Now the identity exists before the redemption, so
// we just bind the membership.
router.post('/invites/redeem', authenticateIdentity, async (req: any, res: any) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
  const token = typeof req.body?.token === 'string' ? req.body.token : undefined;
  const identityId = Number(req.identity?.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);
  }
  try {
    const result = await redeemInviteForIdentity({ code, token, identityId });
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
        salonId: result.salonId,
        role: result.role,
      },
    });
  } catch (error: any) {
    const msg = error?.message || 'Davet kullanılamadı.';
    const code =
      msg === 'INVITE_INVALID' || msg === 'INVITE_REQUIRED'
        ? 'NOT_FOUND'
        : msg === 'ALREADY_MEMBER'
          ? 'CONFLICT'
          : 'VALIDATION_FAILED';
    const status = code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 400;
    return res.status(status).json({ message: msg });
  }
});

router.post('/invites/send-email-otp', async (req: any, res: any) => {
  try {
    const validated = await validateInvite({ code: req.body?.code, token: req.body?.token });
    if (!validated) {
      throw new BusinessError('NOT_FOUND', 'Invite not found or expired.', 404);
    }
    const email = String(req.body?.email || validated.user.email || '').trim().toLowerCase();
    if (!email) {
      throw new BusinessError('VALIDATION_FAILED', 'email is required.', 400);
    }
    const { createEmailOtp } = await import('../services/emailOtpService.js');
    const verification = await createEmailOtp({
      email,
      salonId: validated.salon.id,
      purpose: 'INVITE_EMAIL',
      name: typeof req.body?.firstName === 'string' ? req.body.firstName : null,
    });
    return res.status(200).json({ emailVerificationId: verification.id });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Unable to send email OTP.' });
  }
});

router.post('/invites/verify-email-otp', async (req: any, res: any) => {
  try {
    const verificationId = String(req.body?.emailVerificationId || req.body?.verificationId || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!verificationId || !code) {
      throw new BusinessError('VALIDATION_FAILED', 'emailVerificationId and code are required.', 400);
    }
    const { verifyEmailOtp } = await import('../services/emailOtpService.js');
    const verification = await verifyEmailOtp({ verificationId, code });
    return res.status(200).json({ verified: true, emailVerificationId: verification.id });
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Email OTP verification failed.' });
  }
});

// DEPRECATED — all-at-once invite activation. The new flow is
// authenticated and stateless: caller already has a UserIdentity
// (from /auth/onboarding/* register), then POSTs to /invites/redeem
// with just { code }. Kept functional for old mobile builds.
router.post('/invites/activate', async (req: any, res: any) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Fri, 19 Jun 2026 00:00:00 GMT');
  console.warn('[deprecated] POST /auth/invites/activate used by client', {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  try {
    const verificationId = String(req.body?.verificationId || '').trim();
    if (!verificationId) {
      throw new BusinessError('VALIDATION_FAILED', 'verificationId is required.', 400);
    }
    const verification = await prisma.customerPhoneVerification.findUnique({ where: { id: verificationId } });
    if (!verification || verification.status !== 'VERIFIED') {
      throw new BusinessError('VALIDATION_FAILED', 'Phone verification is required before activation.', 400);
    }

    // Email verification is also required from now on. We accept either
    // emailVerificationId (new flow) and check it against the submitted
    // email. Old clients that don't send one get a clear 400 instead of
    // silently activating without proof of the email address.
    const emailVerificationId = String(req.body?.emailVerificationId || '').trim();
    const submittedEmail = String(req.body?.email || '').trim().toLowerCase();
    if (!emailVerificationId) {
      throw new BusinessError('VALIDATION_FAILED', 'E-posta doğrulaması gerekli.', 400);
    }
    const { isEmailVerificationConsumed } = await import('../services/emailOtpService.js');
    const emailOk = await isEmailVerificationConsumed(emailVerificationId, submittedEmail);
    if (!emailOk) {
      throw new BusinessError('VALIDATION_FAILED', 'Bu e-posta için doğrulama bulunamadı.', 400);
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
 * GET /memberships/preview?code=XXXXXXXX  (mounted at /auth and /api/auth)
 *
 * Read-only invite lookup for the salon-switcher confirmation step. Returns
 * the salon details (name, logo, slug, brief team stats) and the role the
 * caller would receive, so the UI can show a preview before they commit.
 *
 * Same auth + validation as /memberships/accept, but does NOT mutate
 * anything. Resolves the same FORBIDDEN/NOT_FOUND/GONE cases up front so
 * the user gets honest feedback before staring at a preview.
 */
router.get('/memberships/preview', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const identityId = Number(req.user.identityId || 0);
  if (!identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Oturum bilgisi eksik.', 401);
  }

  const code = String(req.query?.code || '').trim().toUpperCase();
  if (!code || code.length < 4) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçerli bir davet kodu gerekli.', 400);
  }

  const invite = await prisma.invite.findFirst({
    where: { inviteCodeHash: hashPlainToken(code) },
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          city: true,
          district: true,
          category: true,
        },
      },
      invitedMembership: {
        include: { identity: { select: { id: true, email: true, phone: true, displayName: true } } },
      },
      createdByUser: { select: { displayName: true, firstName: true, lastName: true, email: true } },
    },
  });

  if (!invite) {
    throw new BusinessError('NOT_FOUND', 'Davet bulunamadı.', 404);
  }
  if (invite.status !== InviteStatus.PENDING) {
    throw new BusinessError('NOT_FOUND', 'Davet artık geçerli değil.', 404);
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw new BusinessError('GONE', 'Davet süresi doldu.', 410);
  }

  const targetIdentityId = invite.invitedMembership?.identityId ?? null;
  const inviteIsPlaceholderBound = Boolean(
    invite.invitedMembership &&
      targetIdentityId !== identityId &&
      !invite.invitedMembership.identity?.email &&
      !invite.invitedMembership.identity?.phone,
  );
  if (targetIdentityId && targetIdentityId !== identityId && !inviteIsPlaceholderBound) {
    throw new BusinessError(
      'FORBIDDEN',
      'Bu davet sana ait değil.',
      403,
    );
  }

  // Already a member? Don't preview, just tell the UI.
  const existing = await prisma.salonMembership.findFirst({
    where: { salonId: invite.salonId, identityId, isActive: true },
    select: { id: true },
  });

  // Lightweight team stats (cheap counts; no PII).
  const [staffCount, memberCount] = await prisma.$transaction([
    prisma.staff.count({ where: { salonId: invite.salonId } }),
    prisma.salonMembership.count({ where: { salonId: invite.salonId, isActive: true } }),
  ]);

  const role = invite.invitedMembership?.role ?? UserRole.STAFF;
  const invitedBy =
    invite.createdByUser?.displayName ||
    [invite.createdByUser?.firstName, invite.createdByUser?.lastName].filter(Boolean).join(' ').trim() ||
    invite.createdByUser?.email ||
    null;

  return res.status(200).json({
    salon: {
      id: invite.salon.id,
      name: invite.salon.name,
      slug: invite.salon.slug,
      logoUrl: invite.salon.logoUrl,
      city: invite.salon.city,
      district: invite.salon.district,
      category: invite.salon.category,
    },
    role,
    invitedBy,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    teamSize: memberCount,
    staffCount,
    alreadyMember: Boolean(existing),
  });
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
  const inviteIsPlaceholderBound = Boolean(
    invite.invitedMembership &&
      targetIdentityId !== identityId &&
      // A "real" pre-allocation has a verified contact (email or phone) on the
      // identity that the inviter targeted. The team-access "Davet Kodu Üret"
      // flow creates a *placeholder* identity with both email and phone null —
      // those are open-by-design and any authenticated caller may claim them.
      // We still gate on this contact check so a misdirected real account
      // (different person's invite) can't be hijacked.
      !invite.invitedMembership.identity?.email &&
      !invite.invitedMembership.identity?.phone,
  );

  if (targetIdentityId && targetIdentityId !== identityId && !inviteIsPlaceholderBound) {
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

    if (invite.invitedMembership && inviteIsPlaceholderBound) {
      // CASE 1b: invite was pre-allocated to a placeholder identity (no
      // email/phone). The caller is a different real user re-claiming the
      // seat. Deactivate the placeholder membership + identity, then create
      // a fresh membership for the caller in the same salon/role.
      const placeholderMembershipId = invite.invitedMembership.id;
      const placeholderIdentityId = invite.invitedMembership.identityId;
      const targetRole = invite.invitedMembership.role;

      await tx.salonMembership.update({
        where: { id: placeholderMembershipId },
        data: { isActive: false },
      });
      // Best-effort: also flip the placeholder identity inactive so it
      // doesn't show up in account listings.
      if (placeholderIdentityId) {
        await tx.userIdentity.update({
          where: { id: placeholderIdentityId },
          data: { isActive: false },
        }).catch(() => undefined);
      }

      // Reuse the caller's identity for a new active membership.
      const newMembership = await tx.salonMembership.create({
        data: {
          salonId: invite.salonId,
          identityId,
          role: targetRole,
          secondaryRoles: invite.invitedMembership.secondaryRoles || [],
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
          role: targetRole,
          secondaryRoles: invite.invitedMembership.secondaryRoles || [],
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
    } else if (invite.invitedMembership) {
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
