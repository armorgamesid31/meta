const axios = require('axios');
const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';
const pluginId = '92a83e6b-a479-4486-8404-1be8ec5094a7';

async function checkPlugin() {
  console.log(`Checking Plugin: ${pluginId}`);
  try {
    const res = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });
    console.log('PLUGIN_INFO:', JSON.stringify(res.data, null, 2));
    
    console.log('Checking Templates...');
    const tRes = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}/whatsapp-templates`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });
    console.log('TEMPLATES:', JSON.stringify(tRes.data, null, 2));
  } catch (err) {
    console.error('ERROR:', err.response?.status, err.response?.data || err.message);
  }
}

checkPlugin();
