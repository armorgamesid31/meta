import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  buildBootstrapUser,
  buildCapabilities,
  buildFeatureFlags,
  buildSubscription,
} from '../services/mobileBootstrap.js';
import { createNotification, getDefaultNotificationPolicy } from '../services/notifications.js';
import { getPushProviderStatus } from '../services/pushProvider.js';
import { ACCESS_VERSION, ensureSalonAccessSeed, getEffectivePermissionSet } from '../services/accessControl.js';

const router = Router();

function maskPushToken(token: string): string {
  const normalized = String(token || '').trim();
  if (!normalized) return '';
  return normalized.length <= 8 ? normalized : `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

router.get('/bootstrap', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
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
          },
        },
      },
    });

    if (!user || !user.salon || user.salon.id !== req.user.salonId) {
      return res.status(404).json({ message: 'User or salon not found.' });
    }

    const normalizedWhatsapp = (user.salon.whatsappPhone || '').replace(/[^\d]/g, '');
    await ensureSalonAccessSeed(user.salon.id);
    const effectivePermissionSet = await getEffectivePermissionSet({
      salonId: user.salon.id,
      userId: user.id,
      role: user.role,
    });
    const permissions = Array.from(effectivePermissionSet).sort();

    const [settings, serviceCount, staffCount] = await prisma.$transaction([
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
    ]);

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
      },
      capabilities: buildCapabilities(user.role),
      featureFlags: buildFeatureFlags(user.role, user.salon.bookingMode, Boolean(normalizedWhatsapp), permissions),
      permissions,
      accessVersion: ACCESS_VERSION,
      subscription: buildSubscription(),
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
      notifications: {
        defaults: getDefaultNotificationPolicy(),
      },
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Mobile bootstrap error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/push/register', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
  const salonId = req.user.salonId;
  const userId = req.user.userId;

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const platform = typeof req.body?.platform === 'string' ? req.body.platform.trim().toUpperCase() : '';
  const appVersion = typeof req.body?.appVersion === 'string' ? req.body.appVersion.trim() : null;
  const deviceMeta = req.body?.deviceMeta ?? null;

  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
  }
  if (!platform) {
    return res.status(400).json({ message: 'platform is required.' });
  }

  try {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "PushDeviceToken"
          ("salonId", "userId", "platform", "token", "appVersion", "deviceMeta", "isActive", "lastSeenAt", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4, $5, $6::jsonb, true, NOW(), NOW(), NOW())
        ON CONFLICT ("platform", "token")
        DO UPDATE SET
          "salonId" = EXCLUDED."salonId",
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/push/unregister', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
  const salonId = req.user.salonId;
  const userId = req.user.userId;

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ message: 'token is required.' });

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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/push/status', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/push/test', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });

  try {
    const result = await createNotification({
      salonId: req.user.salonId,
      eventType: 'DAILY_MANAGER_REPORT',
      title: 'Kedy test bildirimi',
      body: 'Push sistemi bu cihaza test mesaji gonderdi.',
      payload: {
        route: 'notifications',
        source: 'manual_push_test',
        createdAt: new Date().toISOString(),
      },
      recipientUserIds: [req.user.userId],
    });

    return res.status(200).json({
      ok: true,
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/notification-preferences', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/notification-preferences', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/notifications', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/notifications/:id/read', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
  const salonId = req.user.salonId;
  const userId = req.user.userId;
  const deliveryId = Number(req.params.id);
  if (!Number.isInteger(deliveryId) || deliveryId <= 0) {
    return res.status(400).json({ message: 'Invalid notification id.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/notifications/read-all', authenticateToken, async (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
