const axios = require('axios');

async function sendMockEcho() {
  const payload = {
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "antigrav_entry_1",
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
                  "profile": { "name": "Berkay" },
                  "wa_id": "905312006807"
                }
              ],
              "messages": [
                {
                  "from": "447463037149",
                  "id": "antigrav_echo_" + Date.now(),
                  "to": "905312006807",
                  "text": { "body": "ANTIGRAVITY_ECHO_STILL_WORKS_LOCAL" },
                  "timestamp": Math.floor(Date.now() / 1000).toString(),
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
    const res = await axios.post('http://localhost:3000/api/webhooks/WHATSAPP', payload);
    console.log('Success:', res.status, res.data);
  } catch (err) {
    console.error('Error:', err.response?.status, err.response?.data || err.message);
  }
}

sendMockEcho();
