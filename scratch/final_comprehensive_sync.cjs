const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';

const KEDY_MASTER_TEMPLATES = [
  {
    name: 'kedy_randevu_onay_v3',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'CONFIRMATION',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{customer_name}}, {{appointment_date}} tarihindeki {{service_name}} randevunuz başarıyla oluşturulmuştur. Görüşmek üzere!',
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Müşteri' },
            { param_name: 'appointment_date', example: '14 Nisan 15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' }
          ]
        }
      }
    ]
  },
  {
    name: 'kedy_randevu_hatirlatma',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'REMINDER',
    components: [
      {
        type: 'BODY',
        text: 'Hatırlatma: Merhaba {{customer_name}}, yarın saat {{appointment_time}}\'de {{service_name}} randevunuz bulunmaktadır. Sizi bekliyoruz.',
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Müşteri' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' }
          ]
        }
      }
    ]
  },
  {
    name: 'kedy_randevu_iptal',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'CANCELLATION',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{customer_name}}, {{appointment_date}} tarihindeki randevunuz iptal edilmiştir. Yeni bir randevu için dilediğiniz zaman bize ulaşabilirsiniz.',
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Müşteri' },
            { param_name: 'appointment_date', example: '14 Nisan 15:30' }
          ]
        }
      }
    ]
  },
  {
    name: 'kedy_waitlist_teklifi',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'SATISFACTION_SURVEY',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{customer_name}}, beklediğiniz {{service_name}} için yer açıldı! Randevu oluşturmak için hemen bize ulaşabilirsiniz.',
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Müşteri' },
            { param_name: 'service_name', example: 'Saç Kesimi' }
          ]
        }
      }
    ]
  },
  {
    name: 'kedy_dogrulama_kodu_fixed',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'SATISFACTION_SURVEY',
    components: [
      {
        type: 'BODY',
        text: 'Kedy doğrulama kodunuz: {{verification_code}}.',
        example: {
          body_text_named_params: [
            { param_name: 'verification_code', example: '123456' }
          ]
        }
      }
    ]
  }
];

async function fetchPluginState(pluginId) {
    const res = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}`, {
        headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });
    return res.data._data || res.data;
}

async function run() {
  const pluginId = '92a83e6b-a479-4486-8404-1be8ec5094a7';
  const salonId = 2; // Palm Beauty verified salonId is 2 based on previous logs and user's log
  
  console.log(`Starting sync for Salon ${salonId}...`);
  const pluginData = await fetchPluginState(pluginId);
  const wabaMap = pluginData.auth?.whatsappBusinessAccountsById;
  const wabaId = Object.keys(wabaMap)[0];
  const templatesUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates`;

  const response = await axios.get(templatesUrl, { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } });
  const externalTemplates = response.data.data || [];

  for (const master of KEDY_MASTER_TEMPLATES) {
    console.log(`Processing: ${master.name}`);
    const match = externalTemplates.find(t => t.name === master.name);
    
    if (!match) {
      console.log(`Sending: ${master.name}`);
      try {
        await axios.post(templatesUrl, {
          name: master.name,
          category: master.category,
          language: 'tr',
          parameter_format: 'NAMED',
          components: master.components
        }, { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } });
        console.log(`SUCCESS: ${master.name}`);
      } catch (err) {
        console.error(`FAILED: ${master.name}`, JSON.stringify(err.response?.data || err.message));
      }
    } else {
      console.log(`Already exists: ${master.name} (Status: ${match.status})`);
    }

    // Try DB update
    try {
      const bodyComponent = master.components.find(c => c.type === 'BODY');
      await prisma.salonMessageTemplate.upsert({
        where: { salonId_eventType_locale: { salonId, eventType: master.eventType, locale: 'tr' } },
        update: {
          templateName: master.name,
          templateContent: bodyComponent.text,
          externalId: match?.id,
          metaCategory: master.category,
          metaStatus: match?.status || 'PENDING_SUBMISSION',
          lastSyncAt: new Date(),
        },
        create: {
          salonId,
          eventType: master.eventType,
          locale: 'tr',
          templateName: master.name,
          templateContent: bodyComponent.text,
          externalId: match?.id,
          metaCategory: master.category,
          metaStatus: match?.status || 'PENDING_SUBMISSION',
          lastSyncAt: new Date(),
        }
      });
      console.log(`DB UPDATED: ${master.name}`);
    } catch (err) {
      console.error(`DB FAILED: ${master.name}`, err.message);
    }
  }
}

run();
