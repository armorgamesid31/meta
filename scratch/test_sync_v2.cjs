const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const prisma = new PrismaClient();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN || 'uAavKQAqMN4m7EVKxmgNZuzYFIeLnjAnLa7r0qb6QPAZGJlqXNudmpgYfVP0EQyuPk0ow8vckvRRxHXSTDQYsRUdOnUTCzmTmi2JODVrAvEaTS1cxYrnEGVFhd3jZ9A87jfmEcHZv68hQCQL7dHwue3YQ5kXNMtl96n1QsQFZspJ8Led4YE9tDdyxwXwLXjC2OggkifVJgt7rQs9ALK2LGdqXbkRKN7HemOge8dJpifJboTTVC3eHgajAzdK2Fp';

const KEDY_MASTER_TEMPLATES = [
  {
    name: 'kedy_randevu_onay',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'CONFIRMATION',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{customer_name}}, {{appointment_date}} tarihindeki {{service_name}} randevunuz başarıyla oluşturulmuştur. Görüşmek üzere!',
        example: {
          body_text: [
            {
              customer_name: 'Müşteri',
              appointment_date: '14 Nisan 15:30',
              service_name: 'Saç Kesimi'
            }
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
          body_text: [
            {
              customer_name: 'Müşteri',
              appointment_time: '15:30',
              service_name: 'Saç Kesimi'
            }
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
          body_text: [
            {
              customer_name: 'Müşteri',
              appointment_date: '14 Nisan 15:30'
            }
          ]
        }
      }
    ]
  },
  {
    name: 'kedy_dogrulama_kodu',
    category: 'AUTHENTICATION',
    parameter_format: 'NAMED',
    eventType: 'SATISFACTION_SURVEY',
    components: [
      {
        type: 'BODY',
        text: 'Kedy doğrulama kodunuz: {{verification_code}}. Güvenliğiniz için bu kodu kimseyle paylaşmayın.',
        example: {
          body_text: [
            {
              verification_code: '123456'
            }
          ]
        }
      }
    ]
  }
];

async function syncAndEnsureMasterTemplates(salonId, pluginId) {
  console.log(`Starting sync for Salon: ${salonId}, Plugin: ${pluginId}`);

  try {
    console.log('Fetching external templates...');
    const response = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}/whatsapp-templates`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });

    const externalTemplates = response?.data?._data || response?.data || [];
    console.log(`Found ${externalTemplates.length} templates on Chakra.`);

    for (const master of KEDY_MASTER_TEMPLATES) {
      console.log(`Processing ${master.name}...`);
      const match = externalTemplates.find((ext) => ext.name === master.name);
      
      const bodyComponent = master.components.find(c => c.type === 'BODY');
      
      try {
        await prisma.salonMessageTemplate.upsert({
          where: {
            salonId_eventType_locale: {
              salonId,
              eventType: master.eventType,
              locale: 'tr',
            }
          },
          update: {
            templateName: master.name,
            templateContent: bodyComponent?.text,
            externalId: match?.id,
            metaCategory: match?.category || master.category,
            metaStatus: match?.status || 'PENDING_SUBMISSION',
            lastSyncAt: new Date(),
          },
          create: {
            salonId,
            eventType: master.eventType,
            locale: 'tr',
            templateName: master.name,
            templateContent: bodyComponent?.text,
            externalId: match?.id,
            metaCategory: match?.category || master.category,
            metaStatus: match?.status || 'PENDING_SUBMISSION',
            lastSyncAt: new Date(),
          }
        });
        console.log(`DB updated for ${master.name}`);
      } catch (dbErr) {
        console.error(`DB Error (${master.name}):`, dbErr.message);
      }

      if (!match) {
        console.log(`Missing template, sending to Chakra: ${master.name}`);
        try {
          await axios.post(
            `${CHAKRA_API_BASE}/plugin/${pluginId}/whatsapp-templates`,
            {
              name: master.name,
              category: master.category,
              language: 'tr',
              parameter_format: master.parameter_format || 'NAMED',
              components: master.components,
            },
            { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } }
          );
          console.log(`Successfully sent: ${master.name}`);
        } catch (err) {
          const detail = err?.response?.data || err.message;
          console.error(`Submission failed for ${master.name}:`, JSON.stringify(detail, null, 2));
        }
      } else {
        console.log(`Template already exists: ${master.name} (Status: ${match.status})`);
      }
    }
    console.log('Sync complete.');
  } catch (error) {
    const errMsg = error?.response?.data || error.message;
    console.error(`Critical Sync Error:`, JSON.stringify(errMsg, null, 2));
  }
}

syncAndEnsureMasterTemplates(2, '92a83e6b-a479-4486-8404-1be8ec5094a7')
  .finally(() => prisma.$disconnect());
