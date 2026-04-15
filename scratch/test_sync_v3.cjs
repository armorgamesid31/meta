const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';

const KEDY_MASTER_TEMPLATES = [
  {
    name: 'kedy_randevu_onay_v2', // Use a new name to avoid conflict
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'CONFIRMATION',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{customer_name}}, {{appointment_date}} tarihindeki {{service_name}} randevunuz başarıyla oluşturulmuştur. Görüşmek üzere!',
        example: {
          body_text_named_params: [
            {
              param_name: 'customer_name',
              example: 'Müşteri'
            },
            {
              param_name: 'appointment_date',
              example: '14 Nisan 15:30'
            },
            {
              param_name: 'service_name',
              example: 'Saç Kesimi'
            }
          ]
        }
      }
    ]
  }
];

async function testSync() {
  const pluginId = '92a83e6b-a479-4486-8404-1be8ec5094a7';
  console.log(`Testing Sync for Plugin: ${pluginId}`);

  try {
    // 1. Fetch Plugin Info to get WABA ID
    console.log('Fetching Plugin Info...');
    const pluginRes = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });
    
    // In Chakra Chat, WABA accounts are in whatsappBusinessAccountsById
    const wabaIds = Object.keys(pluginRes.data._data.serverConfig.whatsappBusinessAccountsById);
    const wabaId = wabaIds[0];
    console.log('WABA ID found:', wabaId);

    if (!wabaId) throw new Error('No WABA ID found for this plugin.');

    const templatesUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates`;

    // 2. Fetch Templates
    console.log('Fetching templates from WABA...');
    const tRes = await axios.get(templatesUrl, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });
    const externalTemplates = tRes.data.data || [];
    console.log(`Found ${externalTemplates.length} templates.`);

    for (const master of KEDY_MASTER_TEMPLATES) {
      const match = externalTemplates.find(t => t.name === master.name);
      if (!match) {
        console.log(`Sending template: ${master.name}`);
        try {
          const postRes = await axios.post(templatesUrl, {
            name: master.name,
            category: master.category,
            language: 'tr',
            parameter_format: master.parameter_format,
            components: master.components
          }, {
            headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }
          });
          console.log('SUCCESS:', postRes.data);
        } catch (err) {
          console.error('POST FAILED:', master.name, JSON.stringify(err.response?.data || err.message, null, 2));
        }
      } else {
        console.log(`Already exists: ${master.name}`);
      }
    }
  } catch (error) {
    console.error('TEST FAILED:', error.response?.data || error.message);
  }
}

testSync().finally(() => prisma.$disconnect());
