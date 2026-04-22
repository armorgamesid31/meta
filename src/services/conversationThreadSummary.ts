import {
  ChannelType,
  InboundMessageStatus,
  MessageEventDirection,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { normalizeInstagramIdentity } from './identityService.js';

type UpsertConversationThreadSummaryInput = {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  externalAccountId?: string | null;
  customerName?: string | null;
  messageType: string;
  text?: string | null;
  direction: MessageEventDirection;
  eventTimestamp: Date;
  processingStatus?: InboundMessageStatus | null;
  rawPayload: Prisma.InputJsonValue;
  incrementCounters: boolean;
};

type BackfillConversationThreadSummaryInput = {
  salonId: number;
  channel?: ChannelType | null;
  scanLimit?: number;
};

type InstagramProfile = {
  name: string | null;
  username: string | null;
  profilePicUrl: string | null;
};

type AggregatedSummary = {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  customerName: string | null;
  profileUsername: string | null;
  profilePicUrl: string | null;
  lastMessageType: string;
  lastMessageText: string | null;
  lastDirection: MessageEventDirection;
  lastEventTimestamp: Date;
  unreadCount: number;
  messageCount: number;
  hasHandoverRequest: boolean;
};

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function extractRawConversationKey(channel: ChannelType, value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(`${channel}:`)) {
    return trimmed.slice(channel.length + 1).trim();
  }
  return trimmed;
}

function isEchoMessageType(messageType: string): boolean {
  return (messageType || '').trim().toLowerCase().startsWith('echo_');
}

function extractInstagramActors(rawPayload: unknown): { senderId: string | null; recipientId: string | null; isEcho: boolean } {
  const raw = asObject(rawPayload);
  const entry = Array.isArray(raw.entry) ? asObject(raw.entry[0]) : {};
  const messaging = Array.isArray(entry.messaging) ? asObject(entry.messaging[0]) : {};
  const message = asObject(messaging.message);
  const sender = asObject(messaging.sender);
  const recipient = asObject(messaging.recipient);

  return {
    senderId: typeof sender.id === 'string' ? sender.id.trim() : null,
    recipientId: typeof recipient.id === 'string' ? recipient.id.trim() : null,
    isEcho: message.is_echo === true,
  };
}

function extractInstagramProfile(rawPayload: unknown): InstagramProfile {
  const raw = asObject(rawPayload);
  const profile = asObject(raw.instagramProfile);
  const fallback = asObject(raw.channelProfile);
  const source = Object.keys(profile).length ? profile : fallback;

  const asString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  return {
    name:
      asString(source.name) ||
      asString(raw.profileName) ||
      asString(raw.profile_name) ||
      asString(raw.customerName),
    username:
      asString(source.username) ||
      asString(raw.profileUsername) ||
      asString(raw.profile_username),
    profilePicUrl:
      asString(source.profile_pic) ||
      asString(source.profilePic) ||
      asString(source.profilePictureUrl) ||
      asString(raw.profilePictureUrl) ||
      asString(raw.profile_picture_url) ||
      asString(raw.profilePicUrl),
  };
}

function resolveConversationSummaryKey(input: {
  channel: ChannelType;
  conversationKey: string;
  messageType: string;
  externalAccountId?: string | null;
  rawPayload: unknown;
}): string {
  const rawKey = extractRawConversationKey(input.channel, input.conversationKey);

  if (input.channel === 'WHATSAPP') {
    return rawKey;
  }

  const normalizeId = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return normalizeInstagramIdentity(trimmed) || trimmed;
  };

  const actors = extractInstagramActors(input.rawPayload);
  const echoByType = isEchoMessageType(input.messageType) || actors.isEcho;
  const primaryActor = normalizeId(echoByType ? actors.recipientId : actors.senderId);
  const secondaryActor = normalizeId(echoByType ? actors.senderId : actors.recipientId);
  const normalizedExt = normalizeId(input.externalAccountId);
  const normalizedKey = normalizeId(rawKey);

  return primaryActor || secondaryActor || normalizedExt || normalizedKey || rawKey;
}

function isHandoverMessageType(messageType: string): boolean {
  return (messageType || '').trim().toLowerCase() === 'handover_request';
}

export async function upsertConversationThreadSummaryInTx(
  tx: Prisma.TransactionClient,
  input: UpsertConversationThreadSummaryInput,
): Promise<void> {
  const summaryKey = resolveConversationSummaryKey({
    channel: input.channel,
    conversationKey: input.conversationKey,
    messageType: input.messageType,
    externalAccountId: input.externalAccountId,
    rawPayload: input.rawPayload,
  });

  if (!summaryKey) {
    return;
  }

  const incomingCustomerName = typeof input.customerName === 'string' && input.customerName.trim()
    ? input.customerName.trim()
    : null;
  const incomingText = typeof input.text === 'string' && input.text.trim() ? input.text.trim() : null;
  const incomingProfile = input.channel === 'INSTAGRAM' ? extractInstagramProfile(input.rawPayload) : null;
  const unreadDelta = input.incrementCounters && input.processingStatus !== 'DONE' ? 1 : 0;
  const messageDelta = input.incrementCounters ? 1 : 0;

  const existing = await tx.conversationThreadSummary.findUnique({
    where: {
      salonId_channel_conversationKey: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: summaryKey,
      },
    },
  });

  if (!existing) {
    await tx.conversationThreadSummary.create({
      data: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: summaryKey,
        customerName: incomingCustomerName || incomingProfile?.name || null,
        profileUsername: incomingProfile?.username || null,
        profilePicUrl: incomingProfile?.profilePicUrl || null,
        lastMessageType: input.messageType,
        lastMessageText: incomingText,
        lastDirection: input.direction,
        lastEventTimestamp: input.eventTimestamp,
        unreadCount: unreadDelta,
        messageCount: messageDelta,
        hasHandoverRequest: isHandoverMessageType(input.messageType),
      },
    });
    return;
  }

  const isIncomingNewer = input.eventTimestamp.getTime() >= existing.lastEventTimestamp.getTime();

  await tx.conversationThreadSummary.update({
    where: {
      salonId_channel_conversationKey: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: summaryKey,
      },
    },
    data: {
      messageCount: messageDelta ? { increment: messageDelta } : undefined,
      unreadCount: unreadDelta ? { increment: unreadDelta } : undefined,
      hasHandoverRequest: existing.hasHandoverRequest || isHandoverMessageType(input.messageType),
      customerName: existing.customerName || incomingCustomerName || incomingProfile?.name || null,
      profileUsername: existing.profileUsername || incomingProfile?.username || null,
      profilePicUrl: existing.profilePicUrl || incomingProfile?.profilePicUrl || null,
      ...(isIncomingNewer
        ? {
            lastMessageType: input.messageType,
            lastMessageText: incomingText,
            lastDirection: input.direction,
            lastEventTimestamp: input.eventTimestamp,
          }
        : {}),
    },
  });
}

function applyRowToAggregate(
  aggregate: Map<string, AggregatedSummary>,
  row: {
    salonId: number;
    channel: ChannelType;
    conversationKey: string;
    externalAccountId: string | null;
    customerName: string | null;
    messageType: string;
    text: string | null;
    direction: MessageEventDirection;
    eventTimestamp: Date;
    processingStatus: InboundMessageStatus | null;
    rawPayload: Prisma.JsonValue;
  },
): void {
  const key = resolveConversationSummaryKey({
    channel: row.channel,
    conversationKey: row.conversationKey,
    messageType: row.messageType,
    externalAccountId: row.externalAccountId,
    rawPayload: row.rawPayload,
  });
  if (!key) return;

  const mapKey = `${row.salonId}:${row.channel}:${key}`;
  const profile = row.channel === 'INSTAGRAM' ? extractInstagramProfile(row.rawPayload) : null;
  const customerName = typeof row.customerName === 'string' && row.customerName.trim()
    ? row.customerName.trim()
    : profile?.name || null;
  const rowText = typeof row.text === 'string' && row.text.trim() ? row.text.trim() : null;

  const current = aggregate.get(mapKey);
  if (!current) {
    aggregate.set(mapKey, {
      salonId: row.salonId,
      channel: row.channel,
      conversationKey: key,
      customerName,
      profileUsername: profile?.username || null,
      profilePicUrl: profile?.profilePicUrl || null,
      lastMessageType: row.messageType,
      lastMessageText: rowText,
      lastDirection: row.direction,
      lastEventTimestamp: row.eventTimestamp,
      unreadCount: row.processingStatus !== 'DONE' ? 1 : 0,
      messageCount: 1,
      hasHandoverRequest: isHandoverMessageType(row.messageType),
    });
    return;
  }

  current.messageCount += 1;
  if (row.processingStatus !== 'DONE') {
    current.unreadCount += 1;
  }
  if (!current.hasHandoverRequest && isHandoverMessageType(row.messageType)) {
    current.hasHandoverRequest = true;
  }
  if (!current.customerName && customerName) {
    current.customerName = customerName;
  }
  if (!current.profileUsername && profile?.username) {
    current.profileUsername = profile.username;
  }
  if (!current.profilePicUrl && profile?.profilePicUrl) {
    current.profilePicUrl = profile.profilePicUrl;
  }

  if (row.eventTimestamp.getTime() >= current.lastEventTimestamp.getTime()) {
    current.lastMessageType = row.messageType;
    current.lastMessageText = rowText;
    current.lastDirection = row.direction;
    current.lastEventTimestamp = row.eventTimestamp;
  }
}

export async function backfillConversationThreadSummaryForSalon(
  prismaClient: PrismaClient,
  input: BackfillConversationThreadSummaryInput,
): Promise<number> {
  const scanLimit = Number.isInteger(input.scanLimit) && Number(input.scanLimit) > 0
    ? Number(input.scanLimit)
    : 10000;

  const rows = await prismaClient.conversationMessageEvent.findMany({
    where: {
      salonId: input.salonId,
      channel: input.channel || undefined,
    },
    orderBy: {
      eventTimestamp: 'desc',
    },
    take: scanLimit,
    select: {
      salonId: true,
      channel: true,
      conversationKey: true,
      externalAccountId: true,
      customerName: true,
      messageType: true,
      text: true,
      direction: true,
      eventTimestamp: true,
      processingStatus: true,
      rawPayload: true,
    },
  });

  if (!rows.length) {
    return 0;
  }

  const aggregate = new Map<string, AggregatedSummary>();
  for (const row of rows) {
    applyRowToAggregate(aggregate, row);
  }

  await prismaClient.$transaction(async (tx) => {
    for (const item of aggregate.values()) {
      await tx.conversationThreadSummary.upsert({
        where: {
          salonId_channel_conversationKey: {
            salonId: item.salonId,
            channel: item.channel,
            conversationKey: item.conversationKey,
          },
        },
        update: {
          customerName: item.customerName,
          profileUsername: item.profileUsername,
          profilePicUrl: item.profilePicUrl,
          lastMessageType: item.lastMessageType,
          lastMessageText: item.lastMessageText,
          lastDirection: item.lastDirection,
          lastEventTimestamp: item.lastEventTimestamp,
          unreadCount: item.unreadCount,
          messageCount: item.messageCount,
          hasHandoverRequest: item.hasHandoverRequest,
        },
        create: {
          salonId: item.salonId,
          channel: item.channel,
          conversationKey: item.conversationKey,
          customerName: item.customerName,
          profileUsername: item.profileUsername,
          profilePicUrl: item.profilePicUrl,
          lastMessageType: item.lastMessageType,
          lastMessageText: item.lastMessageText,
          lastDirection: item.lastDirection,
          lastEventTimestamp: item.lastEventTimestamp,
          unreadCount: item.unreadCount,
          messageCount: item.messageCount,
          hasHandoverRequest: item.hasHandoverRequest,
        },
      });
    }
  });

  return aggregate.size;
}
