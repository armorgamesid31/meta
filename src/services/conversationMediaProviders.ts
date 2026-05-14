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

// Chakra BSP exposes a one-shot media download endpoint that wraps Meta's
// two-step flow (GET /{media_id} → signed URL → bytes). The Chakra Bearer
// token authenticates here; calling graph.facebook.com directly with that
// same token fails with 401 (it's an OAuth user token, not Chakra's BSP
// scope). The earlier direct-Graph implementation was the bug behind the
// 401 → refresh → 401 loop that logged users out from the chat surface.
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com').trim();
const CHAKRA_WA_API_VERSION = (process.env.CHAKRA_WA_API_VERSION || 'v19.0').trim();

export interface ProviderMediaFetchResult {
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

/**
 * WhatsApp media fetch via Chakra's BSP-managed proxy.
 *
 * Endpoint: GET {CHAKRA_API_BASE}/v1/whatsapp/{ver}/media/{media_id}/show
 *   Auth:   Authorization: Bearer {CHAKRA_API_TOKEN}
 *   Result: raw bytes, Content-Type set by upstream
 *
 * One round-trip, no signed-URL juggling. Chakra refreshes Meta's
 * short-lived URL behind the scenes.
 */
export async function fetchWhatsAppMedia(opts: {
  mediaId: string;
  token: string;
}): Promise<ProviderMediaFetchResult> {
  const url = `${CHAKRA_API_BASE}/v1/whatsapp/${encodeURIComponent(CHAKRA_WA_API_VERSION)}/media/${encodeURIComponent(opts.mediaId)}/show`;
  const resp = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${opts.token}` },
    timeout: 30_000,
    maxRedirects: 5,
    validateStatus: s => s >= 200 && s < 400,
  });
  const buffer = Buffer.from(resp.data);
  const mimeType = String(resp.headers['content-type'] || 'application/octet-stream');
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
