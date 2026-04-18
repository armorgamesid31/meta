import axios from 'axios';

async function main() {
  const payload = {
    "entry": [
      {
        "id": "1415103333558991",
        "changes": [
          {
            "field": "smb_message_echoes",
            "value": {
              "contacts": [
                {
                  "wa_id": "905312006807",
                  "user_id": "TR.925599630278581"
                }
              ],
              "metadata": {
                "phone_number_id": "1009188595600173",
                "display_phone_number": "447463037149"
              },
              "message_echoes": [
                {
                  "id": "antigravity_echo_test_" + Date.now(),
                  "to": "905312006807",
                  "from": "447463037149",
                  "text": {
                    "body": "ANTIGRAVITY_ECHO_STILL_WORKS"
                  },
                  "type": "text",
                  "timestamp": Math.floor(Date.now()/1000).toString()
                }
              ],
              "messaging_product": "whatsapp"
            }
          }
        ]
      }
    ],
    "object": "whatsapp_business_account"
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
