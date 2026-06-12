// Per-konuşma kilit (W4). Aynı konuşma için aynı anda TEK runner çalışsın
// (rapid-fire mesajlar tek tura birleşsin, çift-cevap olmasın). Redis varsa
// SET NX PX ile dağıtık kilit; yoksa in-process Map fallback (tek-instance güvenli).
//
// Çekirdek ilke: kilit alınamazsa mesaj zaten ConversationMessageEvent'e PENDING
// yazılmıştır → aktif runner'ın re-check döngüsü onu yakalar. Kaybolmaz.

import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let clientPromise: Promise<RedisClientType | null> | null = null;
let connectFailed = false;

async function getRedis(): Promise<RedisClientType | null> {
  if (client) return client;
  if (clientPromise) return clientPromise;
  if (connectFailed) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;

  clientPromise = (async () => {
    try {
      const c = createClient({ url }) as RedisClientType;
      c.on('error', (err) => console.warn('[agent-lock] redis error:', err?.message || err));
      await c.connect();
      client = c;
      return client;
    } catch (err) {
      console.warn('[agent-lock] redis connect failed, in-process fallback:', err);
      connectFailed = true;
      clientPromise = null;
      return null;
    }
  })();
  return clientPromise;
}

// In-process fallback: kilit anahtarı → bırakılma zamanı (ms epoch).
const localLocks = new Map<string, number>();

function lockKey(salonId: number, channel: string, conversationKey: string): string {
  return `agentlock:${salonId}:${channel}:${conversationKey}`;
}

/** Kilidi dener; alındıysa true. ttlMs içinde otomatik düşer (runner çökerse kalmaz). */
export async function acquireConversationLock(
  salonId: number,
  channel: string,
  conversationKey: string,
  ttlMs = 120_000,
): Promise<boolean> {
  const key = lockKey(salonId, channel, conversationKey);
  const redis = await getRedis();
  if (redis) {
    try {
      const res = await redis.set(key, '1', { NX: true, PX: ttlMs });
      return res === 'OK';
    } catch (err) {
      console.warn('[agent-lock] acquire failed, fallback:', err);
    }
  }
  const now = Date.now();
  const until = localLocks.get(key);
  if (until && until > now) return false;
  localLocks.set(key, now + ttlMs);
  return true;
}

/** Kilit ömrünü uzat (heartbeat). Aktif runner her turda çağırır → TTL,
 *  maksimum çalışma süresinden bağımsız olarak runner yaşadıkça düşmez
 *  (paralel-runner/deadlock riskini kapatır). Kilit kaybedildiyse false. */
export async function renewConversationLock(
  salonId: number,
  channel: string,
  conversationKey: string,
  ttlMs = 120_000,
): Promise<boolean> {
  const key = lockKey(salonId, channel, conversationKey);
  const redis = await getRedis();
  if (redis) {
    try {
      // Sadece kilit hâlâ bizdeyse uzat (varsa yenile; yoksa kaybetmişiz).
      // redis.expire → 1 (uzatıldı) / 0 (key yok).
      const expired = await redis.expire(key, Math.ceil(ttlMs / 1000));
      return Number(expired) === 1;
    } catch (err) {
      console.warn('[agent-lock] renew failed:', err);
    }
  }
  const now = Date.now();
  if (!localLocks.has(key)) return false;
  localLocks.set(key, now + ttlMs);
  return true;
}

/** Kilidi bırak. */
export async function releaseConversationLock(
  salonId: number,
  channel: string,
  conversationKey: string,
): Promise<void> {
  const key = lockKey(salonId, channel, conversationKey);
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch (err) {
      console.warn('[agent-lock] release failed:', err);
    }
  }
  localLocks.delete(key);
}
