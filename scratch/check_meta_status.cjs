const axios = require('axios');
const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';

async function verify() {
  const pluginId = '92a83e6b-a479-4486-8404-1be8ec5094a7';
  
  const resPlugin = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
  });
  const pluginData = resPlugin.data;
  const wabaId = Object.keys(pluginData.auth.whatsappBusinessAccountsById)[0];
  const templatesUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates`;

  const resTemplates = await axios.get(templatesUrl, { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } });
  const templates = resTemplates.data.data;

  console.log(`Chakra reports ${templates.length} templates for WABA ${wabaId}:`);
  templates.forEach(t => {
    console.log(`- NAME: ${t.name} | STATUS: ${t.status} | CATEGORY: ${t.category}`);
    if (t.status === 'REJECTED') {
        console.log(`  REJECTION REASON: ${JSON.stringify(t.rejection_reasons || 'Unknown')}`);
    }
  });
  process.exit(0);
}

verify();
