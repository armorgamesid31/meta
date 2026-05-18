// Kedy-central WhatsApp sender — routes through Chakra.
//
// Distinct from whatsappTemplateSender.ts (which keys off each SALON's
// Chakra plugin to send customer-facing messages). Kedy's own
// operational outbound — team-invite activation magic-link, password
// reset, account verification — goes through KEDY'S OWN Chakra-
// connected WhatsApp Business number, so the recipient sees "Kedy"
// as the sender rather than whichever salon happened to invite them.
//
// Required env:
//   KEDY_CENTRAL_CHAKRA_PLUGIN_ID         Plugin id for Kedy's WABA
//   KEDY_CENTRAL_CHAKRA_PHONE_NUMBER_ID   Phone-number id for Kedy's WABA
//   CHAKRA_API_TOKEN                      Shared token (already in env)
//   CHAKRA_WHATSAPP_SEND_URL              Optional override (else built
//                                         from CHAKRA_API_BASE)

import axios from 'axios';
import { normalizeDigitsOnly } from './phoneValidation.js';

const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com')
  .trim()
  .replace(/\/+$/, '');
const CHAKRA_WHATSAPP_SEND_URL = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();
const KEDY_CENTRAL_PLUGIN_ID = (process.env.KEDY_CENTRAL_CHAKRA_PLUGIN_ID || '').trim();
const KEDY_CENTRAL_PHONE_NUMBER_ID = (process.env.KEDY_CENTRAL_CHAKRA_PHONE_NUMBER_ID || '').trim();

export function isKedyWhatsappConfigured(): boolean {
  return Boolean(CHAKRA_API_TOKEN && KEDY_CENTRAL_PLUGIN_ID && KEDY_CENTRAL_PHONE_NUMBER_ID);
}

function buildSendUrl(): string {
  if (CHAKRA_WHATSAPP_SEND_URL) {
    const hasPlaceholders =
      CHAKRA_WHATSAPP_SEND_URL.includes('{pluginId}') ||
      CHAKRA_WHATSAPP_SEND_URL.includes('{whatsappPhoneNumberId}');
    if (hasPlaceholders) {
      return CHAKRA_WHATSAPP_SEND_URL
        .replaceAll('{pluginId}', encodeURIComponent(KEDY_CENTRAL_PLUGIN_ID))
        .replaceAll('{whatsappPhoneNumberId}', encodeURIComponent(KEDY_CENTRAL_PHONE_NUMBER_ID));
    }
    return CHAKRA_WHATSAPP_SEND_URL;
  }
  return `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(KEDY_CENTRAL_PLUGIN_ID)}/api/v19.0/${encodeURIComponent(KEDY_CENTRAL_PHONE_NUMBER_ID)}/messages`;
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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
  };

  // The new Chakra plugin shape passes the body straight through to
  // Meta's Cloud API, which insists on messaging_product and rejects
  // the legacy pluginId/phoneNumberId fields-in-body. The old per-salon
  // plugins still accept the legacy shape; we only target this newer
  // shape on the Kedy-central path.
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
    const response = await axios.post(buildSendUrl(), body, { headers, timeout: 25_000 });
    // Chakra responds with { _data: { whatsappMessageId } } when in
    // Meta-passthrough mode, and the legacy shape with `messages[0].id`
    // on older plugins — accept both.
    const messageId =
      response?.data?._data?.whatsappMessageId ||
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
