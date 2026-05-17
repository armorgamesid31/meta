import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  buildBootstrapUser,
  buildCapabilities,
  buildFeatureFlags,
} from '../services/mobileBootstrap.js';
import { BusinessError } from '../lib/errors.js';
import { createNotification, getDefaultNotificationPolicy } from '../services/notifications.js';
import { getPushProviderStatus } from '../services/pushProvider.js';
import { ACCESS_VERSION, ensureSalonAccessSeed, getEffectivePermissionSet } from '../services/accessControl.js';
import { getFeaturesForPlan } from '../services/planFeatures.js';
import { deleteR2Object, isR2Configured, uploadBufferToR2 } from '../lib/r2.js';

const router = Router();

const STAFF_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const STAFF_PHOTO_ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const staffPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: STAFF_PHOTO_MAX_BYTES, files: 1 },
});

function inferStaffPhotoExtension(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function maskPushToken(token: string): string {
  const normalized = String(token || '').trim();
  if (!normalized) return '';
  return normalized.length <= 8 ? normalized : `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

router.get('/bootstrap', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }

  try {
    const user = await prisma.salonUser.findUnique({
      where: { id: req.user.userId },
      include: {
        salon: {
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            countryCode: true,
            bookingMode: true,
            whatsappPhone: true,
            address: true,
            onboardingStep: true,
            onboardingSkipped: true,
            category: true,
            logoUrl: true,
            kurulumScore: true,
            kurulumStage: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user || !user.salon || user.salon.id !== req.user.salonId) {
      throw new BusinessError('NOT_FOUND', 'User or salon not found.', 404);
    }

    const normalizedWhatsapp = (user.salon.whatsappPhone || '').replace(/[^\d]/g, '');
    const membershipId = Number(req.user.membershipId || 0);
    const effectiveMembershipId = Number(req.user.membershipId || req.user.userId);

    // Run all remaining bootstrap data fetches in parallel. Previously
    // these executed sequentially (seed → permissions → staff lookup →
    // four-query transaction), creating a 5-round-trip waterfall that
    // dominated login latency. The chains here are minimally
    // ordered: ensureSalonAccessSeed must complete before
    // getEffectivePermissionSet reads from the rows it seeds, but
    // everything else is independent of that chain and of each other.
    const accessChainPromise = (async () => {
      await ensureSalonAccessSeed(user.salon.id);
      return getEffectivePermissionSet({
        salonId: user.salon.id,
        membershipId: effectiveMembershipId,
        role: String(req.user.role || user.role),
      });
    })();

    const linkedStaffPromise =
      membershipId > 0
        ? prisma.staff.findFirst({
            where: {
              salonId: user.salon.id,
              membershipId,
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              gender: true,
            },
          })
        : Promise.resolve(null);

    const transactionPromise = prisma.$transaction([
      prisma.salonSettings.findUnique({
        where: { salonId: user.salon.id },
        select: {
          workStartHour: true,
          workEndHour: true,
          slotInterval: true,
          workingDays: true,
        },
      }),
      prisma.service.count({ where: { salonId: user.salon.id } }),
      prisma.staff.count({ where: { salonId: user.salon.id } }),
      prisma.salonSubscription.findFirst({
        where: { salonId: user.salon.id },
        orderBy: { id: 'desc' },
        select: { planKey: true, status: true },
      }),
    ]);

    const [
      effectivePermissionSet,
      linkedStaff,
      [settings, serviceCount, staffCount, latestSubscription],
    ] = await Promise.all([accessChainPromise, linkedStaffPromise, transactionPromise]);

    const permissions = Array.from(effectivePermissionSet).sort();

    const features = getFeaturesForPlan(latestSubscription?.planKey ?? null);

    const setupChecklist = {
      workingHours:
        typeof settings?.workStartHour === 'number' && typeof settings?.workEndHour === 'number',
      address: Boolean((user.salon.address || '').trim()),
      phone: Boolean(normalizedWhatsapp),
      service: serviceCount > 0,
      staff: staffCount > 0,
    };

    const payload = {
      user: buildBootstrapUser(user),
      salon: {
        id: user.salon.id,
        name: user.salon.name,
        slug: user.salon.slug,
        city: user.salon.city,
        country: user.salon.countryCode,
        whatsappPhone: user.salon.whatsappPhone ?? null,
        onboardingStep: user.salon.onboardingStep,
        onboardingSkipped: user.salon.onboardingSkipped ?? [],
        category: user.salon.category ?? null,
        logoUrl: user.salon.logoUrl ?? null,
        kurulumScore: user.salon.kurulumScore ?? 0,
        kurulumStage: user.salon.kurulumStage ?? null,
        createdAt: user.salon.createdAt?.toISOString() ?? null,
      },
      capabilities: buildCapabilities(user.role),
      featureFlags: buildFeatureFlags(user.role, user.salon.bookingMode, Boolean(normalizedWhatsapp), permissions),
      permissions,
      accessVersion: ACCESS_VERSION,
      subscription: {
        plan: latestSubscription?.planKey ?? 'starter',
        status: latestSubscription?.status ?? 'trial',
      },
      features,
      setupChecklist: {
        ...setupChecklist,
        completed: Object.values(setupChecklist).every(Boolean),
      },
      setup: {
        workStartHour: settings?.workStartHour ?? null,
        workEndHour: settings?.workEndHour ?? null,
        slotInterval: settings?.slotInterval ?? null,
        workingDays: settings?.workingDays ?? null,
      },
      staffProfile: {
        linkedStaffId: linkedStaff?.id ?? null,
        firstName: linkedStaff?.firstName ?? null,
        lastName: linkedStaff?.lastName ?? null,
        gender: linkedStaff?.gender ?? null,
        completionRequired: Boolean(linkedStaff && (!linkedStaff.firstName || !linkedStaff.gender)),
      },
      notifications: {
        defaults: getDefaultNotificationPolicy(),
      },
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Mobile bootstrap error:', error);
    throw error;
  }
});

router.get('/staff-profile', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const membershipId = Number(req.user.membershipId || 0);
  if (!membershipId) {
    throw new BusinessError('FORBIDDEN', 'Membership required.', 403);
  }

  const staff = await prisma.staff.findFirst({
    where: { salonId, membershipId },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      gender: true,
      title: true,
      bio: true,
      profileImageUrl: true,
    },
  });
  if (!staff) {
    throw new BusinessError('NOT_FOUND', 'Linked staff profile not found.', 404);
  }

  return res.status(200).json({ item: staff });
});

router.put('/staff-profile', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const membershipId = Number(req.user.membershipId || 0);
  if (!membershipId) {
    throw new BusinessError('FORBIDDEN', 'Membership required.', 403);
  }

  const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : '';
  const lastNameRaw = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : '';
  const genderRaw = typeof req.body?.gender === 'string' ? req.body.gender.trim().toLowerCase() : '';

  if (!firstName) {
    throw new BusinessError('VALIDATION_FAILED', 'firstName is required.', 400);
  }
  if (!(genderRaw === 'female' || genderRaw === 'male' || genderRaw === 'other')) {
    throw new BusinessError('VALIDATION_FAILED', 'gender must be female, male or other.', 400);
  }

  const staff = await prisma.staff.findFirst({
    where: { salonId, membershipId },
    select: { id: true },
  });
  if (!staff) {
    throw new BusinessError('NOT_FOUND', 'Linked staff profile not found.', 404);
  }

  const lastName = lastNameRaw || null;
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  const updated = await prisma.staff.update({
    where: { id: staff.id },
    data: {
      firstName,
      lastName,
      gender: genderRaw as any,
      name,
    },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      gender: true,
      title: true,
      bio: true,
      profileImageUrl: true,
    },
  });

  return res.status(200).json({ item: updated });
});

/**
 * PUT /account-name  (mounted at /api/mobile)
 *
 * Updates the authenticated user's first/last name on BOTH the per-salon
 * SalonUser row and the shared UserIdentity row. Unlike /staff-profile
 * this does NOT require a linked Staff record — so owners (who often
 * have no Staff link) can set a name that the conversation system
 * messages ("X devraldı.") will use instead of falling back to email.
 *
 * Body: { firstName: string, lastName?: string }
 * Response: { firstName, lastName, displayName }
 */
router.put('/account-name', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const userId = Number(req.user.userId || 0);
  const identityId = Number(req.user.identityId || 0);
  if (!userId && !identityId) {
    throw new BusinessError('FORBIDDEN', 'User context required.', 403);
  }

  const firstName = typeof req.body?.firstName === 'string' ? req.body.firstName.trim() : '';
  const lastNameRaw = typeof req.body?.lastName === 'string' ? req.body.lastName.trim() : '';
  if (!firstName) {
    throw new BusinessError('VALIDATION_FAILED', 'firstName is required.', 400);
  }
  if (firstName.length > 80 || lastNameRaw.length > 80) {
    throw new BusinessError('VALIDATION_FAILED', 'name too long.', 400);
  }
  const lastName = lastNameRaw || null;
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  // Per-salon SalonUser row (used by handover/resume actor lookup).
  if (userId) {
    await prisma.salonUser.update({
      where: { id: userId },
      data: { firstName, lastName, displayName },
    }).catch(() => { /* row may not exist for pre-membership users */ });
  }
  // Shared UserIdentity row (cross-salon fallback in actor lookup).
  if (identityId) {
    await prisma.userIdentity.update({
      where: { id: identityId },
      data: { firstName, lastName, displayName },
    }).catch(() => { /* identity may be deleted */ });
  }

  return res.status(200).json({ firstName, lastName, displayName });
});

/**
 * POST /staff-profile/photo  (mounted at /api/mobile)
 *
 * Authenticated staff/owner uploads a new profile photo for the Staff row
 * linked to their SalonMembership. Mirrors the R2 upload pattern from
 * routes/salonLogo.ts (multer memory storage + lib/r2 helper).
 *
 * Multipart field name: `image`. Max 2 MB. JPEG / PNG / WebP only.
 *
 * Response: { staff: { id, profileImageUrl } }
 */
router.post(
  '/staff-profile/photo',
  authenticateToken,
  staffPhotoUpload.single('image'),
  async (req: any, res: Response) => {
    if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    const salonId = Number(req.user.salonId || 0);
    const membershipId = Number(req.user.membershipId || 0);
    if (!salonId || !membershipId) {
      throw new BusinessError('FORBIDDEN', 'Membership required.', 403);
    }

    if (!isR2Configured()) {
      throw new BusinessError('STORAGE_NOT_CONFIGURED', 'Photo storage is not available right now.', 503);
    }

    const file = (req as Request).file as Express.Multer.File | undefined;
    if (!file || !file.buffer?.length) {
      throw new BusinessError('VALIDATION_FAILED', 'image is required.', 400);
    }

    const contentTypeRaw = (file.mimetype || '').toLowerCase();
    const normalizedType = contentTypeRaw === 'image/jpg' ? 'image/jpeg' : contentTypeRaw;
    if (!STAFF_PHOTO_ALLOWED_TYPES.has(normalizedType)) {
      throw new BusinessError(
        'VALIDATION_FAILED',
        'Sadece JPEG, PNG veya WebP yükleyebilirsin.',
        400,
      );
    }

    const staff = await prisma.staff.findFirst({
      where: { salonId, membershipId },
      select: { id: true, profileImageUrl: true },
    });
    if (!staff) {
      throw new BusinessError('NOT_FOUND', 'Linked staff profile not found.', 404);
    }

    const ext = inferStaffPhotoExtension(normalizedType);
    const objectKey = `salons/${salonId}/staff/${staff.id}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;

    let publicUrl: string;
    try {
      publicUrl = await uploadBufferToR2({
        objectKey,
        body: file.buffer,
        contentType: normalizedType,
      });
    } catch (err: any) {
      console.error('[staff-photo] R2 upload failed', {
        salonId,
        staffId: staff.id,
        message: err?.message || String(err),
      });
      throw new BusinessError('UPLOAD_FAILED', 'Fotoğraf yüklenemedi.', 500);
    }

    const updated = await prisma.staff.update({
      where: { id: staff.id },
      data: { profileImageUrl: publicUrl },
      select: { id: true, profileImageUrl: true },
    });

    // Best-effort cleanup of the previous photo. We only delete if the prior
    // URL is under our staff prefix so we don't accidentally drop avatars
    // hosted elsewhere (e.g. legacy seeded URLs).
    if (staff.profileImageUrl) {
      try {
        const parsed = new URL(staff.profileImageUrl);
        const prevKey = parsed.pathname.replace(/^\/+/, '').replace(/^[^/]+\//, '');
        if (prevKey.startsWith(`salons/${salonId}/staff/`) && prevKey !== objectKey) {
          await deleteR2Object(prevKey);
        }
      } catch {
        // ignore — old URL may not parse / not under our bucket
      }
    }

    return res.status(200).json({ staff: updated });
  },
);

// Multer-specific error normalization for the /staff-profile/photo route.
// Express 5 forwards errors thrown by middleware to the global errorMiddleware
// which won't know about LIMIT_FILE_SIZE specifically — we map it to 413 so
// the mobile app can show a friendly message.
router.use(
  '/staff-profile/photo',
  (err: any, _req: Request, res: Response, next: any) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 'FILE_TOO_LARGE',
        message: `Fotoğraf çok büyük (en fazla ${Math.floor(STAFF_PHOTO_MAX_BYTES / (1024 * 1024))}MB).`,
      });
    }
    return next(err);
  },
);

// POST /me/password (mounted at /api/mobile)
//
// Lets the logged-in user change their OWN password. We refuse if the
// current password doesn't match — owners must use the admin reset
// flow to recover a forgotten password. Password policy is intentionally
// minimal (>= 6 chars) to match the existing signup/reset path.
router.post('/me/password', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const identityId = Number(req.user.identityId);
  if (!Number.isInteger(identityId) || identityId <= 0) {
    throw new BusinessError('UNAUTHORIZED', 'Geçersiz kullanıcı.', 401);
  }

  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!currentPassword || !newPassword) {
    throw new BusinessError('VALIDATION_FAILED', 'Mevcut ve yeni şifre zorunludur.', 400);
  }
  if (newPassword.length < 6) {
    throw new BusinessError('VALIDATION_FAILED', 'Yeni şifre en az 6 karakter olmalıdır.', 422);
  }
  if (currentPassword === newPassword) {
    throw new BusinessError('VALIDATION_FAILED', 'Yeni şifre, mevcut şifre ile aynı olamaz.', 422);
  }

  const bcrypt = (await import('bcrypt')).default;
  const identity = await prisma.userIdentity.findUnique({
    where: { id: identityId },
    select: { id: true, passwordHash: true, isActive: true },
  });
  if (!identity || !identity.isActive) {
    throw new BusinessError('UNAUTHORIZED', 'Kullanıcı bulunamadı.', 401);
  }

  const matches = await bcrypt.compare(currentPassword, identity.passwordHash);
  if (!matches) {
    throw new BusinessError('UNAUTHORIZED', 'Mevcut şifre hatalı.', 401);
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.userIdentity.update({
    where: { id: identity.id },
    data: { passwordHash: newHash },
  });

  // Mirror into legacy SalonUser rows linked via SalonMembership so the
  // legacy login path doesn't keep accepting the old password. Best-effort —
  // identity-side update is authoritative.
  try {
    const memberships = await prisma.salonMembership.findMany({
      where: { identityId, isActive: true },
      select: { legacySalonUserId: true },
    });
    const legacyUserIds = memberships
      .map((m) => m.legacySalonUserId)
      .filter((id): id is number => Number.isInteger(id) && (id as number) > 0);
    if (legacyUserIds.length > 0) {
      await prisma.salonUser.updateMany({
        where: { id: { in: legacyUserIds } },
        data: { passwordHash: newHash, passwordResetRequired: false },
      });
    }
  } catch (legacyError) {
    console.warn('Legacy password mirror failed:', legacyError);
  }

  return res.status(200).json({ ok: true });
});

router.post('/push/register', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim().toLowerCase() : '';
  const platform = typeof req.body?.platform === 'string' ? req.body.platform.trim().toUpperCase() : '';
  const appVersion = typeof req.body?.appVersion === 'string' ? req.body.appVersion.trim() : null;
  const deviceMeta = req.body?.deviceMeta ?? null;

  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token is required.', 400);
  }
  if (!provider) {
    throw new BusinessError('VALIDATION_FAILED', 'provider is required.', 400);
  }
  if (provider !== 'expo' && provider !== 'fcm') {
    throw new BusinessError('VALIDATION_FAILED', 'provider must be expo or fcm.', 422);
  }
  if (!platform) {
    throw new BusinessError('VALIDATION_FAILED', 'platform is required.', 400);
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "PushDeviceToken"
          ("salonId", "userId", "platform", "token", "appVersion", "deviceMeta", "isActive", "lastSeenAt", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4, $5, $6::jsonb, true, NOW(), NOW(), NOW())
        ON CONFLICT ("platform", "token", "salonId")
        DO UPDATE SET
          "userId" = EXCLUDED."userId",
          "appVersion" = EXCLUDED."appVersion",
          "deviceMeta" = EXCLUDED."deviceMeta",
          "isActive" = true,
          "lastSeenAt" = NOW(),
          "updatedAt" = NOW()
      `,
      salonId,
      userId,
      platform,
      token,
      appVersion,
      JSON.stringify(deviceMeta || {}),
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mobile push register error:', error);
    throw error;
  }
});

router.post('/push/unregister', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim().toLowerCase() : '';
  if (!token) throw new BusinessError('VALIDATION_FAILED', 'token is required.', 400);
  if (!provider) throw new BusinessError('VALIDATION_FAILED', 'provider is required.', 400);
  if (provider !== 'expo' && provider !== 'fcm') throw new BusinessError('VALIDATION_FAILED', 'provider must be expo or fcm.', 422);

  try {
    await prisma.$executeRawUnsafe(
      `
        UPDATE "PushDeviceToken"
        SET "isActive" = false, "updatedAt" = NOW()
        WHERE "salonId" = $1 AND "userId" = $2 AND "token" = $3
      `,
      salonId,
      userId,
      token,
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mobile push unregister error:', error);
    throw error;
  }
});

router.get('/push/status', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;
  const provider = getPushProviderStatus();

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          "id",
          "platform",
          "token",
          "appVersion",
          "deviceMeta",
          "isActive",
          "lastSeenAt",
          "createdAt",
          "updatedAt"
        FROM "PushDeviceToken"
        WHERE "salonId" = $1 AND "userId" = $2
        ORDER BY COALESCE("lastSeenAt", "createdAt") DESC, "id" DESC
      `,
      salonId,
      userId,
    );

    const devices = rows.map((row) => ({
      id: Number(row.id),
      platform: String(row.platform || ''),
      tokenMasked: maskPushToken(String(row.token || '')),
      appVersion: row.appVersion || null,
      deviceMeta: row.deviceMeta || null,
      isActive: row.isActive !== false,
      lastSeenAt: row.lastSeenAt || null,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || null,
    }));

    return res.status(200).json({
      providerConfigured: provider.configured,
      providerSource: provider.source,
      providerError: provider.error,
      activeDeviceCount: devices.filter((item) => item.isActive).length,
      devices,
    });
  } catch (error) {
    console.error('Mobile push status error:', error);
    throw error;
  }
});

router.post('/push/test', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);

  const rawDelaySeconds = Number(req.body?.delaySeconds);
  const delaySeconds =
    Number.isFinite(rawDelaySeconds) && rawDelaySeconds > 0
      ? Math.min(Math.floor(rawDelaySeconds), 60)
      : 0;
  const scenarioRaw = typeof req.body?.scenario === 'string' ? req.body.scenario.trim().toUpperCase() : '';
  const scenario = scenarioRaw || 'GENERAL';

  const testConfigByScenario: Record<
    string,
    {
      eventType:
        | 'HANDOVER_REQUIRED'
        | 'HANDOVER_REMINDER'
        | 'SAME_DAY_APPOINTMENT_CHANGE'
        | 'END_OF_DAY_MISSING_DATA'
        | 'DAILY_MANAGER_REPORT';
      title: string;
      body: string;
      route: 'conversations' | 'schedule' | 'analytics' | 'notifications';
      payloadExtras?: Record<string, unknown>;
    }
  > = {
    GENERAL: {
      eventType: 'DAILY_MANAGER_REPORT',
      title: 'Test bildirimi',
      body: 'Push sistemi bu cihaza ulaştı.',
      route: 'notifications',
    },
    APPOINTMENT_NEW: {
      eventType: 'SAME_DAY_APPOINTMENT_CHANGE',
      title: 'Yeni randevu (test)',
      body: 'Yeni randevu sesi çalmalı.',
      route: 'schedule',
      payloadExtras: { event: 'CREATED' },
    },
    BOOKING_CHANGE: {
      eventType: 'SAME_DAY_APPOINTMENT_CHANGE',
      title: 'Randevu değişikliği (test)',
      body: 'Değişiklik sesi çalmalı.',
      route: 'schedule',
      payloadExtras: { event: 'UPDATED' },
    },
    REPORT: {
      eventType: 'DAILY_MANAGER_REPORT',
      title: 'Günlük rapor (test)',
      body: 'Rapor sesi çalmalı.',
      route: 'analytics',
    },
    HANDOVER: {
      eventType: 'HANDOVER_REQUIRED',
      title: 'Handover (test)',
      body: 'Handover sesi çalmalı.',
      route: 'conversations',
    },
  };

  const selectedConfig = testConfigByScenario[scenario] || testConfigByScenario.GENERAL;

  const sendTestNotification = () =>
    createNotification({
      salonId: req.user.salonId,
      eventType: selectedConfig.eventType,
      title: delaySeconds > 0 ? `${selectedConfig.title} (gecikmeli)` : selectedConfig.title,
      body:
        delaySeconds > 0
          ? `${selectedConfig.body} Bildirim ${delaySeconds} saniye gecikmeli gonderildi.`
          : selectedConfig.body,
      payload: {
        route: selectedConfig.route,
        source: delaySeconds > 0 ? 'manual_delayed_push_test' : 'manual_push_test',
        createdAt: new Date().toISOString(),
        delaySeconds,
        scenario,
        ...(selectedConfig.payloadExtras || {}),
      },
      recipientUserIds: [req.user.userId],
    });

  try {
    if (delaySeconds > 0) {
      setTimeout(() => {
        sendTestNotification().catch((error) => {
          console.error('Mobile delayed push test error:', error);
        });
      }, delaySeconds * 1000);

      return res.status(200).json({
        ok: true,
        scheduled: true,
        delaySeconds,
        scenario,
        notificationId: null,
        inAppDeliveryCount: 0,
        pushDeliveryCount: 0,
        pushDeliverySummary: {
          PENDING: 0,
          SENT: 0,
          SKIPPED: 0,
          FAILED: 0,
        },
        providerConfigured: getPushProviderStatus().configured,
        providerSource: getPushProviderStatus().source,
        providerError: getPushProviderStatus().error,
      });
    }

    const result = await sendTestNotification();

    return res.status(200).json({
      ok: true,
      scheduled: false,
      delaySeconds: 0,
      scenario,
      notificationId: result.notificationId,
      inAppDeliveryCount: result.inAppDeliveryCount,
      pushDeliveryCount: result.pushDeliveryCount,
      pushDeliverySummary: result.pushDeliverySummary,
      providerConfigured: result.providerConfigured,
      providerSource: result.providerSource,
      providerError: result.providerError,
    });
  } catch (error) {
    console.error('Mobile push test error:', error);
    throw error;
  }
});

router.get('/notification-preferences', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "masterEnabled", "eventConfig"
        FROM "UserNotificationPreference"
        WHERE "salonId" = $1 AND "userId" = $2
        LIMIT 1
      `,
      salonId,
      userId,
    );

    const item = rows[0] || null;
    return res.status(200).json({
      preferences: {
        masterEnabled: item ? item.masterEnabled !== false : true,
        eventConfig: item?.eventConfig || {},
      },
    });
  } catch (error) {
    console.error('Mobile notification preferences get error:', error);
    throw error;
  }
});

router.put('/notification-preferences', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;
  const masterEnabled = req.body?.masterEnabled !== false;
  const eventConfig = req.body?.eventConfig ?? {};

  try {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "UserNotificationPreference"
          ("salonId", "userId", "masterEnabled", "eventConfig", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4::jsonb, NOW(), NOW())
        ON CONFLICT ("salonId", "userId")
        DO UPDATE SET
          "masterEnabled" = EXCLUDED."masterEnabled",
          "eventConfig" = EXCLUDED."eventConfig",
          "updatedAt" = NOW()
      `,
      salonId,
      userId,
      Boolean(masterEnabled),
      JSON.stringify(eventConfig || {}),
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mobile notification preferences update error:', error);
    throw error;
  }
});

router.get('/notifications', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 40));

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          d."id" AS "deliveryId",
          d."channel",
          d."status",
          d."readAt",
          d."createdAt" AS "deliveryCreatedAt",
          n."id" AS "notificationId",
          n."eventType",
          n."title",
          n."body",
          n."payload",
          n."createdAt"
        FROM "AppNotificationDelivery" d
        INNER JOIN "AppNotification" n ON n."id" = d."notificationId"
        WHERE d."salonId" = $1 AND d."userId" = $2 AND d."channel" = 'IN_APP'::"NotificationDeliveryChannel"
        ORDER BY d."createdAt" DESC
        LIMIT $3
      `,
      salonId,
      userId,
      limit,
    );

    return res.status(200).json({ items: rows });
  } catch (error) {
    console.error('Mobile notifications list error:', error);
    throw error;
  }
});

router.post('/notifications/:id/read', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;
  const deliveryId = Number(req.params.id);
  if (!Number.isInteger(deliveryId) || deliveryId <= 0) {
    throw new BusinessError('VALIDATION_FAILED', 'Invalid notification id.', 400);
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        WITH target AS (
          SELECT "notificationId"
          FROM "AppNotificationDelivery"
          WHERE "id" = $1 AND "salonId" = $2 AND "userId" = $3
          LIMIT 1
        )
        UPDATE "AppNotificationDelivery"
        SET "readAt" = COALESCE("readAt", NOW()), "updatedAt" = NOW()
        WHERE "salonId" = $2
          AND "userId" = $3
          AND (
            "id" = $1
            OR "notificationId" IN (SELECT "notificationId" FROM target)
          )
      `,
      deliveryId,
      salonId,
      userId,
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mobile notification read error:', error);
    throw error;
  }
});

router.post('/notifications/read-all', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const userId = req.user.userId;

  try {
    await prisma.$executeRawUnsafe(
      `
        UPDATE "AppNotificationDelivery"
        SET "readAt" = COALESCE("readAt", NOW()), "updatedAt" = NOW()
        WHERE "salonId" = $1 AND "userId" = $2 AND "channel" = 'IN_APP'::"NotificationDeliveryChannel"
      `,
      salonId,
      userId,
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mobile notifications read-all error:', error);
    throw error;
  }
});

/**
 * GET /me/dashboard  (mounted at /api/mobile)
 *
 * Returns the specialist dashboard payload for the *currently logged in*
 * membership. Resolves Staff via membershipId join (same pattern as
 * /staff-profile). Returns:
 *   - staff: identity for header rendering
 *   - today: { points, appointments[] }
 *   - month: { goal, progress, revenue, appointmentsCount }
 *
 * todayPoints is a simple gamification formula:
 *   per completed appointment = 10pt + floor(finalPrice / 100) bonus
 *
 * Returns 403 when the JWT has no membershipId. Returns 404 when no Staff row
 * is linked to that membership (e.g. owner without a staff profile).
 */
router.get('/me/dashboard', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId;
  const membershipId = Number(req.user.membershipId || 0);
  if (!membershipId) {
    throw new BusinessError('FORBIDDEN', 'Membership required.', 403);
  }

  const staff = await prisma.staff.findFirst({
    where: { salonId, membershipId },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      monthlyGoal: true,
      profileImageUrl: true,
      themeColor: true,
    },
  });
  if (!staff) {
    throw new BusinessError('NOT_FOUND', 'Linked staff profile not found.', 404);
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

  const [todayAppointments, monthAppointmentsCount, monthRevenueAgg] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        salonId,
        staffId: staff.id,
        startTime: { gte: todayStart, lt: todayEnd },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        notes: true,
        customerName: true,
        customerPhone: true,
        finalPrice: true,
        listPrice: true,
        service: { select: { id: true, name: true, price: true, duration: true } },
        customer: { select: { id: true, name: true, phone: true } },
        appointmentLines: {
          select: {
            id: true,
            finalPrice: true,
            listPrice: true,
            service: { select: { id: true, name: true, price: true, duration: true } },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
      orderBy: { startTime: 'asc' },
    }),
    prisma.appointment.count({
      where: {
        salonId,
        staffId: staff.id,
        startTime: { gte: monthStart, lt: monthEnd },
        status: 'COMPLETED',
      },
    }),
    prisma.appointment.aggregate({
      where: {
        salonId,
        staffId: staff.id,
        startTime: { gte: monthStart, lt: monthEnd },
        status: 'COMPLETED',
      },
      _sum: { finalPrice: true },
    }),
  ]);

  // Per-appointment price helper: prefer Appointment.finalPrice, then sum of
  // line finalPrice fallbacks, then the headline service.price as a last resort.
  function priceFor(appt: (typeof todayAppointments)[number]): number {
    if (typeof appt.finalPrice === 'number') return appt.finalPrice;
    if (appt.appointmentLines?.length) {
      return appt.appointmentLines.reduce((sum, line) => {
        const linePrice =
          typeof line.finalPrice === 'number'
            ? line.finalPrice
            : typeof line.listPrice === 'number'
              ? line.listPrice
              : (line.service?.price ?? 0);
        return sum + (linePrice || 0);
      }, 0);
    }
    if (typeof appt.listPrice === 'number') return appt.listPrice;
    return appt.service?.price ?? 0;
  }

  const todayPoints = todayAppointments
    .filter((a) => a.status === 'COMPLETED')
    .reduce((sum, a) => sum + 10 + Math.floor((priceFor(a) || 0) / 100), 0);

  const fmtTime = (d: Date | null | undefined) =>
    d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null;

  return res.status(200).json({
    staff: {
      id: staff.id,
      name: staff.name,
      firstName: staff.firstName,
      lastName: staff.lastName,
      profileImageUrl: staff.profileImageUrl,
      themeColor: staff.themeColor,
    },
    today: {
      points: todayPoints,
      appointments: todayAppointments.map((a) => {
        const services =
          a.appointmentLines?.length > 0
            ? a.appointmentLines
                .filter((l) => l.service)
                .map((l) => ({
                  id: l.service!.id,
                  name: l.service!.name,
                  duration: l.service!.duration,
                  price:
                    typeof l.finalPrice === 'number'
                      ? l.finalPrice
                      : typeof l.listPrice === 'number'
                        ? l.listPrice
                        : (l.service!.price ?? 0),
                }))
            : a.service
              ? [
                  {
                    id: a.service.id,
                    name: a.service.name,
                    duration: a.service.duration,
                    price:
                      typeof a.finalPrice === 'number'
                        ? a.finalPrice
                        : typeof a.listPrice === 'number'
                          ? a.listPrice
                          : (a.service.price ?? 0),
                  },
                ]
              : [];
        return {
          id: a.id,
          status: a.status,
          notes: a.notes,
          startTime: fmtTime(a.startTime),
          endTime: fmtTime(a.endTime),
          startAt: a.startTime?.toISOString() ?? null,
          endAt: a.endTime?.toISOString() ?? null,
          customerName: a.customer?.name || a.customerName || '',
          customerPhone: a.customer?.phone || a.customerPhone || '',
          totalPrice: priceFor(a),
          services,
        };
      }),
    },
    month: {
      goal: staff.monthlyGoal ?? 0,
      progress: monthAppointmentsCount,
      revenue: monthRevenueAgg._sum.finalPrice ?? 0,
      appointmentsCount: monthAppointmentsCount,
    },
  });
});

export default router;
