import { createClient, type RedisClientType } from 'redis';

/**
 * Müsaitlik sorgu sonuçlarını Redis'e kısa TTL ile cache'ler.
 * Müşteri takvim açtığında veya bir slot için sayfayı yenilediğinde
 * tekrar tekrar motor çalıştırmak yerine cache'i okur.
 *
 * Random write durumunda (yeni randevu, iptal, erteleme, slot lock)
 * invalidateAvailabilityForSalon() çağrılarak o salonun tüm
 * availability cache key'leri silinir.
 *
 * Cache REDIS_URL set edilmemişse veya bağlantı başarısız olursa
 * sessizce devre dışı kalır (motor doğrudan çalışır).
 */

let cacheClient: RedisClientType | null = null;
let clientPromise: Promise<RedisClientType | null> | null = null;
let connectFailed = false;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (cacheClient) return cacheClient;
  if (clientPromise) return clientPromise;
  if (connectFailed) return null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  clientPromise = (async () => {
    try {
      const client = createClient({ url: redisUrl }) as RedisClientType;
      client.on('error', (err) => {
        // Sessiz fail — cache miss'e düşeriz, motor doğrudan çalışır.
        console.warn('[availabilityCache] Redis error:', err?.message || err);
      });
      await client.connect();
      cacheClient = client;
      return cacheClient;
    } catch (err) {
      console.warn('[availabilityCache] Redis connect failed, cache disabled:', err);
      connectFailed = true;
      clientPromise = null;
      return null;
    }
  })();

  return clientPromise;
}

const DEFAULT_TTL_SECONDS = 30;

export async function getCachedAvailability<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    if (typeof raw !== 'string' || !raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('[availabilityCache] GET failed:', err);
    return null;
  }
}

export async function setCachedAvailability<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    console.warn('[availabilityCache] SET failed:', err);
  }
}

/**
 * Best-effort: appointment / lock write sonrası o salonun availability
 * cache'ini siler. SCAN cursor-based — büyük key sayıları için güvenli.
 * Fire-and-forget olarak çağrılabilir; await edilmesi tutarlılığı garantilemez.
 */
export async function invalidateAvailabilityForSalon(salonId: number): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const pattern = `availability:${salonId}:*`;
    let cursor = '0';
    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = String(result.cursor);
      if (result.keys.length > 0) {
        await client.del(result.keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    console.warn('[availabilityCache] INVALIDATE failed:', err);
  }
}

function stableStringify(value: unknown): string {
  // Deterministic JSON.stringify for cache keys — sorts object keys so
  // semantically identical group payloads hit the same cache slot.
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function availabilityDatesCacheKey(input: {
  salonId: number;
  startDate: string;
  endDate: string;
  groups: unknown;
}): string {
  return `availability:${input.salonId}:dates:${input.startDate}:${input.endDate}:${stableStringify(input.groups)}`;
}

export function availabilitySlotsCacheKey(input: {
  salonId: number;
  date: string;
  groups: unknown;
}): string {
  return `availability:${input.salonId}:slots:${input.date}:${stableStringify(input.groups)}`;
}
