import { prisma } from '../prisma.js';
import {
  ANDROID_PUSH_CHANNEL_APPOINTMENT_ID,
  ANDROID_PUSH_CHANNEL_BOOKING_CHANGE_ID,
  ANDROID_PUSH_CHANNEL_EOD_ID,
  ANDROID_PUSH_CHANNEL_HANDOVER_ID,
  ANDROID_PUSH_CHANNEL_ID,
  ANDROID_PUSH_CHANNEL_REPORT_ID,
  PushDeliveryStatus,
  PushProviderSource,
  getPushProviderStatus,
  sendPushMessages,
} from './pushProvider.js';

export type NotificationEventType =
  | 'HANDOVER_REQUIRED'
  | 'HANDOVER_REMINDER'
  | 'SAME_DAY_APPOINTMENT_CHANGE'
  | 'END_OF_DAY_MISSING_DATA'
  | 'DAILY_MANAGER_REPORT'
  | 'CAMPAIGN_AUTO_TRIGGER'
  | 'CAMPAIGN_MANUAL_SEND'
  | 'WAITLIST_OFFER_CREATED'
  | 'WAITLIST_OFFER_EXPIRED'
  | 'WAITLIST_OFFER_ACCEPTED'
  | 'WAITLIST_MATCH_FOUND';

type DeliveryStatus = 'PENDING' | 'SENT' | 'SKIPPED' | 'FAILED';
type NotificationRoute = 'conversations' | 'schedule' | 'analytics' | 'notifications';

type NotificationPolicy = {
  recipients?: Partial<Record<NotificationEventType, string[]>>;
  handoverReminderIntervalMinutes?: number;
  handoverReminderMaxCount?: number;
};

export interface NotificationDispatchResult {
  notificationId: number | null;
  recipientUserIds: number[];
  inAppDeliveryCount: number;
  pushDeliveryCount: number;
  pushDeliverySummary: Record<DeliveryStatus, number>;
  providerConfigured: boolean;
  providerSource: PushProviderSource;
  providerError: string | null;
}

const DEFAULT_RECIPIENTS: Record<NotificationEventType, string[]> = {
  // Handover akışı: müşteri biriyle konuşmak istiyorsa salondaki HERKES
  // (owner/manager/reception VE staff) anlık bilmeli — owner push iznini
  // vermemişse staff'ın telefonu çalsın diye STAFF de listede.
  HANDOVER_REQUIRED: ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'],
  HANDOVER_REMINDER: ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'],
  // Yeni randevu + randevu değişikliği/iptali personele de gitsin (Berkay, 2026-06-07):
  // owner/yönetici/resepsiyon dışında salon personeli de anlık görsün.
  SAME_DAY_APPOINTMENT_CHANGE: ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'],
  END_OF_DAY_MISSING_DATA: ['OWNER', 'MANAGER', 'RECEPTION', 'STAFF'],
  DAILY_MANAGER_REPORT: ['OWNER', 'MANAGER'],
  CAMPAIGN_AUTO_TRIGGER: ['OWNER', 'MANAGER', 'RECEPTION'],
  CAMPAIGN_MANUAL_SEND: ['OWNER', 'MANAGER', 'RECEPTION'],
  WAITLIST_OFFER_CREATED: ['OWNER', 'MANAGER', 'RECEPTION'],
  WAITLIST_OFFER_EXPIRED: ['OWNER', 'MANAGER', 'RECEPTION'],
  WAITLIST_OFFER_ACCEPTED: ['OWNER', 'MANAGER', 'RECEPTION'],
  WAITLIST_MATCH_FOUND: ['OWNER', 'MANAGER', 'RECEPTION'],
};

const DEFAULT_INTERVAL_MINUTES = Number(process.env.HANDOVER_REMINDER_INTERVAL_MINUTES || 30);
const DEFAULT_MAX_COUNT = Number(process.env.HANDOVER_REMINDER_MAX_COUNT || 6);

const LOCK_HANDOVER = 903_001;
const LOCK_DAILY = 903_002;

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function resolveNotificationRoute(
  eventType: NotificationEventType,
  payload?: Record<string, unknown> | null,
): NotificationRoute {
  const candidate = typeof payload?.route === 'string' ? payload.route.trim() : '';
  if (candidate === 'instagram-inbox' || candidate === 'conversations' || candidate === 'schedule' || candidate === 'analytics' || candidate === 'notifications') {
    return candidate === 'instagram-inbox' ? 'conversations' : candidate;
  }

  if (eventType === 'HANDOVER_REQUIRED' || eventType === 'HANDOVER_REMINDER') {
    return 'conversations';
  }
  if (eventType === 'SAME_DAY_APPOINTMENT_CHANGE' || eventType === 'END_OF_DAY_MISSING_DATA') {
    return 'schedule';
  }
  if (eventType === 'DAILY_MANAGER_REPORT') {
    return 'analytics';
  }
  return 'notifications';
}

function buildNotificationPayload(
  eventType: NotificationEventType,
  payload?: Record<string, unknown> | null,
): Record<string, unknown> {
  const route = resolveNotificationRoute(eventType, payload);
  return {
    ...(payload || {}),
    eventType,
    route,
  };
}

function resolveAndroidChannelId(
  eventType: NotificationEventType,
  payload?: Record<string, unknown> | null,
): string {
  if (eventType === 'DAILY_MANAGER_REPORT') {
    return ANDROID_PUSH_CHANNEL_REPORT_ID;
  }

  if (eventType === 'END_OF_DAY_MISSING_DATA') {
    return ANDROID_PUSH_CHANNEL_EOD_ID;
  }

  if (eventType === 'HANDOVER_REQUIRED' || eventType === 'HANDOVER_REMINDER') {
    return ANDROID_PUSH_CHANNEL_HANDOVER_ID;
  }

  if (eventType === 'SAME_DAY_APPOINTMENT_CHANGE') {
    const event = typeof payload?.event === 'string' ? payload.event.toUpperCase() : '';
    if (event === 'CREATED') {
      return ANDROID_PUSH_CHANNEL_APPOINTMENT_ID;
    }
    return ANDROID_PUSH_CHANNEL_BOOKING_CHANGE_ID;
  }

  if (eventType === 'WAITLIST_OFFER_ACCEPTED') {
    return ANDROID_PUSH_CHANNEL_APPOINTMENT_ID;
  }

  if (eventType === 'WAITLIST_OFFER_CREATED' || eventType === 'WAITLIST_OFFER_EXPIRED' || eventType === 'WAITLIST_MATCH_FOUND') {
    return ANDROID_PUSH_CHANNEL_BOOKING_CHANGE_ID;
  }

  return ANDROID_PUSH_CHANNEL_ID;
}

function summarizePushDeliveries(statuses: DeliveryStatus[]): Record<DeliveryStatus, number> {
  return statuses.reduce<Record<DeliveryStatus, number>>(
    (acc, status) => {
      acc[status] += 1;
      return acc;
    },
    {
      PENDING: 0,
      SENT: 0,
      SKIPPED: 0,
      FAILED: 0,
    },
  );
}

function getUnavailableProviderState(provider: ReturnType<typeof getPushProviderStatus>): {
  status: PushDeliveryStatus;
  reason: string;
} {
  if (provider.source === 'NONE') {
    return {
      status: 'SKIPPED',
      reason: 'push_provider_not_configured',
    };
  }

  return {
    status: 'FAILED',
    reason: provider.error || 'push_provider_initialization_failed',
  };
}

export function getDefaultNotificationPolicy(): NotificationPolicy {
  return {
    recipients: { ...DEFAULT_RECIPIENTS },
    handoverReminderIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
    handoverReminderMaxCount: DEFAULT_MAX_COUNT,
  };
}

export async function getSalonNotificationPolicy(salonId: number): Promise<NotificationPolicy> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "config" FROM "AutomationRule" WHERE "salonId" = $1 AND "key" = 'mobile_notification_policy' LIMIT 1`,
    salonId,
  );
  const raw = rows?.[0]?.config;
  const cfg = asObject(raw);
  const recipientsRaw = asObject(cfg.recipients);

  const recipients: Partial<Record<NotificationEventType, string[]>> = {};
  for (const key of Object.keys(DEFAULT_RECIPIENTS) as NotificationEventType[]) {
    const value = recipientsRaw[key];
    recipients[key] = Array.isArray(value)
      ? value
          .map((item) => String(item || '').toUpperCase().trim())
          .filter((item) => item.length > 0)
      : DEFAULT_RECIPIENTS[key];
  }

  const interval = Number(cfg.handoverReminderIntervalMinutes);
  const maxCount = Number(cfg.handoverReminderMaxCount);

  return {
    recipients,
    handoverReminderIntervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_MINUTES,
    handoverReminderMaxCount: Number.isFinite(maxCount) && maxCount > 0 ? maxCount : DEFAULT_MAX_COUNT,
  };
}

export async function upsertSalonNotificationPolicy(salonId: number, policy: NotificationPolicy): Promise<void> {
  const config = {
    recipients: policy.recipients || DEFAULT_RECIPIENTS,
    handoverReminderIntervalMinutes:
      Number.isFinite(Number(policy.handoverReminderIntervalMinutes)) && Number(policy.handoverReminderIntervalMinutes) > 0
        ? Number(policy.handoverReminderIntervalMinutes)
        : DEFAULT_INTERVAL_MINUTES,
    handoverReminderMaxCount:
      Number.isFinite(Number(policy.handoverReminderMaxCount)) && Number(policy.handoverReminderMaxCount) > 0
        ? Number(policy.handoverReminderMaxCount)
        : DEFAULT_MAX_COUNT,
  };

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "AutomationRule" ("salonId", "key", "name", "description", "config", "isEnabled", "createdAt", "updatedAt")
      VALUES ($1, 'mobile_notification_policy', 'Mobile Notification Policy', 'Role matrix and reminder policy', $2::jsonb, true, NOW(), NOW())
      ON CONFLICT ("salonId", "key")
      DO UPDATE SET "config" = EXCLUDED."config", "isEnabled" = true, "updatedAt" = NOW()
    `,
    salonId,
    JSON.stringify(config),
  );
}

async function getRecipientUserIds(salonId: number, eventType: NotificationEventType): Promise<number[]> {
  const policy = await getSalonNotificationPolicy(salonId);
  const targetRoles =
    (policy.recipients?.[eventType] && policy.recipients[eventType]!.length > 0
      ? policy.recipients[eventType]
      : DEFAULT_RECIPIENTS[eventType]) || [];

  const users = await prisma.$queryRawUnsafe<any[]>(
    // isActive filtresi: pasife alınmış (işten çıkmış) personel artık bildirim
    // ALICISI olmaz — eskiden filtre yoktu, eski çalışan müşteri/randevu
    // bildirimi almaya devam ediyordu (KVKK/veri sızıntısı).
    `SELECT "id", UPPER(COALESCE("role", 'STAFF')) AS "role" FROM "SalonUser" WHERE "salonId" = $1 AND COALESCE("isActive", true) = true`,
    salonId,
  );

  const selected = users.filter((row) => targetRoles.includes(String(row.role || '').toUpperCase()));
  return selected.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
}

function isUserEventEnabled(eventConfig: Record<string, any> | null, eventType: NotificationEventType): boolean {
  if (!eventConfig) return true;
  if (typeof eventConfig.masterEnabled === 'boolean' && !eventConfig.masterEnabled) return false;
  const byEvent = asObject(eventConfig.events);
  if (typeof byEvent[eventType] === 'boolean') return Boolean(byEvent[eventType]);
  return true;
}

async function getEligibleUserIdsByPreference(
  salonId: number,
  userIds: number[],
  eventType: NotificationEventType,
): Promise<number[]> {
  if (!userIds.length) return [];

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "userId", "masterEnabled", "eventConfig"
      FROM "UserNotificationPreference"
      WHERE "salonId" = $1 AND "userId" = ANY($2::int[])
    `,
    salonId,
    userIds,
  );

  const prefByUser = new Map<number, { masterEnabled: boolean; eventConfig: Record<string, any> | null }>();
  for (const row of rows) {
    prefByUser.set(Number(row.userId), {
      masterEnabled: row.masterEnabled !== false,
      eventConfig: (row.eventConfig as Record<string, any>) || null,
    });
  }

  return userIds.filter((userId) => {
    const pref = prefByUser.get(userId);
    if (!pref) return true;
    if (!pref.masterEnabled) return false;
    return isUserEventEnabled(pref.eventConfig, eventType);
  });
}

// Per-event-type emoji prefixes. Keeping the table here (rather than
// scattered across call sites) so the visual language of notifications
// stays consistent — every "Yeni randevu" looks the same regardless of
// who triggers createNotification.
const EVENT_TYPE_EMOJI: Record<NotificationEventType, string> = {
  HANDOVER_REQUIRED: '🚨',
  HANDOVER_REMINDER: '⏰',
  SAME_DAY_APPOINTMENT_CHANGE: '📅',
  END_OF_DAY_MISSING_DATA: '📝',
  DAILY_MANAGER_REPORT: '📊',
  CAMPAIGN_AUTO_TRIGGER: '🚀',
  CAMPAIGN_MANUAL_SEND: '📣',
  WAITLIST_OFFER_CREATED: '🎟️',
  WAITLIST_OFFER_EXPIRED: '⌛',
  WAITLIST_OFFER_ACCEPTED: '✅',
  WAITLIST_MATCH_FOUND: '✨',
};

// Tiny in-memory cache for salon names. The notification path runs in
// hot loops (handover reminder sweep, daily report) and looking up the
// same salon dozens of times per minute would be wasteful. 60s TTL is
// short enough that rename operations show up quickly without
// invalidation plumbing.
const SALON_NAME_TTL_MS = 60_000;
const salonNameCache = new Map<number, { name: string | null; expiresAt: number }>();

async function getSalonName(salonId: number): Promise<string | null> {
  const cached = salonNameCache.get(salonId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.name;
  }
  const row = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true },
  });
  const name = (row?.name || '').trim() || null;
  salonNameCache.set(salonId, { name, expiresAt: now + SALON_NAME_TTL_MS });
  return name;
}

/**
 * Decorate the raw title + body coming from the call site so every push
 * the user sees follows the same shape:
 *
 *   title: `<emoji> <event title>`
 *   body:  `<original body>\n— <Salon name>`
 *
 * The salon name lives in the body rather than the title because Android
 * truncates titles aggressively (~30–40 chars) while bodies render two
 * lines on the lock screen. Putting the salon name as a trailing line
 * keeps the title scan-friendly and makes the multi-salon disambiguation
 * obvious without crowding the headline.
 */
async function decorateForDisplay(
  salonId: number,
  eventType: NotificationEventType,
  title: string,
  body: string,
): Promise<{ title: string; body: string }> {
  const emoji = EVENT_TYPE_EMOJI[eventType];
  const prefixedTitle = emoji && !title.startsWith(emoji) ? `${emoji} ${title}` : title;

  const salonName = await getSalonName(salonId);
  const decoratedBody = salonName
    ? `${body}\n— ${salonName}`
    : body;

  return { title: prefixedTitle, body: decoratedBody };
}

export async function createNotification(input: {
  salonId: number;
  eventType: NotificationEventType;
  title: string;
  body: string;
  payload?: Record<string, unknown> | null;
  recipientUserIds?: number[];
}): Promise<NotificationDispatchResult> {
  const recipientIdsRaw = input.recipientUserIds?.length
    ? input.recipientUserIds
    : await getRecipientUserIds(input.salonId, input.eventType);

  const recipientUserIds = await getEligibleUserIdsByPreference(input.salonId, recipientIdsRaw, input.eventType);
  const provider = getPushProviderStatus();

  // Decorate once so both the in-app row (stored in AppNotification) and
  // the push payload (sent to FCM) carry the same emoji + salon line.
  const decorated = await decorateForDisplay(
    input.salonId,
    input.eventType,
    input.title,
    input.body,
  );
  const displayTitle = decorated.title;
  const displayBody = decorated.body;

  if (!recipientUserIds.length) {
    return {
      notificationId: null,
      recipientUserIds: [],
      inAppDeliveryCount: 0,
      pushDeliveryCount: 0,
      pushDeliverySummary: summarizePushDeliveries([]),
      providerConfigured: provider.configured,
      providerSource: provider.source,
      providerError: provider.error,
    };
  }

  const payload = buildNotificationPayload(input.eventType, input.payload);
  const androidChannelId = resolveAndroidChannelId(input.eventType, payload);
  let notificationId: number | null = null;
  let inAppDeliveryCount = 0;
  let pushTargets: Array<{
    deliveryId: number;
    tokenId: number;
    userId: number;
    token: string;
    platform: string;
  }> = [];

  await prisma.$transaction(async (tx) => {
    const createdRows = await tx.$queryRawUnsafe<any[]>(
      `
        INSERT INTO "AppNotification" ("salonId", "eventType", "title", "body", "payload", "createdAt", "expiresAt")
        VALUES ($1, $2::"NotificationEventType", $3, $4, $5::jsonb, NOW(), NOW() + INTERVAL '30 days')
        RETURNING "id"
      `,
      input.salonId,
      input.eventType,
      displayTitle,
      displayBody,
      JSON.stringify(payload),
    );

    notificationId = Number(createdRows?.[0]?.id);
    if (!notificationId) return;

    inAppDeliveryCount = await tx.$executeRawUnsafe(
      `
        INSERT INTO "AppNotificationDelivery" ("notificationId", "salonId", "userId", "channel", "status", "createdAt", "updatedAt")
        SELECT $1, $2, u."id", 'IN_APP'::"NotificationDeliveryChannel", 'SENT'::"NotificationDeliveryStatus", NOW(), NOW()
        FROM "SalonUser" u
        WHERE u."id" = ANY($3::int[])
      `,
      notificationId,
      input.salonId,
      recipientUserIds,
    );

    const providerState = provider.configured
      ? { status: 'PENDING' as PushDeliveryStatus, reason: null as string | null }
      : getUnavailableProviderState(provider);

    pushTargets = await tx.$queryRawUnsafe<any[]>(
      `
        WITH tokens AS (
          SELECT t."id" AS "pushTokenId", t."userId", t."token", t."platform"
          FROM "PushDeviceToken" t
          WHERE t."salonId" = $1
            AND t."isActive" = true
            AND t."userId" = ANY($2::int[])
        ),
        inserted AS (
          INSERT INTO "AppNotificationDelivery"
            ("notificationId", "salonId", "userId", "pushTokenId", "channel", "status", "failureReason", "createdAt", "updatedAt")
          SELECT
            $3,
            $1,
            t."userId",
            t."pushTokenId",
            'PUSH'::"NotificationDeliveryChannel",
            $4::"NotificationDeliveryStatus",
            $5,
            NOW(),
            NOW()
          FROM tokens t
          RETURNING "id", "pushTokenId", "userId"
        )
        SELECT
          i."id" AS "deliveryId",
          i."pushTokenId" AS "tokenId",
          i."userId",
          t."token",
          t."platform"
        FROM inserted i
        INNER JOIN tokens t ON t."pushTokenId" = i."pushTokenId"
      `,
      input.salonId,
      recipientUserIds,
      notificationId,
      providerState.status,
      providerState.reason,
    );
  });

  if (!notificationId) {
    return {
      notificationId: null,
      recipientUserIds,
      inAppDeliveryCount,
      pushDeliveryCount: 0,
      pushDeliverySummary: summarizePushDeliveries([]),
      providerConfigured: provider.configured,
      providerSource: provider.source,
      providerError: provider.error,
    };
  }

  let pushStatuses: DeliveryStatus[] = [];

  if (provider.configured && pushTargets.length > 0) {
    const sendResult = await sendPushMessages(
      pushTargets.map((target) => ({
        deliveryId: Number(target.deliveryId),
        tokenId: Number(target.tokenId),
        token: String(target.token),
        title: displayTitle,
        body: displayBody,
        data: {
          ...payload,
          notificationId,
          deliveryId: Number(target.deliveryId),
          salonId: input.salonId,
          androidChannelId,
        },
        androidChannelId,
      })),
    );

    pushStatuses = sendResult.results.map((item) => item.status as DeliveryStatus);

    await prisma.$transaction(async (tx) => {
      for (const result of sendResult.results) {
        await tx.$executeRawUnsafe(
          `
            UPDATE "AppNotificationDelivery"
            SET
              "status" = $2::"NotificationDeliveryStatus",
              "providerMessageId" = $3,
              "failureReason" = $4,
              "updatedAt" = NOW()
            WHERE "id" = $1
          `,
          result.deliveryId,
          result.status,
          result.providerMessageId,
          result.failureReason,
        );
      }

      const tokenIdsToDeactivate = sendResult.results
        .filter((item) => item.deactivateToken)
        .map((item) => item.tokenId)
        .filter((value, index, array) => array.indexOf(value) === index);

      if (tokenIdsToDeactivate.length > 0) {
        await tx.$executeRawUnsafe(
          `
            UPDATE "PushDeviceToken"
            SET "isActive" = false, "updatedAt" = NOW()
            WHERE "id" = ANY($1::int[])
          `,
          tokenIdsToDeactivate,
        );
      }
    });
  } else {
    const fallbackStatus = provider.configured ? 'PENDING' : getUnavailableProviderState(provider).status;
    pushStatuses = pushTargets.map(() => fallbackStatus as DeliveryStatus);
  }

  return {
    notificationId,
    recipientUserIds,
    inAppDeliveryCount,
    pushDeliveryCount: pushTargets.length,
    pushDeliverySummary: summarizePushDeliveries(pushStatuses),
    providerConfigured: provider.configured,
    providerSource: provider.source,
    providerError: provider.error,
  };
}

export async function markHandoverTriggered(input: {
  salonId: number;
  channel: 'INSTAGRAM' | 'WHATSAPP';
  conversationKey: string;
  customerName?: string | null;
}): Promise<void> {
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "state", "repeatCount"
      FROM "HandoverAlertState"
      WHERE "salonId" = $1 AND "channel" = $2::"ChannelType" AND "conversationKey" = $3
      LIMIT 1
    `,
    input.salonId,
    input.channel,
    input.conversationKey,
  );

  if (existing.length > 0 && existing[0].state === 'ACTIVE') {
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "HandoverAlertState"
        ("salonId", "channel", "conversationKey", "state", "repeatCount", "firstTriggeredAt", "lastTriggeredAt", "createdAt", "updatedAt")
      VALUES
        ($1, $2::"ChannelType", $3, 'ACTIVE'::"HandoverAlertLifecycleState", 0, NOW(), NOW(), NOW(), NOW())
      ON CONFLICT ("salonId", "channel", "conversationKey")
      DO UPDATE SET
        "state" = 'ACTIVE'::"HandoverAlertLifecycleState",
        "repeatCount" = 0,
        "firstTriggeredAt" = COALESCE("HandoverAlertState"."firstTriggeredAt", NOW()),
        "lastTriggeredAt" = NOW(),
        "stoppedAt" = NULL,
        "updatedAt" = NOW()
    `,
    input.salonId,
    input.channel,
    input.conversationKey,
  );

  const channelLabel = input.channel === 'WHATSAPP' ? 'WhatsApp' : 'Instagram';
  await createNotification({
    salonId: input.salonId,
    eventType: 'HANDOVER_REQUIRED',
    title: 'Müşteri seni bekliyor',
    body: input.customerName
      ? `${input.customerName} • ${channelLabel}\nKonuşmayı devralman gerekiyor.`
      : `${channelLabel} konuşması beklemede — devralman gerekiyor.`,
    payload: {
      channel: input.channel,
      conversationKey: input.conversationKey,
      customerName: input.customerName || null,
    },
  });
}

export async function resolveHandoverAlert(input: {
  salonId: number;
  channel: 'INSTAGRAM' | 'WHATSAPP';
  conversationKey: string;
  byHumanMessage?: boolean;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
      UPDATE "HandoverAlertState"
      SET
        "state" = 'RESOLVED'::"HandoverAlertLifecycleState",
        "stoppedAt" = NOW(),
        "lastHumanMessageAt" = CASE WHEN $4::boolean THEN NOW() ELSE "lastHumanMessageAt" END,
        "updatedAt" = NOW()
      WHERE "salonId" = $1 AND "channel" = $2::"ChannelType" AND "conversationKey" = $3
    `,
    input.salonId,
    input.channel,
    input.conversationKey,
    Boolean(input.byHumanMessage),
  );
}

export async function notifySameDayAppointmentChange(input: {
  salonId: number;
  event: 'CREATED' | 'UPDATED' | 'CANCELLED';
  appointmentId: number;
  customerName: string;
  serviceName?: string | null;
  startTime: Date;
  timezone?: string | null;
}): Promise<void> {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: input.appointmentId,
      salonId: input.salonId,
    },
    select: {
      source: true,
    },
  });
  if (appointment?.source === 'IMPORT') {
    return;
  }

  const tz = input.timezone || 'Europe/Istanbul';
  const now = new Date();

  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input.startTime);

  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  if (dayKey !== todayKey) {
    return;
  }

  const eventLabel =
    input.event === 'CREATED' ? 'Yeni randevu' :
    input.event === 'UPDATED' ? 'Randevu güncellendi' :
    'Randevu iptal edildi';

  const startTimeStr = new Intl.DateTimeFormat('tr-TR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(input.startTime);

  await createNotification({
    salonId: input.salonId,
    eventType: 'SAME_DAY_APPOINTMENT_CHANGE',
    title: eventLabel,
    body: `${startTimeStr} • ${input.customerName}\n${input.serviceName || 'Hizmet'}`,
    payload: {
      event: input.event,
      appointmentId: input.appointmentId,
      startTime: input.startTime.toISOString(),
    },
  });
}

async function tryAdvisoryLock(key: number): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT pg_try_advisory_lock($1) AS locked`, key);
  return Boolean(rows?.[0]?.locked);
}

async function advisoryUnlock(key: number): Promise<void> {
  try {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock($1)`, key);
  } catch {
    // ignore
  }
}

export async function runHandoverReminderSweep(): Promise<void> {
  const locked = await tryAdvisoryLock(LOCK_HANDOVER);
  if (!locked) return;

  try {
    const activeRows = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT h."salonId", h."channel", h."conversationKey", h."repeatCount", h."lastTriggeredAt", cs."mode", cs."profileName"
        FROM "HandoverAlertState" h
        LEFT JOIN "ConversationState" cs
          ON cs."salonId" = h."salonId"
         AND cs."channel" = h."channel"
         AND cs."conversationKey" = h."conversationKey"
        WHERE h."state" = 'ACTIVE'::"HandoverAlertLifecycleState"
      `,
    );

    for (const row of activeRows) {
      const salonId = Number(row.salonId);
      const policy = await getSalonNotificationPolicy(salonId);
      const intervalMinutes = Number(policy.handoverReminderIntervalMinutes || DEFAULT_INTERVAL_MINUTES);
      const maxCount = Number(policy.handoverReminderMaxCount || DEFAULT_MAX_COUNT);
      const repeatCount = Number(row.repeatCount || 0);

      if (row.mode !== 'HUMAN_PENDING' && row.mode !== 'HUMAN_ACTIVE') {
        await resolveHandoverAlert({
          salonId,
          channel: row.channel,
          conversationKey: row.conversationKey,
        });
        continue;
      }

      if (repeatCount >= maxCount) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE "HandoverAlertState"
            SET "state" = 'EXPIRED'::"HandoverAlertLifecycleState", "stoppedAt" = NOW(), "updatedAt" = NOW()
            WHERE "salonId" = $1 AND "channel" = $2::"ChannelType" AND "conversationKey" = $3
          `,
          salonId,
          row.channel,
          row.conversationKey,
        );
        continue;
      }

      const lastTriggered = row.lastTriggeredAt ? new Date(row.lastTriggeredAt) : null;
      const nextAt = lastTriggered ? new Date(lastTriggered.getTime() + intervalMinutes * 60 * 1000) : new Date(0);
      if (nextAt.getTime() > Date.now()) {
        continue;
      }

      const reminderChannelLabel = row.channel === 'WHATSAPP' ? 'WhatsApp' : 'Instagram';
      await createNotification({
        salonId,
        eventType: 'HANDOVER_REMINDER',
        title: 'Hatırlatma',
        body: row.profileName
          ? `${row.profileName} • ${reminderChannelLabel}\nKonuşma hâlâ seni bekliyor.`
          : `${reminderChannelLabel} konuşması hâlâ seni bekliyor.`,
        payload: {
          channel: row.channel,
          conversationKey: row.conversationKey,
          repeatCount: repeatCount + 1,
        },
      });

      await prisma.$executeRawUnsafe(
        `
          UPDATE "HandoverAlertState"
          SET "repeatCount" = COALESCE("repeatCount", 0) + 1,
              "lastTriggeredAt" = NOW(),
              "updatedAt" = NOW()
          WHERE "salonId" = $1 AND "channel" = $2::"ChannelType" AND "conversationKey" = $3
        `,
        salonId,
        row.channel,
        row.conversationKey,
      );
    }
  } finally {
    await advisoryUnlock(LOCK_HANDOVER);
  }
}

function localTimeParts(date: Date, timezone: string): { dayKey: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  return {
    dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    hour,
    minute,
  };
}

export async function runDailyNotificationSweep(): Promise<void> {
  const locked = await tryAdvisoryLock(LOCK_DAILY);
  if (!locked) return;

  try {
    const salons = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT s."id", COALESCE(ss."timezone", 'Europe/Istanbul') AS "timezone", COALESCE(ss."workEndHour", 18) AS "workEndHour"
        FROM "Salon" s
        LEFT JOIN "SalonSettings" ss ON ss."salonId" = s."id"
      `,
    );

    const now = new Date();
    for (const salon of salons) {
      const salonId = Number(salon.id);
      const timezone = String(salon.timezone || 'Europe/Istanbul');
      const workEndHour = Number(salon.workEndHour || 18);

      const local = localTimeParts(now, timezone);
      const currentMinute = local.hour * 60 + local.minute;
      // After workEndHour + 5 minutes we begin evaluating "is the day
      // fully closed?". The sweep tick runs every 10 minutes, and we
      // gate retries via SalonDailyReportState (reminderCount + 30-min
      // cooldown), so the only window check we need is "are we past
      // the cutoff at all?".
      const evaluationStartMinute = workEndHour * 60 + 5;
      const isPastEod = currentMinute >= evaluationStartMinute;
      if (!isPastEod) continue;

      // Lazily create today's state row, then read its current flags.
      // ON CONFLICT keeps the row idempotent across the 10-min ticks.
      const stateRows = await prisma.$queryRawUnsafe<any[]>(
        `
          INSERT INTO "SalonDailyReportState" ("salonId", "reportDate", "createdAt", "updatedAt")
          VALUES ($1, $2, NOW(), NOW())
          ON CONFLICT ("salonId", "reportDate")
          DO UPDATE SET "updatedAt" = NOW()
          RETURNING "reportSentAt", "lastReminderAt", "reminderCount"
        `,
        salonId,
        local.dayKey,
      );

      const state = stateRows?.[0];
      if (!state) continue;
      if (state.reportSentAt) {
        // Day already closed and reported — nothing left to do for
        // this salon today.
        continue;
      }

      const missingRows = await prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            SUM(CASE WHEN a."status" = 'BOOKED' THEN 1 ELSE 0 END) AS "bookedCount",
            SUM(CASE WHEN a."status" = 'COMPLETED' AND a."paymentMethod" IS NULL THEN 1 ELSE 0 END) AS "missingPaymentCount"
          FROM "Appointment" a
          WHERE a."salonId" = $1
            AND COALESCE(a."source", 'CUSTOMER') <> 'IMPORT'
            AND DATE((a."startTime" AT TIME ZONE $2)) = DATE((NOW() AT TIME ZONE $2))
        `,
        salonId,
        timezone,
      );

      const bookedCount = Number(missingRows?.[0]?.bookedCount || 0);
      const missingPaymentCount = Number(missingRows?.[0]?.missingPaymentCount || 0);
      const unfinishedTotal = bookedCount + missingPaymentCount;

      if (unfinishedTotal > 0) {
        const reminderCount = Number(state.reminderCount || 0);
        const lastReminderAt = state.lastReminderAt ? new Date(state.lastReminderAt) : null;
        const minutesSinceLast = lastReminderAt
          ? (Date.now() - lastReminderAt.getTime()) / 60000
          : Number.POSITIVE_INFINITY;

        // Cap at 3 nudges with a 30-min cooldown so a long-running open
        // day doesn't spam the staff at every tick.
        if (reminderCount < 3 && minutesSinceLast >= 30) {
          const missingParts: string[] = [];
          if (bookedCount > 0) missingParts.push(`${bookedCount} randevu durumu`);
          if (missingPaymentCount > 0) missingParts.push(`${missingPaymentCount} ödeme tipi`);

          await createNotification({
            salonId,
            eventType: 'END_OF_DAY_MISSING_DATA',
            title: 'Gün sonu kapatma',
            body: `Eksik kalan: ${missingParts.join(' · ')}\nGün sonu raporu için randevuları tamamla.`,
            payload: {
              bookedCount,
              missingPaymentCount,
              dayKey: local.dayKey,
              reminderCount: reminderCount + 1,
            },
          });

          await prisma.$executeRawUnsafe(
            `
              UPDATE "SalonDailyReportState"
              SET "reminderCount" = "reminderCount" + 1,
                  "lastReminderAt" = NOW(),
                  "updatedAt" = NOW()
              WHERE "salonId" = $1 AND "reportDate" = $2
            `,
            salonId,
            local.dayKey,
          );
        }
        continue;
      }

      // Everything is finalized — generate the report and lock it in.
      const metricsRows = await prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            COUNT(*) AS "total",
            SUM(CASE WHEN a."status" = 'COMPLETED' THEN 1 ELSE 0 END) AS "completed",
            SUM(CASE WHEN a."status" = 'CANCELLED' THEN 1 ELSE 0 END) AS "cancelled",
            SUM(CASE WHEN a."status" = 'NO_SHOW' THEN 1 ELSE 0 END) AS "noShow",
            SUM(CASE WHEN a."status" = 'COMPLETED' THEN COALESCE(s."price", 0) ELSE 0 END) AS "revenue"
          FROM "Appointment" a
          LEFT JOIN "Service" s ON s."id" = a."serviceId"
          WHERE a."salonId" = $1
            AND COALESCE(a."source", 'CUSTOMER') <> 'IMPORT'
            AND DATE((a."startTime" AT TIME ZONE $2)) = DATE((NOW() AT TIME ZONE $2))
        `,
        salonId,
        timezone,
      );

      const total = Number(metricsRows?.[0]?.total || 0);
      const completed = Number(metricsRows?.[0]?.completed || 0);
      const cancelled = Number(metricsRows?.[0]?.cancelled || 0);
      const noShow = Number(metricsRows?.[0]?.noShow || 0);
      const revenue = Number(metricsRows?.[0]?.revenue || 0);

      const revenueFmt = new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        maximumFractionDigits: 0,
      }).format(revenue);

      await createNotification({
        salonId,
        eventType: 'DAILY_MANAGER_REPORT',
        title: 'Günlük özet hazır',
        body: `${completed}/${total} tamamlandı • ${revenueFmt} ciro\nİptal ${cancelled} · No-show ${noShow}`,
        payload: { dayKey: local.dayKey, total, completed, cancelled, noShow, revenue },
      });

      await prisma.$executeRawUnsafe(
        `
          UPDATE "SalonDailyReportState"
          SET "reportSentAt" = NOW(),
              "updatedAt" = NOW()
          WHERE "salonId" = $1 AND "reportDate" = $2
        `,
        salonId,
        local.dayKey,
      );
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM "AppNotification" WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()`
    );
  } finally {
    await advisoryUnlock(LOCK_DAILY);
  }
}

let started = false;
let handoverTimer: NodeJS.Timeout | null = null;
let dailyTimer: NodeJS.Timeout | null = null;

export function startNotificationJobs(): void {
  if (started) return;
  started = true;

  handoverTimer = setInterval(() => {
    runHandoverReminderSweep().catch((error) => {
      console.error('Handover reminder sweep error:', error);
    });
  }, 5 * 60 * 1000);

  dailyTimer = setInterval(() => {
    runDailyNotificationSweep().catch((error) => {
      console.error('Daily notification sweep error:', error);
    });
  }, 10 * 60 * 1000);

  runHandoverReminderSweep().catch(() => undefined);
  runDailyNotificationSweep().catch(() => undefined);
}

export function stopNotificationJobs(): void {
  if (handoverTimer) {
    clearInterval(handoverTimer);
    handoverTimer = null;
  }
  if (dailyTimer) {
    clearInterval(dailyTimer);
    dailyTimer = null;
  }
  started = false;
}
