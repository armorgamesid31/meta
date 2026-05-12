// WhatsApp UTILITY-template sender — sends the kdy_dogrulama_link template
// from a salon's connected WABA via Chakra.
//
// This is intentionally separate from phoneVerification.ts (which still
// sends plain-text OTP for legacy AUTH-style flows). The new verification
// system is template-based and link-bearing.

import axios from 'axios';
import { prisma } from '../prisma.js';
import { normalizeDigitsOnly } from './phoneValidation.js';

const CHAKRA_WHATSAPP_SEND_URL = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com')
  .trim()
  .replace(/\/+$/, '');

const TEMPLATE_NAME = 'kdy_dogrulama_link';
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
  /**
   * Name to greet the recipient. Customer name or user displayName.
   */
  name: string;
  /**
   * Human-readable purpose: "Bella Studio salonu randevu" /
   * "Kedy ekip katılımı" / "Kedy numara değişikliği"
   */
  salonOrAction: string;
  /** Full URL to the magic-link landing page. */
  verificationLink: string;
  /** TTL in minutes (string, will be coerced). */
  ttlMinutes: number;
  /** Sender brand line — typically salon name; "Kedy" for internal flows. */
  footerBrand: string;
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
    select: { chakraPluginId: true, chakraPhoneNumberId: true },
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

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) {
    headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;
  }

  const sendUrl = buildSendUrl(salon.chakraPluginId, phoneNumberId);

  // Meta WhatsApp Cloud API template message shape (NAMED parameters):
  //   template.components[].parameters[].parameter_name + .text
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
          type: 'body',
          parameters: [
            { type: 'text', parameter_name: 'name', text: truncate(input.name, 50) },
            { type: 'text', parameter_name: 'salon_or_action', text: truncate(input.salonOrAction, 80) },
            { type: 'text', parameter_name: 'verification_link', text: input.verificationLink },
            { type: 'text', parameter_name: 'ttl', text: String(input.ttlMinutes) },
            { type: 'text', parameter_name: 'footer_brand', text: truncate(input.footerBrand, 40) },
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
