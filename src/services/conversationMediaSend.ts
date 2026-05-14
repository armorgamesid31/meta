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
  putToR2,
  randomToken,
  type MediaItemMeta,
  type MediaCachedMeta,
  type MediaKind,
} from './conversationMediaCache.js';

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v22.0').trim();
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();

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

  // Step 1: upload bytes to WhatsApp Cloud API. Through Chakra's plugin
  // proxy so the WABA-scoped token applies automatically.
  //
  // POST https://graph.facebook.com/{ver}/{phone_number_id}/media
  //   multipart: messaging_product=whatsapp, type=<mime>, file=<bytes>
  const uploadUrl = `${META_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/media`;
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

  // Step 2: send the message with the media_id payload.
  //
  // POST https://graph.facebook.com/{ver}/{phone_number_id}/messages
  const sendUrl = `${META_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
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
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.recipientPhoneOrPsid,
    type: whatsAppType,
    [whatsAppType]: mediaPayload,
  };
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

  if (input.channel === 'INSTAGRAM') {
    // Instagram outbound requires the full PSID/recipient resolution dance
    // implemented in adminMobile.ts's /reply handler. Faz 1 ships WhatsApp
    // first; IG outbound is scheduled for Faz 1.5.
    throw new Error('instagram_outbound_not_implemented');
  }
  if (input.channel !== 'WHATSAPP') {
    throw new Error('unsupported_channel');
  }

  // Step 1: dispatch to Meta first so a failed upload doesn't leave a
  // ghost R2 object + DB row that the salon never actually sent.
  const { providerMessageId, metaMediaId } = await whatsAppUploadAndSend(input);

  // Step 2: now that Meta accepted, persist to R2 (eager cache).
  // Reserve a synthetic messageId before insert so the R2 key can include
  // it. We'll use the providerMessageId hash; the actual DB row gets
  // created in step 3 and references the same R2 key via mediaCached.
  //
  // We can't know the auto-incremented id ahead of time, so build the
  // R2 key from providerMessageId + index to keep keys stable. Then the
  // DB row carries the r2Key in mediaCached and read endpoint resolves
  // by stored key, not by re-derivation.
  const fakeMessageIdForKey = Math.abs(hashStr(providerMessageId)) % 2_000_000_000;
  const cached = await putToR2({
    salonId: input.salonId,
    channel: input.channel,
    conversationKey: input.conversationKey,
    messageId: fakeMessageIdForKey,
    mediaIndex: 0,
    mimeType: input.mimeType,
    kind,
    buffer: input.buffer,
  });
  if (!cached) {
    // Meta accepted the send but our R2 write failed. The customer will
    // see the message on their phone but our staff can't replay it from
    // history. Surface the failure; admin can retrigger ingestion later.
    throw new Error('r2_eager_cache_failed');
  }

  const mediaItem: MediaItemMeta = {
    index: 0,
    type: kind,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    isVoice: kind === 'audio' && !!input.isVoice,
    caption: input.caption || undefined,
    providerMediaId: metaMediaId,
  };

  // Step 3: persist conversation event.
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
      metaMediaId,
      sentAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    mediaItems: [mediaItem] as unknown as Prisma.InputJsonValue,
    mediaCached: [cached] as unknown as Prisma.InputJsonValue,
    mediaCachedAt: new Date(),
    metaMediaIds: { whatsapp: metaMediaId } as Prisma.InputJsonValue,
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
