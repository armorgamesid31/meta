// Channel-specific media fetch adapters. Each adapter knows how to turn a
// providerMediaId / providerMediaUrl into bytes we can persist to R2.
//
// WhatsApp Cloud API:
//   1. GET https://graph.facebook.com/v22.0/{media_id}
//      → returns { url, mime_type, file_size, ... }
//   2. GET that returned url with Authorization: Bearer <token>
//      → returns the raw bytes (URL expires in ~5 minutes)
//
// Instagram Graph API:
//   Webhooks sometimes include a direct url (lookaside.fbsbx.com) which we
//   can fetch with the token. If we only have an attachment id, we POST to
//   the messages endpoint to reissue a url (rare; faz 1 covers webhook url).

import axios from 'axios';

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v22.0').trim();
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface ProviderMediaFetchResult {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

/**
 * WhatsApp Cloud API: two-step fetch using a persistent media_id.
 *
 * The Chakra BSP exposes the underlying graph.facebook.com calls through
 * its `/v1/ext/plugin/whatsapp/...` proxy. For media we go direct to
 * graph.facebook.com since the Bearer token works there too and we don't
 * need plugin scoping.
 */
export async function fetchWhatsAppMedia(opts: {
  mediaId: string;
  token: string;
}): Promise<ProviderMediaFetchResult> {
  const metaResp = await axios.get(
    `${META_GRAPH_BASE}/${encodeURIComponent(opts.mediaId)}`,
    {
      headers: { Authorization: `Bearer ${opts.token}` },
      timeout: 15_000,
      validateStatus: s => s >= 200 && s < 400,
    },
  );
  const url = String(metaResp.data?.url || '').trim();
  const declaredMime = String(metaResp.data?.mime_type || '').trim();
  if (!url) throw new Error('whatsapp_media_url_missing');

  const bytesResp = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${opts.token}` },
    timeout: 30_000,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400,
  });
  const buffer = Buffer.from(bytesResp.data);
  const mimeType = declaredMime || String(bytesResp.headers['content-type'] || 'application/octet-stream');
  return { buffer, mimeType, sizeBytes: buffer.length };
}

/**
 * Instagram Graph API media fetch.
 *
 * The webhook payload usually carries `attachments[].payload.url` directly
 * (a lookaside.fbsbx.com link). It still requires the salon's access token
 * to actually download.
 *
 * If we only have an attachment id (no url), Faz 1 leaves a placeholder —
 * Instagram requires a `POST /me/messages` round-trip pattern to reissue.
 */
export async function fetchInstagramMedia(opts: {
  url: string;
  token: string;
}): Promise<ProviderMediaFetchResult> {
  const url = (opts.url || '').trim();
  if (!url) throw new Error('instagram_media_url_missing');

  // Some IG urls already include access_token in query; if not, append.
  let finalUrl = url;
  try {
    const parsed = new URL(url);
    if (
      (parsed.hostname.endsWith('graph.facebook.com') ||
        parsed.hostname.endsWith('graph.instagram.com') ||
        parsed.hostname.includes('fbsbx.com')) &&
      !parsed.searchParams.has('access_token')
    ) {
      parsed.searchParams.set('access_token', opts.token);
      finalUrl = parsed.toString();
    }
  } catch { /* leave as-is */ }

  const bytesResp = await axios.get<ArrayBuffer>(finalUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${opts.token}` },
    timeout: 30_000,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400,
  });
  const buffer = Buffer.from(bytesResp.data);
  const mimeType = String(bytesResp.headers['content-type'] || 'application/octet-stream');
  return { buffer, mimeType, sizeBytes: buffer.length };
}
