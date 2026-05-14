// Verification routes — UTILITY-link based phone/email verification.
//
// Mount points (added in server.ts):
//   /api/auth/signup          → email magic-link for new salon owner
//   /api/auth/verify          → phone/email verification confirm + status + resend
//
// Customer verification endpoints live in customers.ts (per-salon scope).

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { Prisma, VerificationChannel, VerificationPurpose } from '@prisma/client';
import { prisma } from '../prisma.js';
import { BusinessError } from '../lib/errors.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  canResend,
  consumeVerificationLink,
  createVerificationLink,
  getStatus,
  markResent,
  VerificationError,
  VERIFICATION_TTL_MINUTES,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from '../services/verificationLinkService.js';
import { sendVerificationEmail, isEmailConfigured } from '../services/emailService.js';
import {
  sendVerificationLinkTemplate,
} from '../services/whatsappTemplateSender.js';
import { normalizeDigitsOnly, validateMobilePhone } from '../services/phoneValidation.js';
import { upsertPhoneIdentity } from '../services/phoneIdentityService.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function clientInfo(req: any): { ipAddress: string | null; userAgent: string | null } {
  const ipFromHeader = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ipAddress = ipFromHeader || req.ip || req.socket?.remoteAddress || null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500) || null;
  return { ipAddress, userAgent };
}

function actionLabel(purpose: VerificationPurpose): string {
  switch (purpose) {
    case VerificationPurpose.SALON_SIGNUP_EMAIL:
      return 'hesabınızı doğrulayın';
    case VerificationPurpose.TEAM_INVITE_PHONE:
      return 'ekip katılımı';
    case VerificationPurpose.PHONE_CHANGE:
      return 'numara değişikliği';
    case VerificationPurpose.PASSWORD_RESET:
      return 'şifre sıfırlama';
    default:
      return 'işleminizi tamamlayın';
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /auth/signup/email/start
// Salon signup — email magic-link entry.
//
// Idempotent: if an active link exists for the email, it's invalidated
// and a new one is created (single source of truth).
// Body: { email, firstName?, lastName?, salonName }
// ─────────────────────────────────────────────────────────────────
router.post('/signup/email/start', async (req: any, res: any) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const firstName = String(req.body?.firstName || '').trim() || null;
  const lastName = String(req.body?.lastName || '').trim() || null;
  const salonName = String(req.body?.salonName || '').trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçerli bir e-posta girin.', 400);
  }
  if (!salonName) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon adı gereklidir.', 400);
  }
  if (!isEmailConfigured()) {
    throw new BusinessError('SERVICE_UNAVAILABLE', 'E-posta servisi yapılandırılmamış.', 503);
  }

  // If a verified UserIdentity already exists for this email, reject —
  // signup must be a fresh account creation. (Login flow handles existing.)
  const existing = await prisma.userIdentity.findUnique({ where: { email } });
  if (existing && existing.emailVerifiedAt) {
    throw new BusinessError('CONFLICT', 'Bu e-posta ile bir hesap mevcut. Giriş yapın.', 409);
  }

  const { ipAddress, userAgent } = clientInfo(req);

  // Stash signup intent in the link payload so consumption can complete
  // identity creation atomically.
  const link = await createVerificationLink({
    purpose: VerificationPurpose.SALON_SIGNUP_EMAIL,
    channel: VerificationChannel.EMAIL,
    targetEmail: email,
    payload: {
      email,
      firstName,
      lastName,
      salonName,
    },
    ipAddress,
    userAgent,
  });

  try {
    await sendVerificationEmail({
      to: email,
      name: firstName,
      actionLabel: 'hesabınızı doğrulayın',
      link: link.link,
      ttlMinutes: VERIFICATION_TTL_MINUTES,
    });
  } catch (error: any) {
    console.error('[verification/signup] email send failed', error?.message || error);
    throw new BusinessError('INTERNAL_ERROR', 'E-posta gönderilemedi.', 500);
  }

  return res.status(202).json({
    id: link.id,
    channel: 'email',
    expiresAt: link.expiresAt.toISOString(),
    resendCooldownSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/verify/phone/start
// Phone-change for existing authenticated user.
// Body: { newPhone, countryIso? }
// Auth: required
// ─────────────────────────────────────────────────────────────────
router.post('/verify/phone/start', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Auth required.', 401);
  }

  const identityId = Number(req.user.identityId);
  const countryIso = String(req.body?.countryIso || 'TR').trim().toUpperCase();
  const rawPhone = String(req.body?.newPhone || '').trim();

  let normalized;
  try {
    normalized = validateMobilePhone({ rawPhone, countryIso });
  } catch (e: any) {
    throw new BusinessError('VALIDATION_FAILED', e?.message || 'Geçersiz telefon.', 400);
  }

  // Reject if the new phone is already in use by another identity.
  const conflict = await prisma.userIdentity.findFirst({
    where: { phone: normalized.digits, NOT: { id: identityId } },
    select: { id: true },
  });
  if (conflict) {
    throw new BusinessError('CONFLICT', 'Bu numara başka bir hesapta kayıtlı.', 409);
  }

  // Find a salon WABA to send from. First active membership wins.
  const membership = await prisma.salonMembership.findFirst({
    where: { identityId, isActive: true },
    orderBy: { id: 'asc' },
    include: {
      identity: { select: { firstName: true, displayName: true } },
      salon: { select: { id: true, name: true, chakraPluginId: true, chakraPhoneNumberId: true } },
    },
  });
  if (!membership || !membership.salon.chakraPluginId || !membership.salon.chakraPhoneNumberId) {
    throw new BusinessError(
      'PRECONDITION_FAILED',
      'Numara değişikliği için salonunuza WhatsApp bağlı olmalıdır.',
      412,
    );
  }

  const { ipAddress, userAgent } = clientInfo(req);
  const link = await createVerificationLink({
    purpose: VerificationPurpose.PHONE_CHANGE,
    channel: VerificationChannel.WHATSAPP,
    targetIdentityId: identityId,
    targetSalonId: membership.salonId,
    targetPhone: normalized.digits,
    payload: {
      newPhone: normalized.e164,
      newPhoneDigits: normalized.digits,
      countryIso: normalized.countryIso,
    },
    ipAddress,
    userAgent,
  });

  const greetingName =
    membership.identity?.firstName ||
    (membership.identity?.displayName || '').split(' ')[0] ||
    'kullanıcı';

  const sendResult = await sendVerificationLinkTemplate({
    salonId: membership.salonId,
    phone: normalized.digits,
    token: link.token,
    ttlMinutes: VERIFICATION_TTL_MINUTES,
  });

  if (!sendResult.ok) {
    throw new BusinessError('INTERNAL_ERROR', 'WhatsApp gönderimi başarısız.', 500, {
      reason: sendResult.error,
    });
  }

  return res.status(202).json({
    id: link.id,
    channel: 'whatsapp',
    expiresAt: link.expiresAt.toISOString(),
    resendCooldownSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/verify/confirm
// Magic-link consume. Called by the landing page once the user taps.
// Body: { token, password? (only for SALON_SIGNUP_EMAIL) }
//
// On success returns purpose-specific payload so the frontend can route
// the user to the next step (set password, dashboard, settings).
// ─────────────────────────────────────────────────────────────────
router.post('/verify/confirm', async (req: any, res: any) => {
  const token = String(req.body?.token || '').trim();
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token gereklidir.', 400);
  }

  const { ipAddress, userAgent } = clientInfo(req);

  let consumed;
  try {
    consumed = await consumeVerificationLink(token, { ipAddress, userAgent });
  } catch (error: any) {
    if (error instanceof VerificationError) {
      const httpStatus = error.code === 'VERIFICATION_LINK_EXPIRED' ? 410 : 400;
      throw new BusinessError(error.code, error.message, httpStatus);
    }
    throw error;
  }

  // Dispatch by purpose.
  switch (consumed.purpose) {
    case VerificationPurpose.SALON_SIGNUP_EMAIL: {
      // Email verified. Create or attach the UserIdentity row with
      // emailVerifiedAt. Password is set in a follow-up call (the user
      // lands on a "set password" UI after token consume).
      const email = consumed.targetEmail || (consumed.payload?.email as string);
      if (!email) {
        throw new BusinessError('INTERNAL_ERROR', 'Doğrulama eksik.', 500);
      }
      const password = String(req.body?.password || '');
      if (!password || password.length < 8) {
        // Two-step: token verified, but password missing — return state
        // so the frontend collects password and re-submits.
        return res.status(200).json({
          purpose: consumed.purpose,
          state: 'email_verified_password_required',
          email,
          firstName: consumed.payload?.firstName || null,
          lastName: consumed.payload?.lastName || null,
          salonName: consumed.payload?.salonName || null,
        });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const existing = await prisma.userIdentity.findUnique({ where: { email } });
      const now = new Date();
      const identity = existing
        ? await prisma.userIdentity.update({
            where: { id: existing.id },
            data: {
              passwordHash: hashedPassword,
              firstName: existing.firstName || (consumed.payload?.firstName as string) || null,
              lastName: existing.lastName || (consumed.payload?.lastName as string) || null,
              emailVerifiedAt: now,
              isActive: true,
            },
          })
        : await prisma.userIdentity.create({
            data: {
              email,
              passwordHash: hashedPassword,
              firstName: (consumed.payload?.firstName as string) || null,
              lastName: (consumed.payload?.lastName as string) || null,
              emailVerifiedAt: now,
              isActive: true,
            },
          });

      return res.status(200).json({
        purpose: consumed.purpose,
        state: 'completed',
        identity: { id: identity.id, email: identity.email },
        next: 'create_salon',
        salonName: consumed.payload?.salonName || null,
      });
    }

    case VerificationPurpose.PHONE_CHANGE: {
      const identityId = consumed.targetIdentityId;
      if (!identityId) {
        throw new BusinessError('INTERNAL_ERROR', 'Doğrulama eksik.', 500);
      }
      const newPhoneDigits = (consumed.payload?.newPhoneDigits as string) || consumed.targetPhone || '';
      if (!newPhoneDigits) {
        throw new BusinessError('INTERNAL_ERROR', 'Yeni numara payload eksik.', 500);
      }
      // Last-mile uniqueness check (race window).
      const conflict = await prisma.userIdentity.findFirst({
        where: { phone: newPhoneDigits, NOT: { id: identityId } },
        select: { id: true },
      });
      if (conflict) {
        throw new BusinessError('CONFLICT', 'Bu numara başka bir hesapta kayıtlı.', 409);
      }
      const now = new Date();
      await prisma.userIdentity.update({
        where: { id: identityId },
        data: { phone: newPhoneDigits, phoneVerifiedAt: now },
      });
      await upsertPhoneIdentity({ phone: newPhoneDigits });
      return res.status(200).json({
        purpose: consumed.purpose,
        state: 'completed',
        identityId,
        newPhone: consumed.payload?.newPhone || newPhoneDigits,
      });
    }

    case VerificationPurpose.TEAM_INVITE_PHONE: {
      // Mark phone as verified; the invite-activate flow finalizes
      // membership creation with the password the user just sets.
      if (consumed.targetPhone) {
        await upsertPhoneIdentity({ phone: consumed.targetPhone });
      }
      return res.status(200).json({
        purpose: consumed.purpose,
        state: 'phone_verified',
        verificationId: consumed.id,
        phone: consumed.targetPhone,
        salonId: consumed.targetSalonId,
        inviteId: consumed.payload?.inviteId || null,
      });
    }

    case VerificationPurpose.PASSWORD_RESET: {
      return res.status(200).json({
        purpose: consumed.purpose,
        state: 'reset_authorized',
        verificationId: consumed.id,
        identityId: consumed.targetIdentityId,
      });
    }

    default:
      return res.status(200).json({
        purpose: consumed.purpose,
        state: 'completed',
        id: consumed.id,
      });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /auth/verify/status/:id
// Polling endpoint — frontend polls while user taps the link on phone.
// ─────────────────────────────────────────────────────────────────
router.get('/verify/status/:id', async (req: any, res: any) => {
  const id = String(req.params?.id || '').trim();
  if (!id) {
    throw new BusinessError('VALIDATION_FAILED', 'id gereklidir.', 400);
  }
  const status = await getStatus(id);
  if (!status) {
    throw new BusinessError('NOT_FOUND', 'Doğrulama bulunamadı.', 404);
  }
  return res.status(200).json(status);
});

// ─────────────────────────────────────────────────────────────────
// POST /auth/verify/resend/:id
// Re-send the link via its original channel. 60s cooldown.
// ─────────────────────────────────────────────────────────────────
router.post('/verify/resend/:id', async (req: any, res: any) => {
  const id = String(req.params?.id || '').trim();
  if (!id) {
    throw new BusinessError('VALIDATION_FAILED', 'id gereklidir.', 400);
  }

  const record = await prisma.verificationLink.findUnique({ where: { id } });
  if (!record) {
    throw new BusinessError('NOT_FOUND', 'Doğrulama bulunamadı.', 404);
  }
  if (record.usedAt) {
    throw new BusinessError('CONFLICT', 'Bu doğrulama zaten tamamlanmış.', 409);
  }
  if (record.invalidatedAt) {
    throw new BusinessError('CONFLICT', 'Bu doğrulama iptal edilmiş.', 409);
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new BusinessError('GONE', 'Bu doğrulamanın süresi dolmuş. Yenisini başlatın.', 410);
  }
  const ok = await canResend(id);
  if (!ok) {
    throw new BusinessError(
      'RATE_LIMITED',
      `Lütfen ${VERIFICATION_RESEND_COOLDOWN_SECONDS} saniye sonra tekrar deneyin.`,
      429,
    );
  }

  // Resend: we can't re-derive the plaintext token from the hash, so we
  // mint a NEW token and overwrite the record's hash. This keeps the row
  // (and its id) stable for the polling frontend.
  const newLink = await createVerificationLink({
    purpose: record.purpose,
    channel: record.channel,
    targetIdentityId: record.targetIdentityId || undefined,
    targetSalonId: record.targetSalonId || undefined,
    targetPhone: record.targetPhone || undefined,
    targetEmail: record.targetEmail || undefined,
    payload: (record.payload as Record<string, unknown>) || {},
    ipAddress: record.ipAddress || undefined,
    userAgent: record.userAgent || undefined,
    invalidateExisting: false, // we keep current record valid until new dispatch succeeds
  });

  // Dispatch through the same channel.
  try {
    if (record.channel === VerificationChannel.EMAIL) {
      const email = record.targetEmail || '';
      if (!email) throw new Error('email_missing');
      await sendVerificationEmail({
        to: email,
        name: (record.payload as any)?.firstName || null,
        actionLabel: actionLabel(record.purpose),
        link: newLink.link,
        ttlMinutes: VERIFICATION_TTL_MINUTES,
      });
    } else {
      const phone = record.targetPhone || '';
      const salonId = record.targetSalonId || 0;
      if (!phone || !salonId) throw new Error('whatsapp_target_missing');
      await sendVerificationLinkTemplate({
        salonId,
        phone,
        token: newLink.token,
        ttlMinutes: VERIFICATION_TTL_MINUTES,
      });
    }
  } catch (error: any) {
    console.error('[verification/resend] dispatch failed', error?.message || error);
    throw new BusinessError('INTERNAL_ERROR', 'Yeniden gönderim başarısız.', 500);
  }

  // Mark old record invalidated, update polling id-set to point at new.
  await prisma.verificationLink.update({
    where: { id },
    data: { invalidatedAt: new Date() },
  });
  await markResent(newLink.id);

  return res.status(202).json({
    id: newLink.id,
    channel: record.channel === 'EMAIL' ? 'email' : 'whatsapp',
    expiresAt: newLink.expiresAt.toISOString(),
    resendCooldownSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
  });
});

export default router;
