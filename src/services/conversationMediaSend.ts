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
import FormData from 'form-data';
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
// WhatsApp upload-then-send
// ─────────────────────────────────────────────────────────────────

async function whatsAppUploadAndSend(
  input: SendMediaInput,
): Promise<{ providerMessageId: string; metaMediaId: string }> {
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

  // Step 1: upload bytes via Chakra's BSP proxy. The proxy URL pattern
  // mirrors WhatsApp Cloud API but is plugin-scoped:
  //   POST {CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/{pluginId}/api/{ver}/{phoneId}/media
  //   Auth: Bearer {CHAKRA_API_TOKEN}
  //   multipart: messaging_product=whatsapp, type=<mime>, file=<bytes>
  const uploadUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(pluginId)}/api/${encodeURIComponent(CHAKRA_WA_API_VERSION)}/${encodeURIComponent(phoneNumberId)}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', input.mimeType);
  form.append('file', input.buffer, {
    contentType: input.mimeType,
    filename: `upload.${kindToExt(input.kind, input.mimeType)}`,
  });
  const uploadResp = await axios.post(uploadUrl, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
    },
    timeout: 60_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  const metaMediaId = String(uploadResp.data?.id || '').trim();
  if (!metaMediaId) {
    throw new Error('whatsapp_media_upload_no_id');
  }

  // Step 2: send the message with the media_id payload. Same Chakra proxy.
  const sendUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(pluginId)}/api/${encodeURIComponent(CHAKRA_WA_API_VERSION)}/${encodeURIComponent(phoneNumberId)}/messages`;
  const whatsAppType: 'image' | 'video' | 'audio' = input.kind;
  const mediaPayload: Record<string, unknown> = { id: metaMediaId };
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
  const sendResp = await axios.post(sendUrl, body, {
    headers: {
      Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 25_000,
  });
  const providerMessageId = String(
    sendResp.data?.messages?.[0]?.id ||
      sendResp.data?.data?.messages?.[0]?.id ||
      `wa_out_${randomToken(8)}`,
  );
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

function kindToExt(kind: MediaKind, mime: string): string {
  const m = mime.toLowerCase();
  if (kind === 'image') return m.includes('png') ? 'png' : 'jpg';
  if (kind === 'video') return 'mp4';
  // audio
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('m4a') || m.includes('mp4')) return 'm4a';
  if (m.includes('aac')) return 'aac';
  return 'bin';
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

  // ── Order of operations differs by channel ────────────────────────
  //
  // WhatsApp: multipart upload to Meta first, then R2. If Meta accepts
  //   we know the WABA likes the bytes, so committing to R2 makes sense.
  //
  // Instagram: Meta needs a publicly-fetchable URL to ingest, so we
  //   MUST write to R2 first to mint a signed URL. The send-to-Meta
  //   call then references that URL.
  //
  // Both paths converge on the same DB write at the end.
  let providerMessageId: string;
  let metaIdentifier: string; // WA media_id or IG attachment_id
  let cached: MediaCachedMeta;

  if (input.channel === 'WHATSAPP') {
    const wa = await whatsAppUploadAndSend(input);
    providerMessageId = wa.providerMessageId;
    metaIdentifier = wa.metaMediaId;

    const fakeMessageIdForKey = Math.abs(hashStr(providerMessageId)) % 2_000_000_000;
    const persisted = await putToR2({
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      messageId: fakeMessageIdForKey,
      mediaIndex: 0,
      mimeType: input.mimeType,
      kind,
      buffer: input.buffer,
    });
    if (!persisted) throw new Error('r2_eager_cache_failed');
    cached = persisted;
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
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
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
