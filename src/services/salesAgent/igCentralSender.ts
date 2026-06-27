// Kedy merkez Instagram hesabından serbest metin gönderir.
// Gerekli env: KEDY_CENTRAL_IG_ACCESS_TOKEN, KEDY_CENTRAL_IG_SENDER_ID
// 24 saatlik Meta mesajlaşma penceresi kuralı geçerli (gelen mesaja yanıt).

import axios from 'axios';

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v19.0').trim();
const IG_ACCESS_TOKEN = (process.env.KEDY_CENTRAL_IG_ACCESS_TOKEN || '').trim();
const IG_SENDER_ID = (process.env.KEDY_CENTRAL_IG_SENDER_ID || '').trim();

export function isKedyIgConfigured(): boolean {
  return Boolean(IG_ACCESS_TOKEN && IG_SENDER_ID);
}

export async function sendCentralIgText(input: {
  recipientId: string;
  text: string;
}): Promise<void> {
  if (!isKedyIgConfigured()) {
    console.warn('[igCentralSender] KEDY_CENTRAL_IG_ACCESS_TOKEN veya KEDY_CENTRAL_IG_SENDER_ID eksik');
    return;
  }
  const url = `https://graph.instagram.com/${META_GRAPH_VERSION}/${IG_SENDER_ID}/messages`;
  try {
    await axios.post(
      url,
      {
        recipient: { id: input.recipientId },
        message: { text: input.text },
        messaging_type: 'RESPONSE',
      },
      {
        headers: {
          Authorization: `Bearer ${IG_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
      },
    );
  } catch (err: any) {
    console.error('[igCentralSender] send failed', {
      recipientId: input.recipientId,
      reason: err?.response?.data?.error?.message || err?.message,
    });
  }
}
