import { createHash } from 'crypto';
import axios from 'axios';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ChannelType } from '@prisma/client';

const R2_ENABLED = (process.env.IMPORTS_R2_ENABLED || '').trim().toLowerCase() === 'true';
const R2_BUCKET = (process.env.IMPORTS_R2_BUCKET || '').trim();
const R2_ENDPOINT = (process.env.IMPORTS_R2_ENDPOINT || '').trim();
const R2_ACCESS_KEY_ID = (process.env.IMPORTS_R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.IMPORTS_R2_SECRET_ACCESS_KEY || '').trim();
const R2_REGION = (process.env.IMPORTS_R2_REGION || 'auto').trim();
const R2_PUBLIC_BASE_URL = (process.env.IMPORTS_R2_PUBLIC_BASE_URL || '').trim();
const R2_PREFIX = (process.env.IMPORTS_R2_PREFIX || 'avatars').trim();
const R2_FORCE_PATH_STYLE = (process.env.IMPORTS_R2_FORCE_PATH_STYLE || 'true').trim().toLowerCase() !== 'false';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

let clientSingleton: S3Client | null | undefined;
const R2_ENDPOINT_HOST = (() => {
  try {
    return new URL(R2_ENDPOINT).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const R2_PUBLIC_BASE_HOST = (() => {
  try {
    return new URL(R2_PUBLIC_BASE_URL).hostname.toLowerCase();
  } catch {
    return '';
  }
})();

function isConfigured() {
  return Boolean(R2_ENABLED && R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function getClient(): S3Client | null {
  if (!isConfigured()) return null;
  if (clientSingleton !== undefined) return clientSingleton;
  clientSingleton = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    forcePathStyle: R2_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return clientSingleton;
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown';
}

function buildObjectKey(input: { salonId: number; channel: ChannelType; conversationKey: string; sourceUrl: string }) {
  const prefix = R2_PREFIX.replace(/^\/+|\/+$/g, '') || 'avatars';
  const keyHash = createHash('sha256').update(`${input.channel}:${input.conversationKey}`).digest('hex').slice(0, 20);
  const sourceHash = createHash('sha256').update(input.sourceUrl).digest('hex').slice(0, 16);
  return `${prefix}/${input.salonId}/${input.channel.toLowerCase()}/${sanitizeSegment(input.conversationKey)}-${keyHash}-${sourceHash}.jpg`;
}

function buildPublicUrl(objectKey: string) {
  if (R2_PUBLIC_BASE_URL) {
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${objectKey}`;
  }
  return `${R2_ENDPOINT.replace(/\/+$/, '')}/${R2_BUCKET}/${objectKey}`;
}

export async function storeConversationAvatarFromUrl(input: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  sourceUrl: string | null | undefined;
  instagramAccessToken?: string | null;
}): Promise<string | null> {
  const client = getClient();
  const sourceUrl = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  if (!client || !sourceUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  const parsedHost = parsed.hostname.toLowerCase();
  if ((R2_ENDPOINT_HOST && parsedHost === R2_ENDPOINT_HOST) || (R2_PUBLIC_BASE_HOST && parsedHost === R2_PUBLIC_BASE_HOST)) {
    return sourceUrl;
  }
  if (
    input.channel === 'INSTAGRAM' &&
    (parsedHost === 'graph.instagram.com' || parsedHost === 'graph.facebook.com') &&
    !parsed.searchParams.has('access_token')
  ) {
    const token = (input.instagramAccessToken || '').trim();
    if (token) {
      parsed.searchParams.set('access_token', token);
    }
  }

  try {
    const response = await axios.get<ArrayBuffer>(parsed.toString(), {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        Accept: 'image/*,*/*;q=0.8',
        'User-Agent': 'KedySalon/1.0 (+https://kedyapp.com)',
      },
    });

    const contentTypeRaw = response.headers['content-type'];
    const contentType = typeof contentTypeRaw === 'string' && contentTypeRaw.trim()
      ? contentTypeRaw
      : 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) return null;

    const buffer = Buffer.from(response.data);
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;

    const objectKey = buildObjectKey({
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      sourceUrl,
    });

    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=86400',
      }),
    );

    return buildPublicUrl(objectKey);
  } catch (error: any) {
    console.error('Conversation avatar upload failed:', {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      sourceUrl,
      error: error?.message || 'unknown_error',
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// R2-hosted avatar okuma. R2'nin S3 endpoint'i imzasız GET'i reddeder
// (400/403) ve IMPORTS_R2_PUBLIC_BASE_URL ayarlı değilse profilePicUrl
// bu endpoint'e düşer → düz axios GET ile çekilemez. Aşağıdaki yardımcı,
// host R2 ise objeyi imzalı S3 GetObject ile çeker; böylece bucket
// private kalır (içinde import/, conv-media/, users/ gibi müşteri verisi var).
// ─────────────────────────────────────────────────────────────────
function deriveR2ObjectKey(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase();
  const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!path) return null;
  if (R2_PUBLIC_BASE_HOST && host === R2_PUBLIC_BASE_HOST) {
    return path;
  }
  if (R2_ENDPOINT_HOST && host === R2_ENDPOINT_HOST) {
    const prefix = `${R2_BUCKET}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }
  return null;
}

export function isR2ObjectUrl(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return Boolean(
    (R2_ENDPOINT_HOST && host === R2_ENDPOINT_HOST) ||
    (R2_PUBLIC_BASE_HOST && host === R2_PUBLIC_BASE_HOST),
  );
}

export async function fetchR2ObjectByUrl(rawUrl: string): Promise<{ body: Buffer; contentType: string } | null> {
  const client = getClient();
  if (!client) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const key = deriveR2ObjectKey(parsed);
  if (!key) return null;
  try {
    const resp = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const bytes = resp.Body ? await resp.Body.transformToByteArray() : null;
    if (!bytes || !bytes.length) return null;
    const contentType = typeof resp.ContentType === 'string' && resp.ContentType.trim()
      ? resp.ContentType
      : 'image/jpeg';
    return { body: Buffer.from(bytes), contentType };
  } catch (error: any) {
    console.error('R2 object fetch failed:', { rawUrl, key, error: error?.message || 'unknown_error' });
    return null;
  }
}
