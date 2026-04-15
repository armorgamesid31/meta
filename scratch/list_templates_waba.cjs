const axios = require('axios');
const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';
const wabaId = '1415103333558991';

async function listTemplates() {
  try {
    const res = await axios.get(`${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });
    console.log('TEMPLATES_DATA:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('ERROR:', err.response?.status, err.response?.data || err.message);
  }
}

listTemplates();
