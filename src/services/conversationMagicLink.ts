/**
 * "Send magic link from a conversation" — used by the conversation panel
 * button that lets the salon push a tokenized URL to the customer
 * inside the active chat.
 *
 * Distinct from /magic-link/create (which is a generic create-only API
 * used by automations + webhooks). This service:
 *   1. Resolves the active conversation (salon + channel + customer)
 *   2. Calls ensureMagicLink() to mint / renew a magic-link row
 *   3. Pushes a WhatsApp interactive-button message to the customer
 *      (free-form, inside the 24h customer-service window — no Meta
 *      template required; outside the window the caller gets a clear
 *      error and the link is still returned for manual copy-paste).
 *   4. Logs the outbound as a ConversationMessageEvent so it appears
 *      in the chat history with the same styling as any other reply.
 *
 * Instagram outbound is intentionally NOT implemented yet — the
 * PSID/recipient handshake is the same heavyweight thing the media
 * sender deals with. For Instagram the endpoint returns the magic URL
 * but skips the send (the UI shows a "Manuel kopyala" fallback).
 */

import axios from 'axios';
import {
  ChannelType,
  MagicLinkType,
  MessageEventDirection,
  OutboundMessageSource,
  Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { ensureMagicLink } from './magicLinkService.js';
import { upsertConversationMessageEvent } from './conversationMessageEvents.js';
import { normalizeDigitsOnly } from './phoneValidation.js';

const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com')
  .trim()
  .replace(/\/+$/, '');
const CHAKRA_WHATSAPP_SEND_URL_TEMPLATE = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();

function buildChakraWhatsappSendUrl(pluginId: string, phoneNumberId: string): string {
  if (CHAKRA_WHATSAPP_SEND_URL_TEMPLATE) {
    const hasPlaceholders =
      CHAKRA_WHATSAPP_SEND_URL_TEMPLATE.includes('{pluginId}') ||
      CHAKRA_WHATSAPP_SEND_URL_TEMPLATE.includes('{whatsappPhoneNumberId}');
    if (hasPlaceholders) {
      return CHAKRA_WHATSAPP_SEND_URL_TEMPLATE
        .replaceAll('{pluginId}', encodeURIComponent(pluginId))
        .replaceAll('{whatsappPhoneNumberId}', encodeURIComponent(phoneNumberId));
    }
    return CHAKRA_WHATSAPP_SEND_URL_TEMPLATE;
  }
  return `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(pluginId)}/api/v19.0/${encodeURIComponent(phoneNumberId)}/messages`;
}

export interface SendConversationMagicLinkInput {
  salonId: number;
  conversationKey: string;
  type?: MagicLinkType;
  /** Required for CANCEL / RESCHEDULE. */
  appointmentId?: number | null;
  /** Optional custom prelude text. Defaults to a type-aware sentence. */
  customMessage?: string | null;
  /** For audit on the outbound row. */
  senderUserId?: number | null;
  senderUserEmail?: string | null;
}

export interface SendConversationMagicLinkResult {
  ok: boolean;
  magicUrl: string;
  token: string;
  expiresAt: Date;
  channel: ChannelType;
  /** Set to false when channel is supported but send failed (or IG outbound is stubbed). */
  delivered: boolean;
  /** Error code surfaced to the caller when delivered=false. */
  error?: string;
}

const DEFAULT_COPY: Record<MagicLinkType, string> = {
  BOOKING: 'Randevu almanız için hazırladığım linki paylaşıyorum:',
  RESCHEDULE: 'Randevunuzu yeniden planlamanız için linki paylaşıyorum:',
  CANCEL: 'Randevunuzu iptal etmek için linki kullanabilirsiniz:',
};

export async function sendMagicLinkInConversation(
  input: SendConversationMagicLinkInput,
): Promise<SendConversationMagicLinkResult> {
  const type = input.type || 'BOOKING';
  if ((type === 'CANCEL' || type === 'RESCHEDULE') && !input.appointmentId) {
    throw new Error('APPOINTMENT_REQUIRED_FOR_TYPE');
  }

  // 1. Look up the latest identity session for this conversation so we
  //    know the channel + customer subject. Sessions are upserted on
  //    every inbound message and are the canonical conversation record.
  const session = await prisma.identitySession.findFirst({
    where: { salonId: input.salonId, conversationKey: input.conversationKey },
    orderBy: { lastInboundAt: 'desc' },
  });
  if (!session) {
    throw new Error('CONVERSATION_NOT_FOUND');
  }

  // 2. Validate appointment ownership for CANCEL/RESCHEDULE so the
  //    customer can't be tricked into cancelling someone else's booking.
  if (input.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: {
        id: input.appointmentId,
        salonId: input.salonId,
        status: 'BOOKED',
      },
      select: { id: true, customerPhone: true },
    });
    if (!appt) throw new Error('APPOINTMENT_NOT_FOUND');
  }

  // 3. Mint (or renew) a magic link.
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: { slug: true, chakraPluginId: true, chakraPhoneNumberId: true },
  });
  const linkResult = await ensureMagicLink({
    salonId: input.salonId,
    type,
    phone: session.subjectRaw,
    customerKey: session.subjectNormalized,
    channel: session.channel,
    conversationKey: input.conversationKey,
    canonicalUserId: session.canonicalUserId,
    customerId: session.customerId,
    context: input.appointmentId ? { appointmentId: input.appointmentId } : {},
    salonSlug: salon?.slug || null,
  });

  const body =
    (input.customMessage?.trim() || DEFAULT_COPY[type]) +
    `\n\n${linkResult.magicUrl}\n\nBu link 60 dakika geçerli.`;

  // 4. Instagram outbound is not implemented yet; return the URL so the
  //    UI can offer "manual copy" fallback.
  if (session.channel !== ChannelType.WHATSAPP) {
    return {
      ok: true,
      magicUrl: linkResult.magicUrl,
      token: linkResult.token,
      expiresAt: linkResult.expiresAt,
      channel: session.channel,
      delivered: false,
      error: 'INSTAGRAM_OUTBOUND_NOT_IMPLEMENTED',
    };
  }

  // 5. WhatsApp: send a free-form interactive message with a URL button.
  //    Free-form messages are valid only inside the 24-hour customer
  //    service window — Meta returns an error if the window expired.
  //    We surface that error code so the UI can switch to "manual copy".
  if (!salon?.chakraPluginId || !salon.chakraPhoneNumberId) {
    return {
      ok: true,
      magicUrl: linkResult.magicUrl,
      token: linkResult.token,
      expiresAt: linkResult.expiresAt,
      channel: session.channel,
      delivered: false,
      error: 'SALON_WHATSAPP_NOT_CONNECTED',
    };
  }

  const to = normalizeDigitsOnly(session.subjectRaw);
  if (!to) {
    return {
      ok: true,
      magicUrl: linkResult.magicUrl,
      token: linkResult.token,
      expiresAt: linkResult.expiresAt,
      channel: session.channel,
      delivered: false,
      error: 'RECIPIENT_PHONE_INVALID',
    };
  }

  const ctaButtonLabel: Record<MagicLinkType, string> = {
    BOOKING: 'Randevu al',
    RESCHEDULE: 'Yeniden planla',
    CANCEL: 'İptal et',
  };
  const buttonLabel = ctaButtonLabel[type] || 'Aç';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;

  // WhatsApp Cloud API interactive cta_url has a 20-char label limit on
  // the button (truncated by Meta otherwise) and ~1024 chars body.
  const interactivePayload = {
    pluginId: salon.chakraPluginId,
    phoneNumberId: salon.chakraPhoneNumberId,
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: body.slice(0, 1024) },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: buttonLabel.slice(0, 20),
          url: linkResult.magicUrl,
        },
      },
    },
  };

  const sendUrl = buildChakraWhatsappSendUrl(salon.chakraPluginId, salon.chakraPhoneNumberId);
  let providerMessageId = '';
  let textFallback = body;

  try {
    const response = await axios.post(sendUrl, interactivePayload, { headers, timeout: 25_000 });
    providerMessageId =
      response?.data?.messages?.[0]?.id ||
      response?.data?.data?.messages?.[0]?.id ||
      response?.data?._data?.whatsappMessageId ||
      '';
  } catch (err: any) {
    // Some Chakra plugin variants don't expose interactive cta_url. Fall
    // back to plain text — the URL is still tappable in WhatsApp, just
    // not as a styled button.
    const reason =
      err?.response?.data?.error?.message ||
      err?.response?.data?.message ||
      err?.message ||
      'unknown_error';
    console.warn('[conversationMagicLink] interactive send failed, falling back to text', {
      salonId: input.salonId,
      reason,
    });
    const textPayload = {
      pluginId: salon.chakraPluginId,
      phoneNumberId: salon.chakraPhoneNumberId,
      to,
      type: 'text',
      text: { body: textFallback.slice(0, 4096) },
    };
    try {
      const response = await axios.post(sendUrl, textPayload, { headers, timeout: 25_000 });
      providerMessageId =
        response?.data?.messages?.[0]?.id ||
        response?.data?.data?.messages?.[0]?.id ||
        response?.data?._data?.whatsappMessageId ||
        '';
    } catch (err2: any) {
      const reason2 =
        err2?.response?.data?.error?.message ||
        err2?.response?.data?.message ||
        err2?.message ||
        'unknown_error';
      console.error('[conversationMagicLink] text send also failed', {
        salonId: input.salonId,
        reason: reason2,
      });
      return {
        ok: true,
        magicUrl: linkResult.magicUrl,
        token: linkResult.token,
        expiresAt: linkResult.expiresAt,
        channel: session.channel,
        delivered: false,
        error: `WHATSAPP_SEND_FAILED:${reason2}`,
      };
    }
  }

  // 6. Log into conversation history so the salon sees it in the chat
  //    immediately. We rely on the provider's eventual echo webhook to
  //    de-dup against our row via providerMessageId.
  if (providerMessageId) {
    try {
      await upsertConversationMessageEvent({
        salonId: input.salonId,
        channel: ChannelType.WHATSAPP,
        conversationKey: input.conversationKey,
        providerMessageId,
        externalAccountId: salon.chakraPhoneNumberId,
        messageType: 'text',
        text: textFallback,
        direction: MessageEventDirection.OUTBOUND,
        eventTimestamp: new Date(),
        outboundSource: OutboundMessageSource.HUMAN_RESPONSE,
        outboundSenderUserId: input.senderUserId || null,
        outboundSenderEmail: input.senderUserEmail || null,
        rawPayload: { type: 'magic_link_cta', linkType: type, url: linkResult.magicUrl } as Prisma.InputJsonValue,
      });
    } catch (err) {
      console.error('[conversationMagicLink] event log failed', err);
    }
  }

  return {
    ok: true,
    magicUrl: linkResult.magicUrl,
    token: linkResult.token,
    expiresAt: linkResult.expiresAt,
    channel: session.channel,
    delivered: Boolean(providerMessageId),
  };
}
