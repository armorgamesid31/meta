import { ChannelType, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

export type ConversationRealtimeEventPayload = {
  cursor: number;
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  eventType: string;
  messageEventId: number | null;
  eventTimestamp: string;
};

export type ConversationRealtimeFilter = {
  salonId: number;
  channel?: ChannelType | null;
};

const DEFAULT_SYNC_LIMIT = 150;
const MAX_SYNC_LIMIT = 500;
const REPLAY_WINDOW_SIZE = 5000;

function toSafeSyncLimit(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(numeric)) {
    return DEFAULT_SYNC_LIMIT;
  }
  return Math.min(Math.max(numeric, 1), MAX_SYNC_LIMIT);
}

function toSafeCursor(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric;
}

function serializeRealtimeEvent(
  row: {
    id: number;
    salonId: number;
    channel: ChannelType;
    conversationKey: string;
    eventType: string;
    messageEventId: number | null;
    eventTimestamp: Date;
  },
): ConversationRealtimeEventPayload {
  return {
    cursor: row.id,
    salonId: row.salonId,
    channel: row.channel,
    conversationKey: row.conversationKey,
    eventType: row.eventType,
    messageEventId: row.messageEventId,
    eventTimestamp: row.eventTimestamp.toISOString(),
  };
}

export async function getLatestRealtimeCursor(filter: ConversationRealtimeFilter): Promise<number> {
  const latest = await prisma.conversationRealtimeEvent.findFirst({
    where: {
      salonId: filter.salonId,
      channel: filter.channel || undefined,
    },
    orderBy: {
      id: 'desc',
    },
    select: {
      id: true,
    },
  });
  return latest?.id || 0;
}

export async function listRealtimeEventsSince(input: {
  salonId: number;
  channel?: ChannelType | null;
  since: number;
  limit?: number;
}): Promise<ConversationRealtimeEventPayload[]> {
  const rows = await prisma.conversationRealtimeEvent.findMany({
    where: {
      salonId: input.salonId,
      channel: input.channel || undefined,
      id: {
        gt: input.since,
      },
    },
    orderBy: {
      id: 'asc',
    },
    take: toSafeSyncLimit(input.limit),
    select: {
      id: true,
      salonId: true,
      channel: true,
      conversationKey: true,
      eventType: true,
      messageEventId: true,
      eventTimestamp: true,
    },
  });

  return rows.map(serializeRealtimeEvent);
}

export async function readRealtimeSync(input: {
  salonId: number;
  channel?: ChannelType | null;
  since: unknown;
  limit?: unknown;
}): Promise<{
  events: ConversationRealtimeEventPayload[];
  latestCursor: number;
  hasGap: boolean;
  requiresFullRefresh: boolean;
}> {
  const since = toSafeCursor(input.since);
  const limit = toSafeSyncLimit(input.limit);
  const latestCursor = await getLatestRealtimeCursor({
    salonId: input.salonId,
    channel: input.channel || null,
  });

  const hasGap = latestCursor > since && latestCursor - since > REPLAY_WINDOW_SIZE;
  if (hasGap) {
    return {
      events: [],
      latestCursor,
      hasGap: true,
      requiresFullRefresh: true,
    };
  }

  const events = await listRealtimeEventsSince({
    salonId: input.salonId,
    channel: input.channel || null,
    since,
    limit,
  });

  return {
    events,
    latestCursor,
    hasGap: false,
    requiresFullRefresh: false,
  };
}

export async function createRealtimeEventInTx(
  tx: Prisma.TransactionClient,
  input: {
    salonId: number;
    channel: ChannelType;
    conversationKey: string;
    eventType: string;
    messageEventId?: number | null;
    eventTimestamp: Date;
  },
): Promise<ConversationRealtimeEventPayload> {
  const created = await tx.conversationRealtimeEvent.create({
    data: {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      eventType: input.eventType,
      messageEventId: input.messageEventId || null,
      eventTimestamp: input.eventTimestamp,
    },
    select: {
      id: true,
      salonId: true,
      channel: true,
      conversationKey: true,
      eventType: true,
      messageEventId: true,
      eventTimestamp: true,
    },
  });
  return serializeRealtimeEvent(created);
}

