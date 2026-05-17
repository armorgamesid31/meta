// Kedy-central WhatsApp sender.
//
// Distinct from whatsappTemplateSender.ts (which routes through each
// SALON's Chakra plugin to send customer-facing messages). Kedy's own
// operational messages — team-invite activation magic-link, password
// reset, account verification — go through Kedy's CENTRAL WhatsApp
// Business number directly via Meta Cloud API, so the recipient sees
// "Kedy" as the sender rather than whichever salon happened to invite
// them.
//
// Required env:
//   KEDY_WHATSAPP_TOKEN            System-user permanent access token
//   KEDY_WHATSAPP_PHONE_NUMBER_ID  The phone-number ID of Kedy's WABA
//   META_GRAPH_VERSION             e.g. v25.0 (default if unset)

import axios from 'axios';
import { normalizeDigitsOnly } from './phoneValidation.js';

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v25.0').trim();
const KEDY_WHATSAPP_TOKEN = (process.env.KEDY_WHATSAPP_TOKEN || '').trim();
const KEDY_WHATSAPP_PHONE_NUMBER_ID = (process.env.KEDY_WHATSAPP_PHONE_NUMBER_ID || '').trim();

export function isKedyWhatsappConfigured(): boolean {
  return Boolean(KEDY_WHATSAPP_TOKEN && KEDY_WHATSAPP_PHONE_NUMBER_ID);
}

interface SendTemplateInput {
  to: string;
  templateName: string;
  language?: string;
  components?: Array<Record<string, unknown>>;
}

interface SendTemplateResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendCentralTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
  if (!isKedyWhatsappConfigured()) {
    return { ok: false, error: 'kedy_whatsapp_not_configured' };
  }
  const to = normalizeDigitsOnly(input.to);
  if (!to) {
    return { ok: false, error: 'recipient_phone_invalid' };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(KEDY_WHATSAPP_PHONE_NUMBER_ID)}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language || 'tr' },
      ...(input.components && input.components.length > 0 ? { components: input.components } : {}),
    },
  };

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${KEDY_WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 25_000,
    });
    const messageId = response?.data?.messages?.[0]?.id || undefined;
    return { ok: true, messageId };
  } catch (error: any) {
    const reason =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'unknown_error';
    console.error('[whatsappCentralSender] send failed', {
      to,
      template: input.templateName,
      status: error?.response?.status,
      reason,
    });
    return { ok: false, error: String(reason) };
  }
}

/**
 * Sends the `kedyekip` UTILITY template. The template has a single
 * URL-button parameter that receives the magic-link token; everything
 * else (header, body copy) is static and pre-approved.
 */
export async function sendKedyEkipTemplate(input: { phone: string; token: string }): Promise<SendTemplateResult> {
  if (!input.token) {
    return { ok: false, error: 'token_missing' };
  }
  return sendCentralTemplate({
    to: input.phone,
    templateName: 'kedyekip',
    language: 'tr',
    components: [
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: input.token }],
      },
    ],
  });
}
