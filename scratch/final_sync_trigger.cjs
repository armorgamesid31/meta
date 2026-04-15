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
    name: 'kedy_dogrulama_kodu',
    category: 'AUTHENTICATION',
    parameter_format: 'NAMED',
    eventType: 'SATISFACTION_SURVEY',
    components: [
      {
        type: 'BODY',
        text: 'Kedy doğrulama kodunuz: {{verification_code}}. Güvenliğiniz için bu kodu kimseyle paylaşmayın.',
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

async function syncAndEnsureMasterTemplates(salonId, pluginId, logs = []) {
  if (!CHAKRA_API_TOKEN) {
    logs.push('HATA: CHAKRA_API_TOKEN tanımlanmamış.');
    return;
  }

  logs.push(`Senkronizasyon başlatıldı. Salon: ${salonId}, Plugin: ${pluginId}`);

  try {
    logs.push('Plugin bilgileri ve WABA ID doğrulanıyor...');
    const pluginData = await fetchPluginState(pluginId);

    if (!pluginData) {
        logs.push('HATA: Plugin bilgileri alınamadı.');
        return;
    }

    const wabaMap = pluginData.auth?.whatsappBusinessAccountsById;
    const wabaId = wabaMap ? Object.keys(wabaMap)[0] : null;

    if (!wabaId) {
        logs.push('HATA: Bu plugin için bağlı bir WhatsApp Business Account (WABA) bulunamadı.');
        return;
    }

    logs.push(`WABA ID bulundu: ${wabaId}. Şablonlar sorgulanıyor...`);

    const templatesUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates`;

    const response = await axios.get(templatesUrl, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });

    const externalTemplates = response?.data?.data || response?.data?._data || [];
    logs.push(`Chakra'da ${externalTemplates.length} adet mevcut şablon bulundu.`);

    for (const master of KEDY_MASTER_TEMPLATES) {
      logs.push(`İşleniyor: ${master.name} (${master.eventType})`);
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
        logs.push(`Veritabanı güncellendi: ${master.name}`);
      } catch (dbErr) {
        logs.push(`HATA: Veritabanı yazma hatası (${master.name}): ${dbErr.message}`);
      }

      if (!match) {
        logs.push(`Eksik şablon tespit edildi, Chakra'ya gönderiliyor: ${master.name}`);
        await axios.post(
          templatesUrl,
          {
            name: master.name,
            category: master.category,
            language: 'tr',
            parameter_format: master.parameter_format || 'NAMED',
            components: master.components,
          },
          { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } }
        ).then(() => {
          logs.push(`Başarıyla gönderildi: ${master.name}`);
        }).catch(err => {
          const detail = err?.response?.data || err.message;
          logs.push(`HATA: Gönderim başarısız (${master.name}): ${JSON.stringify(detail)}`);
        });
      } else {
        logs.push(`Şablon zaten mevcut (Durum: ${match.status || 'Bilinmiyor'})`);
      }
    }
    logs.push('Senkronizasyon başarıyla tamamlandı.');
  } catch (error) {
    const errMsg = error?.response?.data || error.message;
    logs.push(`KRİTİK HATA: Senkronizasyon yarıda kesildi: ${JSON.stringify(errMsg)}`);
  }
}

async function run() {
  const logs = [];
  await syncAndEnsureMasterTemplates(7, '92a83e6b-a479-4486-8404-1be8ec5094a7', logs);
  console.log(logs.join('\n'));
  process.exit(0);
}

run();
