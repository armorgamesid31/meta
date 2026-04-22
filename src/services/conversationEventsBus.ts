import { randomUUID } from 'crypto';
import { ChannelType } from '@prisma/client';
import { createClient, type RedisClientType } from 'redis';

export type ConversationStreamEvent = {
  cursor: number;
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  eventType: string;
  messageEventId: number | null;
  eventTimestamp: string;
};

type Listener = (event: ConversationStreamEvent) => void;

type BusEnvelope = {
  nodeId: string;
  event: ConversationStreamEvent;
};

const listenersBySalon = new Map<number, Set<Listener>>();
const BUS_CHANNEL = 'conversation:realtime:events';
const NODE_ID = process.env.REALTIME_NODE_ID?.trim() || randomUUID();

let publishClient: RedisClientType | null = null;
let subscribeClient: RedisClientType | null = null;
let redisEnabled = false;
let redisInitPromise: Promise<void> | null = null;

function emitLocal(event: ConversationStreamEvent): void {
  const listeners = listenersBySalon.get(event.salonId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error('publishConversationStreamEvent listener error:', error);
    }
  }
}

function getRedisUrl(): string {
  const configured = (process.env.REDIS_URL || '').trim();
  if (configured) return configured;
  return 'redis://127.0.0.1:6379';
}

async function setupRedisClients(): Promise<void> {
  const redisUrl = getRedisUrl();
  publishClient = createClient({ url: redisUrl });
  subscribeClient = createClient({ url: redisUrl });

  publishClient.on('error', (error) => {
    console.error('[conversation-events-bus] redis publish client error:', error);
  });
  subscribeClient.on('error', (error) => {
    console.error('[conversation-events-bus] redis subscribe client error:', error);
  });

  await publishClient.connect();
  await subscribeClient.connect();

  await subscribeClient.subscribe(BUS_CHANNEL, (rawMessage) => {
    try {
      const payload = JSON.parse(rawMessage) as BusEnvelope;
      if (!payload?.event || payload.nodeId === NODE_ID) return;
      emitLocal(payload.event);
    } catch (error) {
      console.error('[conversation-events-bus] invalid redis event payload:', error);
    }
  });

  redisEnabled = true;
  console.log('[conversation-events-bus] redis pub/sub enabled');
}

export async function initConversationEventsBus(): Promise<void> {
  if (redisInitPromise) return redisInitPromise;

  redisInitPromise = (async () => {
    try {
      await setupRedisClients();
    } catch (error) {
      redisEnabled = false;
      publishClient = null;
      subscribeClient = null;
      console.error('[conversation-events-bus] redis init failed, using local-only bus:', error);
    }
  })();

  await redisInitPromise;
}

export async function closeConversationEventsBus(): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  if (subscribeClient) {
    tasks.push(subscribeClient.unsubscribe(BUS_CHANNEL).catch(() => undefined).then(() => undefined));
    tasks.push(subscribeClient.quit().catch(() => undefined).then(() => undefined));
  }
  if (publishClient) {
    tasks.push(publishClient.quit().catch(() => undefined).then(() => undefined));
  }
  await Promise.all(tasks);
  publishClient = null;
  subscribeClient = null;
  redisEnabled = false;
  redisInitPromise = null;
}

export function publishConversationStreamEvent(event: ConversationStreamEvent): void {
  // Always notify local listeners immediately for low latency.
  emitLocal(event);

  if (!redisEnabled || !publishClient) return;

  const payload: BusEnvelope = { nodeId: NODE_ID, event };
  void publishClient.publish(BUS_CHANNEL, JSON.stringify(payload)).catch((error) => {
    console.error('[conversation-events-bus] redis publish failed:', error);
  });
}

export function subscribeConversationStream(
  salonId: number,
  listener: Listener,
): () => void {
  const current = listenersBySalon.get(salonId) || new Set<Listener>();
  current.add(listener);
  listenersBySalon.set(salonId, current);

  return () => {
    const bucket = listenersBySalon.get(salonId);
    if (!bucket) return;
    bucket.delete(listener);
    if (bucket.size === 0) {
      listenersBySalon.delete(salonId);
    }
  };
}
