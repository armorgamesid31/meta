const axios = require('axios');
const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';
const pluginId = '92a83e6b-a479-4486-8404-1be8ec5094a7';

async function probe() {
  const variations = [
    `/plugin/${pluginId}/whatsapp-templates`,
    `/plugin/${pluginId}/templates`,
    `/v1/ext/plugin/whatsapp/${pluginId}/whatsapp-templates`,
    `/v1/ext/plugin/whatsapp/${pluginId}/templates`,
    `/v1/ext/plugin/whatsapp/api/v22.0/1415103333558991/message_templates`
  ];
  
  for (const v of variations) {
    try {
      console.log(`Probing: ${v}`);
      const res = await axios.get(`${CHAKRA_API_BASE}${v}`, {
        headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
      });
      console.log(`SUCCESS [${v}]:`, res.status, Array.isArray(res.data?._data) ? res.data._data.length : 'Object');
    } catch (err) {
      console.log(`FAILED [${v}]:`, err.response?.status);
    }
  }
}

probe();
