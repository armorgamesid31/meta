// Conversation media cache — fetches WhatsApp / Instagram media on first
// view (inbound) or eagerly on send (outbound), persists in Cloudflare R2,
// and serves signed read URLs back to the mobile/web client.
//
// Schema reference (ConversationMessageEvent JSON columns):
//   mediaItems:  [{ index, type, mimeType, sizeBytes?, durationSec?, isVoice?,
//                   caption?, providerMediaId?, providerMediaUrl? }]
//   mediaCached: [{ index, r2Key, r2Bucket, sha256, cachedAt }]
//
// Inbound flow:
//   webhook → mediaItems populated (providerMediaId stored, no download)
//   client requests /messages/:id/media/:idx →
//     cache miss: fetchProviderMedia + putToR2 + DB update + presign read URL
//     cache hit:  presign read URL only
//
// Outbound flow:
//   client uploads file via send endpoint →
//     putToR2 (eager) → upload to Meta → send → DB write with mediaItems
//     + mediaCached + metaMediaIds prefilled
//
// 30-day retention is enforced by scripts/cleanup-cached-media.mjs.

import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ChannelType } from '@prisma/client';
import { prisma } from '../prisma.js';

// Reuse the existing IMPORTS_R2_* env so we don't fragment credentials.
// MEDIA_R2_* overrides bucket/prefix to keep media segregated from avatars
// (so retention deletes don't touch avatar storage).
const R2_ENABLED = (process.env.IMPORTS_R2_ENABLED || '').trim().toLowerCase() === 'true';
const R2_ENDPOINT = (process.env.IMPORTS_R2_ENDPOINT || '').trim();
const R2_ACCESS_KEY_ID = (process.env.IMPORTS_R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.IMPORTS_R2_SECRET_ACCESS_KEY || '').trim();
const R2_REGION = (process.env.IMPORTS_R2_REGION || 'auto').trim();
const R2_FORCE_PATH_STYLE = (process.env.IMPORTS_R2_FORCE_PATH_STYLE || 'true').trim().toLowerCase() !== 'false';

const MEDIA_R2_BUCKET = (process.env.MEDIA_R2_BUCKET || process.env.IMPORTS_R2_BUCKET || '').trim();
const MEDIA_R2_PREFIX = (process.env.MEDIA_R2_PREFIX || 'conv-media').trim();
const MEDIA_RETENTION_DAYS = Number(process.env.MEDIA_RETENTION_DAYS || 30);
const SIGNED_URL_TTL_SEC = 30 * 60; // 30 minutes

// Hard caps mirroring WhatsApp + Instagram limits (we take the smaller).
export const MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,  // 5 MB
  video: 16 * 1024 * 1024, // 16 MB
  audio: 16 * 1024 * 1024, // 16 MB
} as const;

export type MediaKind = keyof typeof MEDIA_LIMITS;

export interface MediaItemMeta {
  index: number;
  type: MediaKind;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
  isVoice?: boolean;
  isSticker?: boolean;
  caption?: string;
  providerMediaId?: string | null;
  providerMediaUrl?: string | null;
}

export interface MediaCachedMeta {
  index: number;
  r2Key: string;
  r2Bucket: string;
  sha256: string;
  cachedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// Internal: S3 client + key building
// ─────────────────────────────────────────────────────────────────

let clientSingleton: S3Client | null | undefined;

function isConfigured(): boolean {
  return Boolean(
    R2_ENABLED &&
    MEDIA_R2_BUCKET &&
    R2_ENDPOINT &&
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY,
  );
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
    // AWS SDK v3 (>= 3.726) added "flexible checksums" — every presigned
    // URL gets `x-amz-checksum-mode=ENABLED` baked into the signature
    // by default. Cloudflare R2's S3 surface does not accept that
    // header, so the browser's <img>/fetch() call to the signed URL
    // came back as opaque/0 and conversations rendered as broken
    // image icons. Setting both knobs to WHEN_REQUIRED reverts to
    // the pre-3.726 behavior: checksums only when the operation
    // really needs them (it doesn't for GetObject).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return clientSingleton;
}

function extensionFor(mimeType: string, kind: MediaKind): string {
  const mt = (mimeType || '').toLowerCase();
  if (kind === 'image') {
    if (mt.includes('png')) return 'png';
    if (mt.includes('webp')) return 'webp';
    return 'jpg';
  }
  if (kind === 'video') {
    if (mt.includes('3gp')) return '3gp';
    return 'mp4';
  }
  // audio
  if (mt.includes('ogg') || mt.includes('opus')) return 'ogg';
  if (mt.includes('aac')) return 'aac';
  if (mt.includes('mpeg') || mt.includes('mp3')) return 'mp3';
  if (mt.includes('amr')) return 'amr';
  if (mt.includes('mp4') || mt.includes('m4a')) return 'm4a';
  return 'bin';
}

function buildObjectKey(opts: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  messageId: number;
  mediaIndex: number;
  mimeType: string;
  kind: MediaKind;
}): string {
  const prefix = MEDIA_R2_PREFIX.replace(/^\/+|\/+$/g, '') || 'conv-media';
  const channel = opts.channel.toLowerCase();
  const convHash = createHash('sha256')
    .update(`${opts.channel}:${opts.conversationKey}`)
    .digest('hex')
    .slice(0, 12);
  const ext = extensionFor(opts.mimeType, opts.kind);
  return `${prefix}/${opts.salonId}/${channel}/${convHash}/msg-${opts.messageId}-${opts.mediaIndex}.${ext}`;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export function isMediaCacheEnabled(): boolean {
  return isConfigured();
}

export function classifyMediaKind(typeHint: string): MediaKind | null {
  const t = typeHint.toLowerCase();
  // Document/PDF intentionally excluded — salons don't typically need to
  // exchange files, and rendering documents adds significant complexity
  // (preview, download flow). Stickers map to 'image' so they ride the
  // same R2 cache pipeline; the UI tags them with isSticker for a small
  // visual differentiator.
  if (t === 'image' || t === 'sticker') return 'image';
  if (t === 'video') return 'video';
  if (t === 'audio' || t === 'voice') return 'audio';
  return null;
}

/**
 * Convert the channel-specific `media` collection (already built by the
 * webhook handler) into the structured mediaItems[] shape we persist to
 * the JSON column. Items the picker doesn't support (document, sticker,
 * unknown) are dropped — they still live in rawPayload if needed later.
 */
export function buildMediaItemsFromWebhook(
  raw: Array<{
    type?: string | null;
    id?: string | null;
    url?: string | null;
    caption?: string | null;
    voice?: boolean | null;
    mime_type?: string | null;
    mimeType?: string | null;
  } | null | undefined>,
): MediaItemMeta[] {
  const out: MediaItemMeta[] = [];
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (!m) continue;
    const rawType = String(m.type || '').toLowerCase();
    const kind = classifyMediaKind(rawType);
    if (!kind) continue;
    out.push({
      index: out.length,
      type: kind,
      mimeType: (m.mimeType || m.mime_type || '').toString(),
      isVoice: m.voice === true || (kind === 'audio' && rawType === 'voice'),
      isSticker: rawType === 'sticker',
      caption: m.caption ? String(m.caption) : undefined,
      providerMediaId: m.id ? String(m.id) : null,
      providerMediaUrl: m.url ? String(m.url) : null,
    });
  }
  return out;
}

/**
 * Generate a short-lived signed read URL for a cached object. Returns null
 * if the object isn't cached or R2 isn't configured.
 */
export async function presignReadUrl(
  cached: MediaCachedMeta,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const cmd = new GetObjectCommand({
      Bucket: cached.r2Bucket,
      Key: cached.r2Key,
    });
    return await getSignedUrl(client, cmd, { expiresIn: SIGNED_URL_TTL_SEC });
  } catch (err) {
    console.error('[conversationMediaCache] presign failed:', err);
    return null;
  }
}

/**
 * Persist a buffer to R2 and return its cache metadata. Caller is
 * responsible for updating the ConversationMessageEvent row afterwards.
 */
export async function putToR2(opts: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  messageId: number;
  mediaIndex: number;
  mimeType: string;
  kind: MediaKind;
  buffer: Buffer;
}): Promise<MediaCachedMeta | null> {
  const client = getClient();
  if (!client) return null;
  if (opts.buffer.length > MEDIA_LIMITS[opts.kind]) {
    throw new Error(`media_too_large: ${opts.kind} exceeds ${MEDIA_LIMITS[opts.kind]} bytes`);
  }
  const r2Key = buildObjectKey(opts);
  const sha256 = createHash('sha256').update(opts.buffer).digest('hex');

  await client.send(new PutObjectCommand({
    Bucket: MEDIA_R2_BUCKET,
    Key: r2Key,
    Body: opts.buffer,
    ContentType: opts.mimeType || 'application/octet-stream',
    Metadata: {
      'salon-id': String(opts.salonId),
      'channel': opts.channel,
      'message-id': String(opts.messageId),
      'media-index': String(opts.mediaIndex),
    },
  }));

  return {
    index: opts.mediaIndex,
    r2Key,
    r2Bucket: MEDIA_R2_BUCKET,
    sha256,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Delete an R2 object. Used by retention cron and KVKK deletion endpoint.
 */
export async function deleteFromR2(cached: MediaCachedMeta): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.send(new DeleteObjectCommand({
    Bucket: cached.r2Bucket,
    Key: cached.r2Key,
  }));
}

/**
 * Update the mediaCached column on a message after one or more media items
 * have been persisted. Merges with existing cached entries (by index).
 */
export async function persistMediaCached(opts: {
  messageId: number;
  newEntries: MediaCachedMeta[];
}): Promise<void> {
  if (opts.newEntries.length === 0) return;
  const row = await prisma.conversationMessageEvent.findUnique({
    where: { id: opts.messageId },
    select: { mediaCached: true },
  });
  const existing = Array.isArray(row?.mediaCached)
    ? (row!.mediaCached as unknown as MediaCachedMeta[])
    : [];
  const byIndex = new Map(existing.map(e => [e.index, e]));
  for (const e of opts.newEntries) byIndex.set(e.index, e);
  const merged = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  await prisma.conversationMessageEvent.update({
    where: { id: opts.messageId },
    data: {
      mediaCached: merged as any,
      mediaCachedAt: new Date(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Concurrent-fetch coalescing
// ─────────────────────────────────────────────────────────────────
// If two clients hit /media/:idx for the same uncached item at the same
// time, we don't want two Meta downloads. Coalesce by (messageId, index).
const inFlight = new Map<string, Promise<MediaCachedMeta | null>>();

export async function coalesce<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (inFlight.has(key)) return inFlight.get(key) as Promise<T>;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p as Promise<any>);
  return p;
}

export function coalesceKey(messageId: number, index: number): string {
  return `${messageId}:${index}`;
}

// ─────────────────────────────────────────────────────────────────
// Token resolution
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve the Bearer token used to call Meta on behalf of a salon. Both
 * WhatsApp and Instagram traffic routes through Chakra's BSP proxy, so the
 * same CHAKRA_API_TOKEN authorizes both. The per-channel difference is in
 * the URL we hit (handled by the channel-specific fetch adapters), not in
 * the credential.
 */
export async function resolveMetaTokenForChannel(
  _salonId: number,
  _channel: ChannelType,
): Promise<string | null> {
  const token = (process.env.CHAKRA_API_TOKEN || '').trim();
  return token || null;
}

/**
 * Download bytes from a Meta-issued URL with the given Bearer token.
 * Returns { buffer, mimeType, sizeBytes }.
 */
export async function downloadMetaMedia(
  url: string,
  token: string,
): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number }> {
  const r = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30_000,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400,
  });
  const mimeType = String(r.headers['content-type'] || 'application/octet-stream');
  const buffer = Buffer.from(r.data);
  return { buffer, mimeType, sizeBytes: buffer.length };
}

// Re-export for ergonomic imports elsewhere
export { MEDIA_R2_BUCKET, MEDIA_RETENTION_DAYS };

// Util: stable random id (used for outbound message providerMessageId when
// Meta doesn't echo one immediately).
export function randomToken(bytes = 12): string {
  return randomBytes(bytes).toString('hex');
}
