
function toIsoFromTs(ts: any): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function parseMetaMessageType(channel: string, msg: any, media: any[]): string {
    if (msg?.text) return 'text';
    if (media.length > 0) return media[0].type;
    return 'unknown';
}

function normalizeWebhookPayload(body: any) {
  const out: any[] = [];
  const root = body ?? {};

  if (root.object === 'whatsapp_business_account') {
    for (const entry of root.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change?.value ?? {};
        const contacts = value?.contacts ?? [];
        const contactByWaId = Object.fromEntries(contacts.map((c: any) => [c?.wa_id, c]));

        for (const msg of value?.messages ?? []) {
          const from = msg?.from ?? null;
          const contact = from ? contactByWaId[from] : null;
          const media: any[] = [];

          if (msg?.image) media.push({ type: 'image', id: msg.image.id ?? null, url: msg.image.url ?? null, caption: msg.image.caption ?? null });
          if (msg?.audio) media.push({ type: 'audio', id: msg.audio.id ?? null, url: msg.audio.url ?? null, voice: !!msg.audio.voice });

          const messageType = parseMetaMessageType('WHATSAPP', msg, media);
          
          const businessWaId = value?.metadata?.display_phone_number;
          const isEcho = Boolean(msg?.type && from && businessWaId && from === businessWaId);

          const channelUserId = isEcho ? (msg?.to || null) : (contact?.wa_id || from || null);
          
          const mediaUrls = media.map((m) => m?.url).filter(Boolean);
          const primaryMedia = media[0] || null;

          out.push({
            channel: 'WHATSAPP',
            providerMessageId: msg?.id ?? `wa_${Date.now()}`,
            messageType,
            text: msg?.text?.body || null,
            timestamp: Number(msg?.timestamp || Date.now()),
            eventTimestamp: toIsoFromTs(msg?.timestamp),
            senderId: from || null,
            recipientId: value?.metadata?.phone_number_id || (isEcho ? null : from) || null,
            externalAccountId: value?.metadata?.phone_number_id || null,
            externalBusinessId: entry?.id || null,
            channelUserId,
            channelConversationKey: `WHATSAPP:${channelUserId || 'unknown'}`,
            rawProfileName: contact?.profile?.name || null,
            isEcho,
            raw: root,
          });
        }
      }
    }
  }
  return out;
}

const payload = {
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "383236724881827",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "447463037149",
              "phone_number_id": "1009188595600173"
            },
            "contacts": [
              {
                "profile": { "name": "B" },
                "wa_id": "905312006807"
              }
            ],
            "messages": [
              {
                "from": "905312006807",
                "id": "wamid.HBgMOTA1MzEyMDA2ODA3FQIAERgSRjQ2NTg0QzY5RTJFMTZCNTA2AA==",
                "timestamp": "1776442165",
                "text": { "body": "selam keke" },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
};

const result = normalizeWebhookPayload(payload);
console.log('Normalized Result:', JSON.stringify(result, null, 2));
