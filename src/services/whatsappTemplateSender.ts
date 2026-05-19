// WhatsApp UTILITY-template sender — sends the kdy_islem_link template
// from a salon's connected WABA via Chakra. Customer-facing phone
// verification (CUSTOMER_PHONE, CUSTOMER_LINK_CONSENT, PHONE_CHANGE)
// reaches the customer from the salon's own WhatsApp Business number,
// so the salon's brand and trust transfers to the verification flow.
//
// Template shape (defined in chakra.ts):
//   HEADER:  {{salonname}}                  — salon brand
//   BODY:    static text (no variables)
//   BUTTON:  URL https://.../c/v/{{1}}     — {{1}} = raw token
//
// This is intentionally separate from phoneVerification.ts (legacy
// plain-text OTP for AUTH-style flows). The new verification system is
// template-based and link-bearing.

import axios from 'axios';
import {
  ChannelType,
  InboundMessageStatus,
  MessageEventDirection,
  Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { normalizeDigitsOnly } from './phoneValidation.js';
import { upsertConversationMessageEvent } from './conversationMessageEvents.js';

const CHAKRA_WHATSAPP_SEND_URL = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com')
  .trim()
  .replace(/\/+$/, '');

const TEMPLATE_NAME = 'kdy_islem_link';
const TEMPLATE_LANG = 'tr';

function buildSendUrl(pluginId: string, phoneNumberId: string): string {
  if (CHAKRA_WHATSAPP_SEND_URL) {
    const hasPlaceholders =
      CHAKRA_WHATSAPP_SEND_URL.includes('{pluginId}') ||
      CHAKRA_WHATSAPP_SEND_URL.includes('{whatsappPhoneNumberId}');
    if (hasPlaceholders) {
      return CHAKRA_WHATSAPP_SEND_URL
        .replaceAll('{pluginId}', encodeURIComponent(pluginId))
        .replaceAll('{whatsappPhoneNumberId}', encodeURIComponent(phoneNumberId));
    }
    return CHAKRA_WHATSAPP_SEND_URL;
  }
  return `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(pluginId)}/api/v19.0/${encodeURIComponent(phoneNumberId)}/messages`;
}

export interface SendVerificationTemplateInput {
  salonId: number;
  phone: string; // E.164 or digits; will be normalized
  /** Raw verification token. Becomes {{1}} in the button URL. */
  token: string;

  // Legacy fields retained for caller-compat. The kdy_islem_link template
  // only carries {{salonname}} (header, from DB) + static body + token
  // (button URL). Everything else is intentionally absent so the message
  // stays generic enough to cover all customer-verification purposes
  // (CUSTOMER_PHONE, CUSTOMER_LINK_CONSENT, PHONE_CHANGE).
  /** @deprecated unused — TTL is communicated by the landing page itself */
  ttlMinutes?: number;
  /** @deprecated unused — salon name comes from DB lookup */
  name?: string;
  /** @deprecated unused — purpose is implied by the template itself */
  salonOrAction?: string;
  /** @deprecated unused — full URL is no longer needed, only token */
  verificationLink?: string;
  /** @deprecated unused — brand comes from the salon header */
  footerBrand?: string;
}

export interface SendVerificationTemplateResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendVerificationLinkTemplate(
  input: SendVerificationTemplateInput,
): Promise<SendVerificationTemplateResult> {
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: { name: true, chakraPluginId: true, chakraPhoneNumberId: true },
  });

  if (!salon?.chakraPluginId) {
    throw new Error('salon_whatsapp_not_connected');
  }
  const phoneNumberId = typeof salon.chakraPhoneNumberId === 'string'
    ? salon.chakraPhoneNumberId.trim()
    : '';
  if (!phoneNumberId) {
    throw new Error('salon_whatsapp_phone_not_connected');
  }

  const to = normalizeDigitsOnly(input.phone);
  if (!to) {
    throw new Error('recipient_phone_invalid');
  }

  if (!input.token) {
    throw new Error('verification_token_missing');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) {
    headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;
  }

  const sendUrl = buildSendUrl(salon.chakraPluginId, phoneNumberId);

  // Meta WhatsApp Cloud API template message shape for kdy_islem_link:
  //   HEADER:  named param salonname  → salon's display name
  //   BODY:    static (no parameters needed)
  //   BUTTON:  URL placeholder {{1}}  → raw verification token
  const body = {
    pluginId: salon.chakraPluginId,
    phoneNumberId,
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components: [
        {
          type: 'header',
          parameters: [
            { type: 'text', parameter_name: 'salonname', text: truncate(salon.name || 'Salon', 60) },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            { type: 'text', text: input.token },
          ],
        },
      ],
    },
  };

  try {
    const response = await axios.post(sendUrl, body, { headers, timeout: 25_000 });
    const messageId =
      response?.data?.messages?.[0]?.id ||
      response?.data?.data?.messages?.[0]?.id ||
      undefined;

    // Log verification template into conversation thread so the salon
    // sees an outbound "doğrulama linki gönderildi" bubble.
    if (messageId) {
      void logTemplateOutbound({
        salonId: input.salonId,
        recipientPhoneNormalized: to,
        externalAccountId: phoneNumberId,
        messageId,
        templateName: TEMPLATE_NAME,
        displayText: 'Doğrulama linki gönderildi.',
        bodyParams: undefined,
        metadata: { kind: 'verification_link', token: input.token },
      }).catch((err) => {
        console.error('[whatsappTemplateSender] verify-template log failed', {
          salonId: input.salonId,
          err,
        });
      });
    }
    return { ok: true, messageId };
  } catch (error: any) {
    const reason =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'unknown_error';
    console.error('[whatsappTemplateSender] send failed', {
      salonId: input.salonId,
      to,
      reason,
      status: error?.response?.status,
    });
    return { ok: false, error: String(reason) };
  }
}

function truncate(value: string, max: number): string {
  const v = String(value || '').trim();
  if (v.length <= max) return v;
  return v.slice(0, max - 1) + '…';
}

export const VERIFICATION_TEMPLATE_NAME = TEMPLATE_NAME;
export const VERIFICATION_TEMPLATE_LANG = TEMPLATE_LANG;

// ─────────────────────────────────────────────────────────────────
// Generic template sender — used by lifecycle notifications.
//
// Caller passes:
//   - salonId (resolves Chakra WABA credentials)
//   - templateName (Meta-registered name)
//   - recipientPhone (digits-only E.164 minus '+')
//   - bodyParams: NAMED-param map for {{var}} in body
//   - headerParams (opt): NAMED-param map for header
//   - buttonParams (opt): list of button parameter values (positional)
// ─────────────────────────────────────────────────────────────────

export interface SendTemplateInput {
  salonId: number;
  templateName: string;
  recipientPhone: string;
  bodyParams?: Record<string, string>;
  headerParams?: Record<string, string>;
  buttonParams?: Array<{ type: 'url' | 'quick_reply'; value: string }>;
  language?: string;
  /**
   * Optional human-readable preview text for the conversation log. When
   * provided this becomes the `text` field on the ConversationMessageEvent
   * row so the salon's chat thread shows the same wording the customer
   * sees on WhatsApp. If omitted we fall back to a synthetic "[Şablon:
   * <name>]" placeholder so the row at least appears in the thread.
   */
  conversationDisplayText?: string;
  /**
   * Optional appointment / customer / magic-link metadata to attach to
   * the conversation row (rawPayload). Helps the UI deeplink the system
   * notification back to the appointment when the salon taps the row.
   */
  conversationMetadata?: Record<string, unknown>;
}

export interface SendTemplateResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: { chakraPluginId: true, chakraPhoneNumberId: true },
  });
  if (!salon?.chakraPluginId) {
    return { ok: false, error: 'salon_whatsapp_not_connected' };
  }
  const phoneNumberId = (salon.chakraPhoneNumberId || '').trim();
  if (!phoneNumberId) {
    return { ok: false, error: 'salon_whatsapp_phone_not_connected' };
  }

  const to = normalizeDigitsOnly(input.recipientPhone);
  if (!to) {
    return { ok: false, error: 'recipient_phone_invalid' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) {
    headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;
  }

  const sendUrl = buildSendUrl(salon.chakraPluginId, phoneNumberId);

  const components: any[] = [];

  // Header (NAMED params) — only when provided
  if (input.headerParams && Object.keys(input.headerParams).length > 0) {
    components.push({
      type: 'header',
      parameters: Object.entries(input.headerParams).map(([name, value]) => ({
        type: 'text',
        parameter_name: name,
        text: truncate(String(value || ''), 60),
      })),
    });
  }

  // Body (NAMED params)
  if (input.bodyParams && Object.keys(input.bodyParams).length > 0) {
    components.push({
      type: 'body',
      parameters: Object.entries(input.bodyParams).map(([name, value]) => ({
        type: 'text',
        parameter_name: name,
        text: truncate(String(value || ''), 1024),
      })),
    });
  }

  // Buttons (positional) — Meta indexes each button separately
  if (input.buttonParams && input.buttonParams.length > 0) {
    input.buttonParams.forEach((btn, index) => {
      components.push({
        type: 'button',
        sub_type: btn.type, // 'url' or 'quick_reply'
        index,
        parameters: [
          btn.type === 'url'
            ? { type: 'text', text: btn.value }
            : { type: 'payload', payload: btn.value },
        ],
      });
    });
  }

  const body = {
    pluginId: salon.chakraPluginId,
    phoneNumberId,
    to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language || TEMPLATE_LANG },
      components,
    },
  };

  try {
    const response = await axios.post(sendUrl, body, { headers, timeout: 25_000 });
    const messageId =
      response?.data?.messages?.[0]?.id ||
      response?.data?.data?.messages?.[0]?.id ||
      undefined;

    if (messageId) {
      void logTemplateOutbound({
        salonId: input.salonId,
        recipientPhoneNormalized: to,
        externalAccountId: phoneNumberId,
        messageId,
        templateName: input.templateName,
        displayText: input.conversationDisplayText,
        bodyParams: input.bodyParams,
        metadata: input.conversationMetadata,
      }).catch((err) => {
        console.error('[sendTemplate] conversation log failed', {
          salonId: input.salonId,
          template: input.templateName,
          err,
        });
      });
    }
    return { ok: true, messageId };
  } catch (error: any) {
    const reason =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'unknown_error';
    console.error('[sendTemplate] failed', {
      salonId: input.salonId,
      template: input.templateName,
      to,
      reason,
      status: error?.response?.status,
    });
    return { ok: false, error: String(reason) };
  }
}

// ─────────────────────────────────────────────────────────────────
// Conversation-thread logging for outbound templates.
//
// Without this, lifecycle reminders / waitlist offers / verification
// links / birthday vouchers etc. get sent silently — the salon never
// sees them in their chat thread. We mirror each successful send into
// ConversationMessageEvent so the bubble appears alongside the rest of
// the conversation. Read by adminMobile.ts conversation-detail.
// ─────────────────────────────────────────────────────────────────

interface LogTemplateOutboundInput {
  salonId: number;
  recipientPhoneNormalized: string;
  externalAccountId: string;
  messageId: string;
  templateName: string;
  displayText?: string;
  bodyParams?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

function renderDisplayText(
  templateName: string,
  displayText?: string,
  bodyParams?: Record<string, string>,
): string {
  if (displayText && displayText.trim()) return displayText.trim();
  const params =
    bodyParams && Object.keys(bodyParams).length > 0
      ? Object.values(bodyParams).filter((v) => v && v.trim()).join(' · ')
      : '';
  return params ? `[Şablon: ${templateName}] ${params}` : `[Şablon: ${templateName}]`;
}

async function resolveConversationKeyForPhone(
  salonId: number,
  phoneNormalized: string,
): Promise<string> {
  // Prefer an existing identity session's conversationKey so the row
  // threads correctly under the same chat the customer started. Falls
  // back to a synthetic `WHATSAPP:<digits>` key — same shape webhook
  // ingestion uses for net-new threads.
  const session = await prisma.identitySession.findFirst({
    where: {
      salonId,
      channel: ChannelType.WHATSAPP,
      subjectNormalized: phoneNormalized,
    },
    orderBy: { updatedAt: 'desc' },
    select: { conversationKey: true },
  });
  if (session?.conversationKey) return session.conversationKey;
  return `WHATSAPP:${phoneNormalized}`;
}

async function logTemplateOutbound(input: LogTemplateOutboundInput): Promise<void> {
  const conversationKey = await resolveConversationKeyForPhone(
    input.salonId,
    input.recipientPhoneNormalized,
  );
  const text = renderDisplayText(input.templateName, input.displayText, input.bodyParams);
  await upsertConversationMessageEvent({
    salonId: input.salonId,
    channel: ChannelType.WHATSAPP,
    conversationKey,
    providerMessageId: input.messageId,
    externalAccountId: input.externalAccountId,
    messageType: `template_${input.templateName}_outbound`,
    text,
    direction: MessageEventDirection.OUTBOUND,
    eventTimestamp: new Date(),
    processingStatus: InboundMessageStatus.DONE,
    // No outboundSource — automated template sends are system-triggered,
    // not "AI agent" or "human in the app". The frontend's
    // resolveOutboundMessageMeta degrades gracefully when null.
    outboundSource: null,
    rawPayload: {
      kind: 'template_outbound',
      templateName: input.templateName,
      bodyParams: input.bodyParams || null,
      metadata: input.metadata || null,
    } as Prisma.InputJsonValue,
  });
}
