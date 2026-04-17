import { normalizeWebhookPayload } from './src/routes/channelWebhooks.js';

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
                "profile": {
                  "name": "B"
                },
                "wa_id": "905312006807"
              }
            ],
            "messages": [
              {
                "from": "905312006807",
                "id": "wamid.HBgMOTA1MzEyMDA2ODA3FQIAERgSRjQ2NTg0QzY5RTJFMTZCNTA2AA==",
                "timestamp": "1776442165",
                "text": {
                  "body": "selam keke"
                },
                "type": "text",
                "from_user_id": "TR.925599630278581"
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
