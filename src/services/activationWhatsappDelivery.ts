// Activation WhatsApp delivery — sends the Stripe-checkout-completed
// activation code to the salon owner's WhatsApp number using the
// `kdy_aktivasyon_kodu` UTILITY template.
//
// Status: STUB. Meta has not approved the kdy_aktivasyon_kodu template yet,
// and the WABA we'd send from is the central Kedy account (not a
// salon-scoped account — salons don't have WhatsApp connected at this
// stage of the funnel). Until WA_ACTIVATION_ENABLED=true is set, this
// module only logs to the console; the email path (activationDelivery.ts)
// is the primary delivery channel during the rollout.
//
// To enable real sending later:
//   1) Get the kdy_aktivasyon_kodu template approved by Meta on Kedy's
//      central WABA (3 parameters: ownerName, salonName, code).
//   2) Make sure CHAKRA_API_TOKEN + WA_ACTIVATION_PLUGIN_ID +
//      WA_ACTIVATION_PHONE_NUMBER_ID env vars point at the central WABA.
//   3) Set WA_ACTIVATION_ENABLED=true in Coolify.

import axios from 'axios';
import { normalizeDigitsOnly } from './phoneValidation.js';

const WA_ENABLED = String(process.env.WA_ACTIVATION_ENABLED || '').trim().toLowerCase() === 'true';
const WA_PLUGIN_ID = (process.env.WA_ACTIVATION_PLUGIN_ID || '').trim();
const WA_PHONE_NUMBER_ID = (process.env.WA_ACTIVATION_PHONE_NUMBER_ID || '').trim();
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com')
  .trim()
  .replace(/\/+$/, '');

const TEMPLATE_NAME = 'kdy_aktivasyon_kodu';
const TEMPLATE_LANG = 'tr';

export interface SendActivationWhatsappInput {
  toPhone: string;
  ownerName: string;
  salonName: string;
  code: string;
  expiresAt: Date;
}

export interface SendActivationWhatsappResult {
  delivered: boolean;
  provider: 'console' | 'whatsapp';
  messageId?: string;
}

/**
 * Sends the activation code via WhatsApp using the kdy_aktivasyon_kodu
 * template. When WA_ACTIVATION_ENABLED is not "true" this is a no-op log-
 * only stub.
 *
 * Template variables (per Meta template approval payload):
 *   {{1}} = ownerName
 *   {{2}} = salonName
 *   {{3}} = code
 */
export async function sendActivationWhatsapp(
  input: SendActivationWhatsappInput,
): Promise<SendActivationWhatsappResult> {
  const to = normalizeDigitsOnly(input.toPhone);
  console.log(
    '[activation-wa] would send to:',
    to,
    'code:',
    input.code,
    'salon:',
    input.salonName,
  );

  if (!WA_ENABLED) {
    return { delivered: false, provider: 'console' };
  }

  if (!CHAKRA_API_TOKEN || !WA_PLUGIN_ID || !WA_PHONE_NUMBER_ID) {
    console.warn(
      '[activation-wa] WA_ACTIVATION_ENABLED=true but Chakra plugin/phone/token env missing; skipping send.',
    );
    return { delivered: false, provider: 'console' };
  }

  // Mirror the send pattern used in whatsappTemplateSender.ts so when the
  // template is approved we can flip the flag without rewriting auth/routes.
  const url = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(WA_PLUGIN_ID)}/api/v19.0/${encodeURIComponent(WA_PHONE_NUMBER_ID)}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: input.ownerName },
            { type: 'text', text: input.salonName },
            { type: 'text', text: input.code },
          ],
        },
      ],
    },
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      const messageId = response.data?.messages?.[0]?.id;
      return { delivered: true, provider: 'whatsapp', messageId };
    }

    console.error('[activation-wa] non-2xx from Chakra', {
      status: response.status,
      body: response.data,
    });
    return { delivered: false, provider: 'whatsapp' };
  } catch (error: any) {
    console.error('[activation-wa] send failed', {
      toPhone: to,
      message: error?.message || String(error),
    });
    return { delivered: false, provider: 'whatsapp' };
  }
}
