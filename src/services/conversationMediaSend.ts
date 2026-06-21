// Outbound media send pipeline.
//
// The salon staff composer picks an image / video / audio file from the
// device. The mobile app uploads it as multipart/form-data to our backend.
// This service then:
//   1. Validates kind/size/MIME against the channel's hard limits.
//   2. Eagerly persists to R2 (so any later view from any device hits the
//      same cached object as inbound).
//   3. Uploads to Meta (channel-specific) to get back a media_id /
//      attachment_id.
//   4. Sends the message to the customer.
//   5. Inserts a ConversationMessageEvent row with direction=OUTBOUND and
//      mediaItems / mediaCached / metaMediaIds prefilled — the eventual
//      Meta echo webhook is idempotent against this providerMessageId.
//
// WhatsApp Cloud API path is complete. Instagram outbound is stubbed and
// returns NOT_IMPLEMENTED for Faz 1 — it requires the same intricate
// PSID/recipient resolution dance as the text reply handler and is on the
// roadmap.

import axios from 'axios';
import {
  ChannelType,
  InboundMessageStatus,
  OutboundMessageSource,
  Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { upsertConversationMessageEvent } from './conversationMessageEvents.js';
import {
  MEDIA_LIMITS,
  classifyMediaKind,
  presignReadUrl,
  putToR2,
  randomToken,
  type MediaItemMeta,
  type MediaCachedMeta,
  type MediaKind,
} from './conversationMediaCache.js';
import { transcodeToWhatsAppVoice } from './audioTranscode.js';

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v22.0').trim();
const META_INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${META_GRAPH_VERSION}`;
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com').trim();
// WhatsApp Cloud API endpoints flow through Chakra's BSP proxy, not
// graph.facebook.com directly. Calling Meta with our CHAKRA_API_TOKEN
// fails 401 ("Authentication Error") because that token authorizes
// against Chakra's surface, not Meta's OAuth one.
const CHAKRA_WA_API_VERSION = (process.env.CHAKRA_WA_API_VERSION || 'v19.0').trim();
const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SendMediaInput {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  recipientPhoneOrPsid: string; // E.164 digits for WA / PSID for IG
  kind: MediaKind;
  mimeType: string;
  buffer: Buffer;
  caption?: string | null;
  isVoice?: boolean;
  senderUserId?: number | null;
  senderUserEmail?: string | null;
  // Optional quote-reply: when set, the outbound message will be threaded
  // under the original. WhatsApp uses `context.message_id`. Instagram
  // currently doesn't expose first-class reply-threading for media via
  // Graph API, so the in-DB pointer still wires the bubble UI but Meta
  // won't show a quoted block on Instagram's side.
  replyToProviderMessageId?: string | null;
  replyToMessageId?: number | null;
  replyToText?: string | null;
}

export interface SendMediaResult {
  messageId: number;
  providerMessageId: string;
  r2Cached: MediaCachedMeta;
  mediaItem: MediaItemMeta;
}

// ─────────────────────────────────────────────────────────────────
// WhatsApp link-based send
// ─────────────────────────────────────────────────────────────────
//
// WhatsApp Cloud API accepts two media payload shapes:
//   { type: <kind>, <kind>: { id: <meta_media_id> } }
//   { type: <kind>, <kind>: { link: <publicly-fetchable-url> } }
//
// We previously tried the id-based path: upload bytes via Chakra's BSP
// proxy, get back a media_id, then send. That failed repeatedly because
// Chakra simply does NOT expose a /media upload endpoint anywhere — not
// at /v1/ext/plugin/whatsapp/{pluginId}/api/{ver}/{phoneId}/media (404)
// and not at /v1/whatsapp/{ver}/{phoneId}/media (404, "Not Found" plain
// text). The plugin-scoped surface documents only POST /messages
// (per the comment in src/routes/chakra.ts:840: "Chakra documented
// endpoint sadece POST /messages").
//
// Solution: use the link payload. We already cache outbound media to R2
// for cross-device history; we mint a short-lived signed URL from R2 and
// hand that to WhatsApp via the link payload. Meta fetches it during the
// send. Same approach as the Instagram outbound path below.
//
// This collapses the two-call dance into one — and avoids the broken
// upload endpoint entirely.

async function whatsAppLinkSend(opts: {
  input: SendMediaInput;
  cached: MediaCachedMeta;
}): Promise<{ providerMessageId: string; metaMediaId: string }> {
  const { input, cached } = opts;
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: { chakraPluginId: true, chakraPhoneNumberId: true },
  });
  const pluginId = salon?.chakraPluginId?.trim() || '';
  const phoneNumberId = salon?.chakraPhoneNumberId?.trim() || '';
  if (!pluginId || !phoneNumberId) {
    throw new Error('salon_whatsapp_not_connected');
  }
  if (!CHAKRA_API_TOKEN) {
    throw new Error('chakra_api_token_missing');
  }

  // Mint a fresh signed R2 URL. WhatsApp fetches it during the /messages
  // call, well within presignReadUrl's default 30-minute window.
  const r2Url = await presignReadUrl(cached);
  if (!r2Url) {
    throw new Error('whatsapp_media_r2_presign_failed');
  }

  // POST /messages on Chakra's plugin-scoped proxy (proven working for
  // text replies and template sends).
  const sendUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(pluginId)}/api/${encodeURIComponent(CHAKRA_WA_API_VERSION)}/${encodeURIComponent(phoneNumberId)}/messages`;
  const whatsAppType: 'image' | 'video' | 'audio' = input.kind;
  const mediaPayload: Record<string, unknown> = { link: r2Url };
  // Caption only valid for image/video on WA. Audio has no caption.
  if ((input.kind === 'image' || input.kind === 'video') && input.caption) {
    mediaPayload.caption = input.caption;
  }
  // Voice flag for audio: WhatsApp shows as a push-to-talk bubble.
  if (input.kind === 'audio' && input.isVoice) {
    mediaPayload.voice = true;
  }
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.recipientPhoneOrPsid,
    type: whatsAppType,
    [whatsAppType]: mediaPayload,
  };
  // Quote-reply: WhatsApp threads the new message under the original.
  if (input.replyToProviderMessageId) {
    body.context = { message_id: input.replyToProviderMessageId };
  }
  let sendResp;
  try {
    sendResp = await axios.post(sendUrl, body, {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 25_000,
    });
  } catch (err: any) {
    const status = err?.response?.status;
    const respBody = err?.response?.data;
    const bodyStr = typeof respBody === 'string' ? respBody.slice(0, 300) : JSON.stringify(respBody || {}).slice(0, 300);
    throw new Error(`whatsapp_media_send_failed status=${status ?? 'n/a'} url=${sendUrl} body=${bodyStr}`);
  }
  try {
    console.log('[WA-VOICE-DBG]', JSON.stringify({
      status: sendResp?.status,
      data: sendResp?.data,
      type: whatsAppType,
      voice: (mediaPayload as any).voice ?? null,
      r2key: cached.r2Key,
      r2link: String(r2Url),
    }).slice(0, 1400));
  } catch (_) { /* ignore */ }
  const providerMessageId = String(
    sendResp.data?.messages?.[0]?.id ||
      sendResp.data?.data?.messages?.[0]?.id ||
      `wa_out_${randomToken(8)}`,
  );
  // Link-based sends don't return a Meta media id. We synthesize a stable
  // identifier from the providerMessageId so the rest of the pipeline
  // (mediaItem.providerMediaId, metaMediaIds.whatsapp) keeps working.
  // The downstream lazy-fetch flow short-circuits to the already-cached
  // R2 entry via mediaCached, so it never needs to call Meta with this id.
  const metaMediaId = `wa_link_${providerMessageId}`;
  return { providerMessageId, metaMediaId };
}

// ─────────────────────────────────────────────────────────────────
// Instagram upload-then-send
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve the salon's Instagram sender id + access token from the
 * AI agent settings JSON where Meta Direct connect persists them.
 */
async function resolveInstagramIdentity(salonId: number): Promise<{
  senderInstagramId: string;
  accessToken: string;
} | null> {
  const settings = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { faqAnswers: true },
  });
  const faq = (settings?.faqAnswers as any) || {};
  const ig = (faq?.metaDirect?.instagram as any) || {};
  const senderInstagramId = typeof ig.externalAccountId === 'string' ? ig.externalAccountId.trim() : '';
  const accessToken = typeof ig.accessToken === 'string' ? ig.accessToken.trim() : '';
  if (!senderInstagramId || !accessToken) return null;
  return { senderInstagramId, accessToken };
}

/**
 * Check the 24-hour customer service window for an Instagram conversation.
 * Returns true if the window is still open (lastCustomerMessageAt within
 * the last 24h) or unknown (no state row — assume open and let Meta reject).
 */
async function isInstagramReplyWindowOpen(
  salonId: number,
  conversationKey: string,
): Promise<boolean> {
  const row = await prisma.conversationState.findFirst({
    where: { salonId, channel: 'INSTAGRAM', conversationKey },
    select: { lastCustomerMessageAt: true },
  });
  if (!row?.lastCustomerMessageAt) return true; // no signal, optimistic
  return Date.now() - row.lastCustomerMessageAt.getTime() <= INSTAGRAM_REPLY_WINDOW_MS;
}

/**
 * Instagram outbound media flow.
 *
 *   1) eager-cache the bytes to R2 (so the conversation history works
 *      cross-device immediately, and so we have a stable signed URL to
 *      hand to Meta).
 *   2) POST the R2 signed URL to /{ig_user_id}/message_attachments with
 *      is_reusable=true → get attachment_id.
 *   3) POST the message to /{ig_user_id}/messages with the attachment_id
 *      payload. Meta delivers it to the customer.
 *
 * Notes:
 *   - The signed R2 URL is valid for 30 minutes (presignReadUrl default).
 *     Meta downloads it during step 2, well within window.
 *   - 24-hour reply window is enforced before any Meta call — returns
 *     instagram_reply_window_expired so the caller can show a banner.
 *   - Instagram outbound audio: Meta accepts AAC/M4A/MP3 (we ship M4A
 *     from capacitor-voice-recorder), no extra transcode.
 */
async function instagramUploadAndSend(opts: {
  salonId: number;
  conversationKey: string;
  recipientPsid: string;
  cached: MediaCachedMeta;
  kind: MediaKind;
}): Promise<{ providerMessageId: string; metaAttachmentId: string }> {
  const identity = await resolveInstagramIdentity(opts.salonId);
  if (!identity) throw new Error('salon_instagram_not_connected');

  const windowOpen = await isInstagramReplyWindowOpen(opts.salonId, opts.conversationKey);
  if (!windowOpen) throw new Error('instagram_reply_window_expired');

  // Mint a signed R2 URL Meta can fetch. Public download with the query
  // signature — no auth header needed by Meta.
  const r2Url = await presignReadUrl(opts.cached);
  if (!r2Url) throw new Error('r2_presign_failed');

  // Step 1: upload as a reusable attachment to get back an attachment_id.
  //
  // POST https://graph.instagram.com/{ver}/{ig_user_id}/message_attachments
  //   ?access_token=...
  // Body:
  //   { message: { attachment: { type, payload: { is_reusable: true, url } } } }
  const uploadUrl = `${META_INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(identity.senderInstagramId)}/message_attachments`;
  const uploadResp = await axios.post(
    uploadUrl,
    {
      message: {
        attachment: {
          type: opts.kind, // image|video|audio
          payload: { is_reusable: true, url: r2Url },
        },
      },
    },
    {
      params: { access_token: identity.accessToken },
      timeout: 60_000,
    },
  );
  const metaAttachmentId = String(uploadResp.data?.attachment_id || '').trim();
  if (!metaAttachmentId) throw new Error('instagram_attachment_upload_no_id');

  // Step 2: send via /messages with attachment_id reference.
  const sendUrl = `${META_INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(identity.senderInstagramId)}/messages`;
  const sendResp = await axios.post(
    sendUrl,
    {
      recipient: { id: opts.recipientPsid },
      message: {
        attachment: {
          type: opts.kind,
          payload: { attachment_id: metaAttachmentId },
        },
      },
    },
    {
      params: { access_token: identity.accessToken },
      timeout: 25_000,
    },
  );
  const providerMessageId = String(
    sendResp.data?.message_id ||
      `ig_out_${randomToken(8)}`,
  );
  return { providerMessageId, metaAttachmentId };
}

// ─────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────

export async function sendOutboundMedia(input: SendMediaInput): Promise<SendMediaResult> {
  // Hard validate kind + size up front so we never burn an upload on a
  // payload Meta will reject.
  const kind = classifyMediaKind(input.kind);
  if (!kind) throw new Error('unsupported_media_kind');
  if (input.buffer.length === 0) throw new Error('empty_payload');
  if (input.buffer.length > MEDIA_LIMITS[kind]) {
    throw new Error(`media_too_large: ${kind} exceeds ${MEDIA_LIMITS[kind]} bytes`);
  }

  if (input.channel !== 'WHATSAPP' && input.channel !== 'INSTAGRAM') {
    throw new Error('unsupported_channel');
  }

  // WhatsApp sesli mesajı (voice note) SADECE OGG/Opus kabul eder. Web webm,
  // iOS/Capacitor m4a üretiyor → Meta dosyayı çekip sessizce reddediyordu
  // ("gönderildi görünüp gitmeme"). R2'ye yazmadan ÖNCE OGG/Opus'a çevir;
  // tüm aşağı akış (R2 cache + Meta link + mediaItem) bu buffer'ı kullanır.
  let effectiveBuffer = input.buffer;
  let effectiveMime = input.mimeType;
  if (input.channel === 'WHATSAPP' && kind === 'audio' && input.isVoice) {
    try {
      effectiveBuffer = await transcodeToWhatsAppVoice(input.buffer);
      effectiveMime = 'audio/ogg';
    } catch (err) {
      console.error('[conversationMediaSend] WA voice transcode failed:', err);
      throw new Error('voice_transcode_failed');
    }
  }

  // ── Order of operations is now unified across channels ────────────
  //
  // Both WhatsApp and Instagram outbound are link-based: Meta fetches
  // the media from a signed R2 URL we provide in the send payload. So
  // both flows must cache to R2 first, then call Meta with the URL.
  //
  // (Historically WhatsApp went upload-then-send via a Chakra /media
  // endpoint that does not actually exist — see whatsAppLinkSend's
  // docstring for the full forensic.)
  let providerMessageId: string;
  let metaIdentifier: string; // WA synthetic media_id or IG attachment_id
  let cached: MediaCachedMeta;

  if (input.channel === 'WHATSAPP') {
    // R2 first so we have a signed URL to hand to WhatsApp.
    const synthIdForKey = Math.abs(hashStr(`${input.conversationKey}:${Date.now()}`)) % 2_000_000_000;
    const persisted = await putToR2({
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      messageId: synthIdForKey,
      mediaIndex: 0,
      mimeType: effectiveMime,
      kind,
      buffer: effectiveBuffer,
    });
    if (!persisted) throw new Error('r2_eager_cache_failed');
    cached = persisted;

    const wa = await whatsAppLinkSend({ input, cached });
    providerMessageId = wa.providerMessageId;
    metaIdentifier = wa.metaMediaId;
  } else {
    // Instagram: R2 first so we have a URL to give Meta.
    const synthIdForKey = Math.abs(hashStr(`${input.conversationKey}:${Date.now()}`)) % 2_000_000_000;
    const persisted = await putToR2({
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      messageId: synthIdForKey,
      mediaIndex: 0,
      mimeType: input.mimeType,
      kind,
      buffer: input.buffer,
    });
    if (!persisted) throw new Error('r2_eager_cache_failed');
    cached = persisted;

    const ig = await instagramUploadAndSend({
      salonId: input.salonId,
      conversationKey: input.conversationKey,
      recipientPsid: input.recipientPhoneOrPsid,
      cached,
      kind,
    });
    providerMessageId = ig.providerMessageId;
    metaIdentifier = ig.metaAttachmentId;
  }

  const mediaItem: MediaItemMeta = {
    index: 0,
    type: kind,
    mimeType: effectiveMime,
    sizeBytes: effectiveBuffer.length,
    isVoice: kind === 'audio' && !!input.isVoice,
    caption: input.caption || undefined,
    providerMediaId: metaIdentifier,
  };

  // Persist the conversation event with media metadata + R2 reference.
  await upsertConversationMessageEvent({
    salonId: input.salonId,
    channel: input.channel,
    conversationKey: input.conversationKey,
    providerMessageId,
    messageType: kind === 'audio' && input.isVoice ? 'voice' : kind,
    text: input.caption || null,
    direction: 'OUTBOUND',
    eventTimestamp: new Date(),
    processingStatus: InboundMessageStatus.DONE,
    outboundSource: OutboundMessageSource.HUMAN_APP,
    outboundSenderUserId: input.senderUserId || null,
    outboundSenderEmail: input.senderUserEmail || null,
    rawPayload: {
      kind: 'outbound_media',
      channel: input.channel,
      metaIdentifier,
      sentAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    mediaItems: [mediaItem] as unknown as Prisma.InputJsonValue,
    mediaCached: [cached] as unknown as Prisma.InputJsonValue,
    mediaCachedAt: new Date(),
    metaMediaIds: (
      input.channel === 'WHATSAPP'
        ? { whatsapp: metaIdentifier }
        : { instagram: metaIdentifier }
    ) as Prisma.InputJsonValue,
    repliedToMessageId: input.replyToMessageId ?? undefined,
    repliedToProviderMessageId: input.replyToProviderMessageId ?? undefined,
    repliedToText: input.replyToText ?? undefined,
  });

  // Look up the row we just inserted so we can return its id to the caller.
  const row = await prisma.conversationMessageEvent.findUnique({
    where: {
      channel_providerMessageId: {
        channel: input.channel,
        providerMessageId,
      },
    },
    select: { id: true },
  });
  if (!row) throw new Error('post_insert_lookup_failed');

  return {
    messageId: row.id,
    providerMessageId,
    r2Cached: cached,
    mediaItem,
  };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
