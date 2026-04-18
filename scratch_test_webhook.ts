import axios from 'axios';

async function main() {
  const payload = {
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "test",
        "changes": [
          {
            "field": "messages",
            "value": {
              "messaging_product": "whatsapp",
              "metadata": {
                "display_phone_number": "447463037149",
                "phone_number_id": "1009188595600173"
              },
              "contacts": [
                {
                  "profile": { "name": "Test" },
                  "wa_id": "905312006807"
                }
              ],
              "messages": [
                {
                  "from": "905312006807",
                  "id": "test_id_antigravity",
                  "text": { "body": "TESTING_ANTIGRAVITY" },
                  "timestamp": "1676499015",
                  "type": "text"
                }
              ]
            }
          }
        ]
      }
    ]
  };

  try {
    const res = await axios.post('https://app.berkai.shop/api/webhooks/whatsapp', payload);
    console.log('Status:', res.status);
    console.log('Data:', res.data);
  } catch (e: any) {
    console.error('Error:', e.response?.status, e.response?.data || e.message);
  }
}

main();
