import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.js';
import { writeAccessAudit } from '../services/accessControl.js';
import { BusinessError } from '../lib/errors.js';
import {
  hasTieredVariations,
  pickVariation,
  pickNextInTier,
} from '../services/templateVariations.js';
import { enqueueSalonTemplates, cancelPendingSubmissions } from '../services/salonTemplateSubmitter.js';

const router = Router();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

const CHAKRA_SDK_URL = 'https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js';
const DEFAULT_CHAKRA_PASSTHROUGH_WEBHOOK_URL = 'https://app.berkai.shop/api/webhooks/whatsapp';
const CHAKRA_PASSTHROUGH_WEBHOOK_URL = (
  process.env.CHAKRA_PASSTHROUGH_WEBHOOK_URL ||
  process.env.CHAKRA_WEBHOOK_URL ||
  process.env.N8N_CHAKRA_WEBHOOK_URL ||
  DEFAULT_CHAKRA_PASSTHROUGH_WEBHOOK_URL
).trim();

// WhatsApp Master Templates Definitions
// WhatsApp Master Template Variations
const MASTER_TEMPLATE_VARIATIONS: Record<string, string[]> = {
  kedy_randevu_onay: [
    "Merhaba! {{customer_name}}, {{appointment_date}} tarihindeki {{service_name}} randevunuz onaylanmıştır. Konumumuz: {{location_url}} ✨",
    "Harika haber! {{customer_name}}, {{appointment_date}} vaktindeki {{service_name}} randevunuz başarıyla oluşturuldu. Adresimiz: {{location_url}} 🗓️",
    "{{customer_name}} randevunuz hazır! {{appointment_date}} tarihinde {{service_name}} için sizi bekliyoruz. Detaylar: {{location_url}} 💖",
    "Selam! {{appointment_date}} tarihinde {{service_name}} hizmeti için {{customer_name}} randevunuz konfirme edildi. Yol tarifi: {{location_url}} 🌸",
    "Randevu Onayı: {{appointment_date}} tarihinde {{service_name}} için yeriniz ayrıldı. Teşekkürler {{customer_name}}! {{location_url}} 🙏",
    "Merhaba, {{appointment_date}} tarihinde {{service_name}} randevunuzu heyecanla bekliyoruz {{customer_name}}. Konum: {{location_url}} 🌟",
    "{{appointment_date}} tarihindeki {{service_name}} randevunuzun onaylandığını bildirmekten mutluluk duyarız. ✅ Harita: {{location_url}}",
    "Randevunuz Onaylandı! {{appointment_date}} | {{service_name}} | {{customer_name}}. Sabırsızlıkla bekliyoruz! 😊 {{location_url}}",
    "{{appointment_date}} vaktinde {{service_name}} için hazırız. Sizi de bekliyoruz {{customer_name}}! 🌺 Adres: {{location_url}}",
    "Selamlar, {{appointment_date}} tarihli {{service_name}} randevunuz sisteme kaydedildi {{customer_name}}. İşte konumumuz: {{location_url}} 👋"
  ],
  // Tier-aware: variations live in templateVariations.ts.
  // Flat fallback for legacy callers below. All 3 reminder timings live
  // in separate templates (1g / 3g / 2s) — see templateVariations.ts.
  kedy_randevu_hatirlatma_1_gun: [
    "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} randevunuz için kısa bir teyit alabilir miyiz? 🙌"
  ],
  kedy_randevu_hatirlatma_3_gun: [
    "Merhaba {{customer_name}} {{customer_honorific}}, randevu tarihinize 3 gün kalmıştır 🙌 İptal veya değişiklik taleplerinizi en az {{late_policy_hours}} saat önce iletmenizi rica ederiz."
  ],
  kedy_randevu_hatirlatma_2_saat: [
    "Merhaba {{customer_name}} {{customer_honorific}}, randevunuza yaklaşık 2 saat kaldı 🫶 Yol tarifi butondan açılabilir."
  ],
  kedy_google_maps_yorum: [
    "Merhaba {{customer_name}} {{customer_honorific}}, {{salon_name}} olarak sizi üçüncü kez ağırlamaktan mutluyuz 🌸 Google Maps yorumunuz bizim için kıymetli."
  ],
  kedy_islem_link: [
    "Bekleyen işleminizi tamamlamak için aşağıdaki butona dokunun.\n\nBağlantı kısa süreliğine geçerlidir."
  ],
  kedy_ekip_katilim_link: [
    "Kedy ekip katılımınızı tamamlamak için aşağıdaki butona dokunun.\n\nBağlantı kısa süreliğine geçerlidir.\n\n— Kedy"
  ],
  // Tier-aware: variations live in templateVariations.ts.
  // Flat fallback for legacy callers.
  kedy_no_show_hatirlatma: [
    "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuza gelemediğinizi fark ettik. İsterseniz yeni bir tarih ayarlayalım. Plan değişikliği için en az {{late_policy_hours}} saat öncesinden bildirim rica ederiz."
  ],
  kedy_dogum_gunu_kutlamasi: [
    "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, size özel {{discount_amount}} indirim hediyemizi sunarız 🎉 ({{validity_period}} geçerli)"
  ],
  kedy_geri_donus: [
    "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşmedik 🌸 Size özel {{discount_amount}} indirim hediyemizi sunarız ({{validity_period}})."
  ],
  kedy_waitlist_teklif: [
    "Güzel haber {{customer_name}}! Bekleme listenizde olduğunuz {{service_name}} için {{appointment_date}} vaktinde bir boşluk oluştu! ✨",
    "Merhaba! {{appointment_date}} saatindeki {{service_name}} hizmeti artık müsait. Sizinle doldurabiliriz! ⏰",
    "Beklediğiniz an geldi {{customer_name}}! {{appointment_date}} tarihinde {{service_name}} için yerimiz var. 🌟",
    "Hey! {{appointment_date}} tarihinde boş bir koltuğumuz var. {{service_name}} için gelmek ister misiniz? 🌸",
    "Şanslı gününüz! {{service_name}} listesinde {{appointment_date}} tarihinde yer açıldı. Hemen onaylayın! ✅",
    "Selam {{customer_name}}! {{appointment_date}} vaktindeki {{service_name}} randevusu şu an boşta. Kaçırmayın! 🌸",
    "Bilginize: {{appointment_date}} tarihinde bir iptal oldu. {{service_name}} için sizi yazalım mı? 🗓️",
    "Harika Fırsat! {{appointment_date}} saatindeki {{service_name}} randevusu için en ön sıradasınız. 😊",
    "Merhaba {{customer_name}}, bekleme listesinden size haber veriyoruz: {{appointment_date}} | {{service_name}} müsait! 🌺",
    "Selamlar, {{appointment_date}} tarihli seansımızda bir kişilik boşluk var. Bekliyoruz! 👋"
  ],
  kedy_memnuniyet_anketi: [
    "Merhaba {{customer_name}}! Aldığınız {{service_name}} hizmetinden memnun kaldınız mı? Değerlendirmeniz bizim için çok önemli. ✨",
    "Bizi oylayın! {{service_name}} deneyiminizi merak ediyoruz. Görüşlerinizi bizimle paylaşır mısınız {{customer_name}}? 🌟",
    "Selam {{customer_name}}! Bugün aldığınız {{service_name}} hizmetimize dair yorumlarınızı bekliyoruz. 🌸",
    "Memnuniyetiniz bizim önceliğimiz. Bugün aldığınız {{service_name}} hizmetini nasıl buldunuz? 🥰",
    "Merhaba, {{service_name}} randevunuzdan mutlu ayrıldığınızı umuyoruz. Bizi puanlayın! ⭐",
    "Görüşleriniz değerli {{customer_name}}! Aldığınız {{service_name}} hizmetini geliştirmemiz için bize yardımcı olun. 🙏",
    "Hey! Bugün aldığınız {{service_name}} hizmeti hakkında neler düşünüyorsunuz? Hemen paylaşın! 🌺",
    "Deneyiminizi Paylaşın! {{service_name}} randevunuz nasıldı? Yorumlarınızı sabırsızlıkla bekliyoruz. 😊",
    "Merhaba {{customer_name}}, {{service_name}} ile gününüzün güzelleştiğini umuyoruz. Bir yorum bırakmak ister misiniz? 🌸",
    "Selamlar, {{service_name}} randevunuzu değerlendirmek için vakit ayırdığınız için teşekkürler! 👋"
  ],
  kedy_dogrulama_link: [
    "Merhaba {{name}}, {{salon_or_action}} işleminizi tamamlamak için linke dokunun: {{verification_link}} — Link {{ttl}} dakika geçerlidir. — {{footer_brand}}",
    "Selam {{name}}! {{salon_or_action}} için kısa onay linkin hazır: {{verification_link}} (Link {{ttl}} dk geçerli) — {{footer_brand}}",
    "Merhaba {{name}}, {{salon_or_action}} işlemini bu güvenli bağlantıyla onaylayabilirsin: {{verification_link}}. Süre: {{ttl}} dk. — {{footer_brand}}",
    "{{name}}, {{salon_or_action}} işlemini tamamlamak için linke dokun: {{verification_link}}. {{ttl}} dakika içinde kullanmalısın. — {{footer_brand}}",
    "Hey {{name}}, {{salon_or_action}} işlemini buradan onayla: {{verification_link}} — {{ttl}} dk geçerlidir. — {{footer_brand}}",
    "Merhaba {{name}}, {{salon_or_action}} için aşağıdaki linke tıklamanız yeterli: {{verification_link}}. Linkin geçerlilik süresi {{ttl}} dakikadır. — {{footer_brand}}",
    "Selamlar {{name}}, {{salon_or_action}} işlemine devam etmek için: {{verification_link}}. {{ttl}} dakika içinde kullanın. — {{footer_brand}}",
    "{{name}}, {{salon_or_action}} işlemini tek dokunuşla tamamlayın: {{verification_link}}. {{ttl}} dk içinde geçerlidir. — {{footer_brand}}",
    "Merhaba {{name}}, {{salon_or_action}} adımını tamamlamak için bağlantıyı açın: {{verification_link}}. Süre: {{ttl}} dakika. — {{footer_brand}}",
    "Hoş geldiniz {{name}}, {{salon_or_action}} işleminize devam etmek için: {{verification_link}} — {{ttl}} dakika içinde kullanın. — {{footer_brand}}"
  ],
  // NOTE: kedy_auth_code (legacy AUTHENTICATION template) removed. UTILITY-link
  // flow (kedy_islem_link / kedy_ekip_katilim_link) replaces it.
};

// WhatsApp Master Templates Definitions
const KEDY_MASTER_TEMPLATES = [
  // ── Appointment confirmation ──
  // Variables in body (union of tiers): customer_name, customer_surname,
  // customer_honorific, appointment_date, appointment_time, service_name,
  // location_url. Meta requires example for each {{var}} actually in the
  // submitted body — sync logic builds examples dynamically per pick.
  {
    name: 'kedy_randevu_onay',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'CONFIRMATION',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_randevu_onay[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'appointment_date', example: '14 Nisan' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' },
            { param_name: 'location_url', example: 'https://maps.google.com/?q=Salon' }
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Onaylıyorum ✅', payload: 'CONFIRM_APPOINTMENT' },
          { type: 'QUICK_REPLY', text: 'İptal Et ❌', payload: 'CANCEL_APPOINTMENT' }
        ]
      }
    ]
  },
  // ── Reminder: 1 day before ──
  {
    name: 'kedy_randevu_hatirlatma_1_gun',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'REMINDER_1_DAY',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_randevu_hatirlatma_1_gun[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'appointment_date', example: '14 Nisan' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' }
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Geliyorum 👍', payload: 'REMINDER_CONFIRM' },
          { type: 'QUICK_REPLY', text: 'Gelemiyorum 👎', payload: 'REMINDER_CANCEL' }
        ]
      }
    ]
  },
  // ── Reminder: 3 days before (includes salon cancellation policy hours) ──
  {
    name: 'kedy_randevu_hatirlatma_3_gun',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'REMINDER_3_DAY',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_randevu_hatirlatma_3_gun[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'appointment_date', example: '14 Nisan' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' },
            { param_name: 'late_policy_hours', example: '24' }
          ]
        }
      }
    ]
  },
  // ── Reminder: 2 hours before (includes location button) ──
  {
    name: 'kedy_randevu_hatirlatma_2_saat',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'REMINDER_2_HOUR',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_randevu_hatirlatma_2_saat[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' },
            { param_name: 'location_url', example: 'https://maps.google.com/?q=Salon' }
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Yol Tarifi', url: 'https://maps.google.com/?q=Salon' }
        ]
      }
    ]
  },
  {
    name: 'kedy_no_show_hatirlatma',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'NO_SHOW',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_no_show_hatirlatma[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'appointment_date', example: '14 Nisan' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' },
            { param_name: 'late_policy_hours', example: '24' }
          ]
        }
      }
    ]
  },
  // ── Legacy verification link template (deprecated for customer flows;
  //    superseded by kedy_islem_link). Kept for backwards compat.
  {
    name: 'kedy_dogrulama_link',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'VERIFICATION_LINK',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_dogrulama_link[0],
        example: {
          body_text_named_params: [
            { param_name: 'name', example: 'Müşteri' },
            { param_name: 'salon_or_action', example: 'Bella Studio salonu randevu' },
            { param_name: 'verification_link', example: 'https://app.berkai.shop/c/v/abc123' },
            { param_name: 'ttl', example: '15' },
            { param_name: 'footer_brand', example: 'Kedy' }
          ]
        }
      }
    ]
  },
  // ── Customer transactional verify (CUSTOMER_PHONE / CUSTOMER_LINK_CONSENT
  //    / PHONE_CHANGE). Body is static; only URL button carries the token. ──
  {
    name: 'kedy_islem_link',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'CUSTOMER_VERIFY_LINK',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: '{{salonname}}',
        example: { header_text_named_params: [{ param_name: 'salonname', example: 'Bella Studio' }] }
      },
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_islem_link[0]
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Devam Et', url: 'https://app.berkai.shop/c/v/{{1}}', example: ['Hx7kT3pQmRn2Xs8VyZbCfWdL'] }
        ]
      }
    ]
  },
  // ── Team-invite verification link (TEAM_INVITE_PHONE) ──
  {
    name: 'kedy_ekip_katilim_link',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'TEAM_INVITE_LINK',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_ekip_katilim_link[0]
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Katılımı Tamamla', url: 'https://kedyapp.com/v/{{1}}', example: ['Tx9pRmK3pRmQnBs4'] }
        ]
      }
    ]
  },
  {
    name: 'kedy_waitlist_teklif',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'WAITLIST_OFFER',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_waitlist_teklif[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'appointment_date', example: '14 Nisan' },
            { param_name: 'appointment_time', example: '15:30' },
            { param_name: 'service_name', example: 'Saç Kesimi' }
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Teklifi Gör', url: 'https://app.berkai.shop/booking?waitlistOffer={{1}}', example: ['offer_token'] }
        ]
      }
    ]
  },
  // ── Standard post-appointment feedback (magic link → /feedback/{token}) ──
  {
    name: 'kedy_memnuniyet_anketi',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'SATISFACTION_SURVEY',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_memnuniyet_anketi[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'service_name', example: 'Saç Kesimi' }
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Değerlendir', url: 'https://app.berkai.shop/feedback/{{1}}', example: ['feedback_token'] }
        ]
      }
    ]
  },
  // ── 3rd-appointment Google Maps review request ──
  {
    name: 'kedy_google_maps_yorum',
    category: 'UTILITY',
    parameter_format: 'NAMED',
    eventType: 'GOOGLE_MAPS_REVIEW',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_google_maps_yorum[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'salon_name', example: 'Bella Studio' }
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: "Google'da Yorum Yap", url: 'https://maps.google.com/?q=Salon', example: ['https://maps.google.com/?q=Salon'] }
        ]
      }
    ]
  },
  {
    // MARKETING category (NOT UTILITY) — contains discount/offer language.
    // Requires Customer.acceptMarketing = true at send-time.
    name: 'kedy_dogum_gunu_kutlamasi',
    category: 'MARKETING',
    parameter_format: 'NAMED',
    eventType: 'BIRTHDAY',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_dogum_gunu_kutlamasi[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'discount_amount', example: '%15' },
            { param_name: 'validity_period', example: '7 gün' }
          ]
        }
      }
    ]
  },
  {
    // MARKETING category — contains discount/offer language.
    // Requires Customer.acceptMarketing = true at send-time.
    name: 'kedy_geri_donus',
    category: 'MARKETING',
    parameter_format: 'NAMED',
    eventType: 'WINBACK',
    components: [
      {
        type: 'BODY',
        text: MASTER_TEMPLATE_VARIATIONS.kedy_geri_donus[0],
        example: {
          body_text_named_params: [
            { param_name: 'customer_name', example: 'Ayşe' },
            { param_name: 'customer_surname', example: 'Yılmaz' },
            { param_name: 'customer_honorific', example: 'Hanım' },
            { param_name: 'discount_amount', example: '%10' },
            { param_name: 'validity_period', example: '30 gün' }
          ]
        }
      }
    ]
  }
];


type ConnectIntent = 'CONNECT' | 'REPLACE_CONNECTION';

function parseConnectIntent(value: unknown): ConnectIntent {
  return typeof value === 'string' && value.trim().toUpperCase() === 'REPLACE_CONNECTION'
    ? 'REPLACE_CONNECTION'
    : 'CONNECT';
}

function isPluginNotFoundError(error: any): boolean {
  const errors = error?.response?.data?._errors;
  if (Array.isArray(errors) && errors.some((item) => typeof item === 'string' && /plugin/i.test(item) && /not found/i.test(item))) {
    return true;
  }

  const message =
    (typeof error?.response?.data?.message === 'string' ? error.response.data.message : '') ||
    (typeof error?.message === 'string' ? error.message : '');

  return /plugin/i.test(message) && /not found/i.test(message);
}

function getSalonIdFromUser(req: any): number | null {
  return req?.user?.salonId && Number.isInteger(req.user.salonId) ? req.user.salonId : null;
}

function sanitizePluginName(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
  return normalized.slice(0, 48) || 'kedyapp-salon';
}

function isConnectSuccessEvent(event: unknown, data: unknown): boolean {
  const eventText = typeof event === 'string' ? event.toLowerCase() : '';
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, any>) : null;
  const dataStatus = typeof dataObj?.status === 'string' ? dataObj.status.toLowerCase() : '';
  const dataState = typeof dataObj?.state === 'string' ? dataObj.state.toLowerCase() : '';
  const hasAuth = Boolean(dataObj?.auth && typeof dataObj.auth === 'object');
  const hasEnabledNumbers =
    Array.isArray(dataObj?.serverConfig?.enabledWhatsappPhoneNumbers) &&
    dataObj.serverConfig.enabledWhatsappPhoneNumbers.some(
      (value: unknown) => typeof value === 'string' && value.trim().length > 0,
    );

  const successPattern = /(connected|linked|success|complete|completed)/i;
  return (
    successPattern.test(eventText) ||
    successPattern.test(dataStatus) ||
    successPattern.test(dataState) ||
    hasAuth ||
    hasEnabledNumbers
  );
}

async function getAuthenticatedSalon(req: any) {
  const salonId = getSalonIdFromUser(req);
  if (!salonId) {
    return null;
  }

  return prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      name: true,
      slug: true,
      chakraPluginId: true,
      chakraPhoneNumberId: true,
      whatsappPhone: true,
      aiAgentSettings: {
        select: {
          faqAnswers: true,
        },
      },
    },
  });
}

async function createPluginForSalon(salon: { id: number; name: string; slug: string | null }) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const pluginNameSeed = salon.slug || salon.name || `salon-${salon.id}`;
  const pluginResponse = await axios.post(
    `${CHAKRA_API_BASE}/plugin`,
    {
      type: 'whatsapp',
      name: sanitizePluginName(pluginNameSeed),
    },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const pluginId = pluginResponse?.data?._data?.id;
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error('No pluginId returned from Chakra.');
  }

  await prisma.salon.update({
    where: { id: salon.id },
    data: { chakraPluginId: pluginId, chakraPhoneNumberId: null },
  });

  await ensurePluginWebhookConfigured(pluginId);

  return pluginId;
}

async function createConnectToken(pluginId: string) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const tokenResponse = await axios.post(
    `${CHAKRA_API_BASE}/v1/ext/whatsapp-partner/create-connect-token`,
    { pluginId },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const connectToken = tokenResponse?.data?._data?.connectToken;
  if (!!connectToken && typeof connectToken === 'string') {
    return connectToken;
  }

  throw new Error('No connectToken returned from Chakra.');
}

async function syncAndEnsureMasterTemplates(salonId: number, pluginId: string, logs: string[] = []) {
  if (!CHAKRA_API_TOKEN) {
    logs.push('HATA: CHAKRA_API_TOKEN tanımlanmamış.');
    return;
  }

  logs.push(`Senkronizasyon başlatıldı. Salon: ${salonId}, Plugin: ${pluginId}`);

  // Resolve the salon's communicationTone for tier-aware variation picking.
  const salonRow = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { communicationTone: true },
  });
  const tone = salonRow?.communicationTone || 'BALANCED';
  logs.push(`Salon iletişim tonu: ${tone}`);

  try {
    // 1. Fetch Plugin info to get WABA ID
    logs.push('Plugin bilgileri ve WABA ID doğrulanıyor...');
    const pluginData = await fetchPluginState(pluginId).catch(async () => {
        // Fallback or retry logic if needed
        return null;
    });

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
      // Tone-varied sohbet templates are now handled by the queue-based
      // submitter (salonTemplateSubmitter.ts) — skip them here. Only the
      // verification/link templates (kedy_islem_link etc.) still flow
      // through this legacy path.
      if (hasTieredVariations(master.name)) {
        logs.push(`Atlanıyor (queue worker tarafından yönetiliyor): ${master.name}`);
        continue;
      }

      logs.push(`İşleniyor: ${master.name} (${master.eventType})`);
      const match = externalTemplates.find((ext: any) => ext.name === master.name);

      let shouldSubmit = !match;
      const useTiered = hasTieredVariations(master.name);
      let variationToSubmit = useTiered
        ? (pickVariation(master.name, tone) ?? MASTER_TEMPLATE_VARIATIONS[master.name]?.[0] ?? '')
        : MASTER_TEMPLATE_VARIATIONS[master.name]?.[0] ?? '';

      if (useTiered) {
        logs.push(`Varyasyon kaynağı: ${tone} tier (rastgele seçim).`);
      }

      if (match) {
        logs.push(`Şablon mevcut: ${master.name} (Durum: ${match.status}, Kategori: ${match.category})`);

        const isRejected = ['REJECTED', 'DISABLED', 'PAUSED'].includes(match.status);
        const isWrongCategory = master.category === 'UTILITY' && match.category === 'MARKETING';

        if (isRejected || isWrongCategory) {
          logs.push(`DİKKAT: ${master.name} ${isRejected ? 'REDDEDİLMİŞ' : 'PAZARLAMAYA DÖNÜŞMÜŞ'}. Yeni varyasyon deneniyor...`);

          const currentBody = match.components?.find((c: any) => c.type === 'BODY')?.text;

          if (useTiered) {
            // Rotate within the salon's tier — preserves tone consistency.
            const next = pickNextInTier(master.name, tone, currentBody || '');
            if (next) {
              variationToSubmit = next;
              shouldSubmit = true;
              logs.push(`Tier içi rotasyon: ${tone} kategorisinden bir sonraki varyasyon.`);
            }
          } else {
            const variations = MASTER_TEMPLATE_VARIATIONS[master.name] || [];
            const currentIndex = variations.indexOf(currentBody);
            const nextIndex = (currentIndex + 1) % variations.length;
            variationToSubmit = variations[nextIndex];
            shouldSubmit = true;
            logs.push(`Eski şablonun üzerine yazılacak: Varyasyon #${nextIndex + 1}`);
          }
        }
      }

      const bodyComponent = master.components.find(c => c.type === 'BODY');
      const finalBodyText = shouldSubmit ? variationToSubmit : (match?.components?.find((c: any) => c.type === 'BODY')?.text || bodyComponent?.text);

      // Map Meta status → our internal submissionState so the friendly
      // status endpoint can aggregate link templates alongside tone-varied ones.
      const metaSt = (match?.status || 'PENDING_SUBMISSION') as string;
      const internalState =
        metaSt === 'APPROVED'                   ? 'ACTIVE_VALID'
        : metaSt === 'REJECTED'                 ? 'REJECTED'
        : metaSt === 'PENDING' || metaSt === 'IN_APPEAL' ? 'SUBMITTED'
        : 'NOT_QUEUED';

      try {
        await prisma.salonMessageTemplate.upsert({
          where: {
            salonId_templateName: {
              salonId,
              templateName: master.name,
            }
          },
          update: {
            templateContent: finalBodyText,
            externalId: match?.id,
            metaCategory: match?.category || master.category,
            metaStatus: metaSt,
            lastSyncAt: new Date(),
            templateKey: master.name, // logical key = templateName for link templates
            expectedCategory: master.category,
            actualCategory: match?.category || master.category,
            submissionState: internalState as any,
            approvedAt: metaSt === 'APPROVED' ? new Date() : undefined,
          },
          create: {
            salonId,
            eventType: master.eventType as any,
            locale: 'tr',
            templateName: master.name,
            templateContent: finalBodyText,
            externalId: match?.id,
            metaCategory: match?.category || master.category,
            metaStatus: metaSt,
            lastSyncAt: new Date(),
            templateKey: master.name,
            expectedCategory: master.category,
            actualCategory: match?.category || master.category,
            submissionState: internalState as any,
            approvedAt: metaSt === 'APPROVED' ? new Date() : null,
          }
        });
        logs.push(`Veritabanı güncellendi: ${master.name}`);
      } catch (dbErr: any) {
        logs.push(`HATA: Veritabanı yazma hatası (${master.name}): ${dbErr.message}`);
      }

      if (shouldSubmit) {
        logs.push(`Chakra'ya gönderiliyor: ${master.name}`);
        
        // Prepare components with new variation
        const components = JSON.parse(JSON.stringify(master.components));
        const bodyIdx = components.findIndex((c: any) => c.type === 'BODY');
        if (bodyIdx !== -1) {
          components[bodyIdx].text = variationToSubmit;
        }

        await axios.post(
          templatesUrl,
          {
            name: master.name,
            category: master.category,
            language: 'tr',
            parameter_format: (master as any).parameter_format || 'NAMED',
            components: components,
          },
          { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } }
        ).then(() => {
          logs.push(`Başarıyla gönderildi: ${master.name}`);
        }).catch(err => {
          const detail = err?.response?.data || err.message;
          logs.push(`HATA: Gönderim başarısız (${master.name}): ${JSON.stringify(detail)}`);
          console.error(`Submission failed for ${master.name}:`, detail);
        });
      }
    }
    logs.push('Senkronizasyon başarıyla tamamlandı.');
  } catch (error: any) {
    const errMsg = error?.response?.data || error.message;
    logs.push(`KRİTİK HATA: Senkronizasyon yarıda kesildi: ${JSON.stringify(errMsg)}`);
    console.error('syncAndEnsureMasterTemplates failed:', error);
  }
}

async function fetchPluginState(pluginId: string) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const response = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}`, {
    headers: {
      Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });

  const pluginData = response?.data?._data;
  if (!pluginData || typeof pluginData !== 'object') {
    throw new Error('Invalid plugin state response from Chakra.');
  }

  return pluginData as Record<string, any>;
}

function normalizeEnabledWhatsappPhoneNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function updatePluginServerConfig(pluginId: string, serverConfig: Record<string, any>) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const response = await axios.put(
    `${CHAKRA_API_BASE}/plugin/${pluginId}`,
    {
      pluginId,
      serverConfig,
    },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const pluginData = response?.data?._data;
  if (!pluginData || typeof pluginData !== 'object') {
    throw new Error('Invalid plugin serverConfig response from Chakra.');
  }

  return pluginData as Record<string, any>;
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

async function ensurePluginWebhookConfigured(pluginId: string, preferredPhoneNumberId?: string | null) {
  const webhookUrl = CHAKRA_PASSTHROUGH_WEBHOOK_URL;
  if (!webhookUrl) {
    return fetchPluginState(pluginId);
  }

  const currentPlugin = await fetchPluginState(pluginId);
  const currentServerConfig =
    currentPlugin?.serverConfig && typeof currentPlugin.serverConfig === 'object' && !Array.isArray(currentPlugin.serverConfig)
      ? (currentPlugin.serverConfig as Record<string, any>)
      : {};

  const currentEnabled = normalizeEnabledWhatsappPhoneNumbers(currentServerConfig.enabledWhatsappPhoneNumbers);
  const desiredEnabled = preferredPhoneNumberId ? [preferredPhoneNumberId] : currentEnabled;

  const nextServerConfig: Record<string, any> = {
    ...currentServerConfig,
    passThroughWebhookUrl: webhookUrl,
  };
  if (desiredEnabled.length > 0) {
    nextServerConfig.enabledWhatsappPhoneNumbers = desiredEnabled;
  }

  const webhookAlreadySet = currentServerConfig.passThroughWebhookUrl === webhookUrl;
  const enabledAlreadySet = desiredEnabled.length === 0 || sameStringArray(currentEnabled, desiredEnabled);

  if (webhookAlreadySet && enabledAlreadySet) {
    return currentPlugin;
  }

  return updatePluginServerConfig(pluginId, nextServerConfig);
}

function extractWhatsappPhoneNumberId(payload: any): string | null {
  const enabledNumbers = payload?.serverConfig?.enabledWhatsappPhoneNumbers;
  if (Array.isArray(enabledNumbers)) {
    const first = enabledNumbers.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (first) {
      return first.trim();
    }
  }

  const directPhoneId = payload?.phoneNumberId;
  if (typeof directPhoneId === 'string' && directPhoneId.trim().length > 0) {
    return directPhoneId.trim();
  }

  return null;
}

// Best-effort: Chakra pass-through ile Meta Cloud API'sinden display_phone_number çek.
// Chakra documented endpoint sadece POST /messages, ama aynı pass-through GET
// genelde aynı Meta resource'una proxy ediyor. Başarısız olursa sessizce null dön.
async function fetchWhatsappPhoneDisplay(
  pluginId: string,
  phoneNumberId: string,
): Promise<string | null> {
  if (!CHAKRA_API_TOKEN || !pluginId || !phoneNumberId) return null;
  try {
    const url = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${pluginId}/api/v19.0/${phoneNumberId}`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      params: { fields: 'display_phone_number,verified_name' },
      timeout: 8000,
    });
    const display = response?.data?.display_phone_number;
    if (typeof display === 'string' && display.trim().length > 0) {
      return display.trim();
    }
    return null;
  } catch (err: any) {
    console.warn(
      'Chakra display phone fetch failed:',
      err?.response?.status,
      err?.response?.data || err?.message,
    );
    return null;
  }
}

function normalizeFaqAnswers(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

async function upsertSalonAiAgentFaqAnswers(salonId: number, patch: Record<string, any>) {
  const existing = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { id: true, faqAnswers: true },
  });

  if (!existing) {
    await prisma.salonAiAgentSettings.create({
      data: {
        salonId,
        faqAnswers: patch,
      },
    });
    return;
  }

  const current = normalizeFaqAnswers(existing.faqAnswers);
  const next: Record<string, any> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    next[key] = value;
  }

  await prisma.salonAiAgentSettings.update({
    where: { salonId },
    data: { faqAnswers: next },
  });
}

async function updateSalonChakraState(
  salonId: number,
  patch: {
    chakraPluginId?: string | null;
    chakraPhoneNumberId?: string | null;
  },
  options?: {
    allowOwnershipTransfer?: boolean;
  },
) {
  const allowOwnershipTransfer = options?.allowOwnershipTransfer !== false;
  const normalizeExternalId = (value?: string | null): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const syncWhatsappChannelBinding = async (nextWhatsappPhoneNumberId: string | null) => {
    // Deactivate existing WhatsApp bindings for this salon first.
    await prisma.salonChannelBinding.updateMany({
      where: { salonId, channel: 'WHATSAPP' },
      data: { isActive: false },
    });

    if (!nextWhatsappPhoneNumberId) return;

    const allowOwnershipTransfer = options?.allowOwnershipTransfer !== false;
    if (!allowOwnershipTransfer) {
      const currentOwner = await prisma.salonChannelBinding.findUnique({
        where: {
          channel_externalAccountId: {
            channel: 'WHATSAPP',
            externalAccountId: nextWhatsappPhoneNumberId,
          },
        },
        select: {
          salonId: true,
          isActive: true,
        },
      });

      if (currentOwner && currentOwner.isActive && currentOwner.salonId !== salonId) {
        return;
      }
    }

    await prisma.salonChannelBinding.upsert({
      where: {
        channel_externalAccountId: {
          channel: 'WHATSAPP',
          externalAccountId: nextWhatsappPhoneNumberId,
        },
      },
      update: {
        salonId,
        isActive: true,
      },
      create: {
        salonId,
        channel: 'WHATSAPP',
        externalAccountId: nextWhatsappPhoneNumberId,
        isActive: true,
      },
    });
  };

  const data: Record<string, any> = {};
  let shouldSyncWhatsappBinding = false;
  let nextWhatsappPhoneNumberId: string | null = null;
  let skipWhatsappPhoneNumberIdUpdate = false;

  if (patch.chakraPluginId !== undefined) {
    data.chakraPluginId = patch.chakraPluginId;
  }

  if (patch.chakraPhoneNumberId !== undefined) {
    nextWhatsappPhoneNumberId = normalizeExternalId(patch.chakraPhoneNumberId);
    if (nextWhatsappPhoneNumberId && !allowOwnershipTransfer) {
      const currentOwner = await prisma.salonChannelBinding.findUnique({
        where: {
          channel_externalAccountId: {
            channel: 'WHATSAPP',
            externalAccountId: nextWhatsappPhoneNumberId,
          },
        },
        select: {
          salonId: true,
          isActive: true,
        },
      });

      if (currentOwner && currentOwner.isActive && currentOwner.salonId !== salonId) {
        skipWhatsappPhoneNumberIdUpdate = true;
      }
    }

    if (!skipWhatsappPhoneNumberIdUpdate) {
      data.chakraPhoneNumberId = nextWhatsappPhoneNumberId;
      shouldSyncWhatsappBinding = true;
    }
  }

  if (Object.keys(data).length > 0) {
    await prisma.salon.update({
      where: { id: salonId },
      data,
    });
  }

  if (shouldSyncWhatsappBinding) {
    await syncWhatsappChannelBinding(nextWhatsappPhoneNumberId);
  }
}

async function setPluginActiveState(pluginId: string, isActive: boolean) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const response = await axios.put(
    `${CHAKRA_API_BASE}/plugin/${pluginId}`,
    { pluginId, isActive },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const pluginData = response?.data?._data;
  if (!pluginData || typeof pluginData !== 'object') {
    throw new Error('Invalid plugin state response from Chakra.');
  }

  return pluginData as Record<string, any>;
}

// Explicit plugin creation route
router.post('/create-plugin', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    if (salon.chakraPluginId) {
      return res.status(200).json({
        success: true,
        pluginId: salon.chakraPluginId,
        salonId: salon.id,
        pluginCreated: false,
      });
    }

    const pluginId = await createPluginForSalon({
      id: salon.id,
      name: salon.name,
      slug: salon.slug,
    });

    return res.status(200).json({
      success: true,
      pluginId,
      salonId: salon.id,
      pluginCreated: true,
    });
  } catch (error: any) {
    console.error('Create plugin failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Create plugin failed.', 500, { error: error?.response?.data || error?.message || 'Unknown error', });
  }
});

// Return current plugin state for UI
router.get('/status', authenticateToken, async (req: any, res: any) => {
  try {
    let salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    const faqAnswers = normalizeFaqAnswers(salon.aiAgentSettings?.faqAnswers);
    let pluginActive = Boolean(faqAnswers.whatsappPluginActive);
    let whatsappPhoneNumberId =
      typeof salon.chakraPhoneNumberId === 'string' && salon.chakraPhoneNumberId.trim().length > 0
        ? salon.chakraPhoneNumberId.trim()
        : typeof faqAnswers.whatsappPhoneNumberId === 'string' && faqAnswers.whatsappPhoneNumberId.trim().length > 0
          ? faqAnswers.whatsappPhoneNumberId.trim()
          : null;
    let liveHasAuth = false;
    let liveHasEnabledPhone = false;
    let activeWhatsappBinding = await prisma.salonChannelBinding.findFirst({
      where: {
        salonId: salon.id,
        channel: 'WHATSAPP',
        isActive: true,
      },
      select: {
        externalAccountId: true,
      },
    });

    if (salon.chakraPluginId && CHAKRA_API_TOKEN) {
      try {
        const livePluginState = await fetchPluginState(salon.chakraPluginId);
        const liveActive = Boolean(livePluginState.isActive);
        const liveWhatsappPhoneNumberId = extractWhatsappPhoneNumberId(livePluginState);
        liveHasAuth = Boolean(livePluginState?.auth && typeof livePluginState.auth === 'object');
        liveHasEnabledPhone = Boolean(liveWhatsappPhoneNumberId);

        const shouldSyncAnswers =
          liveActive !== pluginActive ||
          (liveWhatsappPhoneNumberId || null) !== (whatsappPhoneNumberId || null);

        pluginActive = liveActive;
        whatsappPhoneNumberId = liveWhatsappPhoneNumberId || whatsappPhoneNumberId;
        const hasActiveBindingBeforeSync =
          typeof activeWhatsappBinding?.externalAccountId === 'string' &&
          activeWhatsappBinding.externalAccountId.trim().length > 0;
        const needsBindingBackfill =
          !hasActiveBindingBeforeSync &&
          typeof whatsappPhoneNumberId === 'string' &&
          whatsappPhoneNumberId.trim().length > 0;

        if (shouldSyncAnswers) {
          await updateSalonChakraState(salon.id, {
            chakraPhoneNumberId: liveWhatsappPhoneNumberId || whatsappPhoneNumberId || null,
          }, {
            allowOwnershipTransfer: false,
          });
          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: pluginActive,
            whatsappPhoneNumberId,
            whatsappConnectedAt: pluginActive ? new Date().toISOString() : null,
          });
        } else if (needsBindingBackfill) {
          await updateSalonChakraState(
            salon.id,
            {
              chakraPhoneNumberId: whatsappPhoneNumberId,
            },
            {
              allowOwnershipTransfer: false,
            },
          );
        }

        activeWhatsappBinding = await prisma.salonChannelBinding.findFirst({
          where: {
            salonId: salon.id,
            channel: 'WHATSAPP',
            isActive: true,
          },
          select: {
            externalAccountId: true,
          },
        });
      } catch (liveStatusError: any) {
        if (isPluginNotFoundError(liveStatusError)) {
          await updateSalonChakraState(salon.id, {
            chakraPluginId: null,
            chakraPhoneNumberId: null,
          });
          await cancelPendingSubmissions(salon.id).catch(err =>
            console.error('cancelPendingSubmissions failed:', err)
          );
          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: false,
            whatsappPhoneNumberId: null,
            whatsappConnectedAt: null,
          });

          salon = (await getAuthenticatedSalon(req)) as NonNullable<Awaited<ReturnType<typeof getAuthenticatedSalon>>>;
          pluginActive = false;
          whatsappPhoneNumberId = null;
        } else {
          console.warn('Chakra live status fetch failed:', liveStatusError?.response?.data || liveStatusError?.message || liveStatusError);
        }
      }
    }

    const hasConnectionSignal =
      Boolean(whatsappPhoneNumberId) || liveHasAuth || liveHasEnabledPhone;

    // ÖNEMLİ: status endpoint'i plugin active state'ini mutate etmez.
    // Böylece paneldeki aktif/pasif toggle kullanıcının verdiği değeri korur.
    const hasActiveBinding =
      typeof activeWhatsappBinding?.externalAccountId === 'string' &&
      activeWhatsappBinding.externalAccountId.trim().length > 0;
    const connected = Boolean(salon.chakraPluginId) && hasActiveBinding && (pluginActive || hasConnectionSignal);

    // Backfill: salon.whatsappPhone boşsa, en son WhatsApp webhook log'undan
    // metadata.display_phone_number'ı çıkar. Chakra plugin state phone display
    // dönmediği için bu en güvenilir kaynak. Mesaj geldikten sonra bu kayıt
    // tabloda olur ve bir sonraki status çağrısında numara dolar.
    let whatsappPhoneDisplay: string | null =
      typeof salon.whatsappPhone === 'string' && salon.whatsappPhone.trim().length > 0
        ? salon.whatsappPhone.trim()
        : null;
    if (!whatsappPhoneDisplay) {
      try {
        const recentLog = await prisma.metaChannelWebhookLog.findFirst({
          where: {
            channel: 'WHATSAPP',
            direction: 'INBOUND',
            eventType: 'message',
            OR: [{ salonId: salon.id }, { salonId: null }],
          },
          orderBy: { createdAt: 'desc' },
          select: { payload: true },
          take: 1,
        });
        const payload = recentLog?.payload as any;
        const entries = Array.isArray(payload?.entry) ? payload.entry : [];
        for (const entry of entries) {
          const changes = Array.isArray(entry?.changes) ? entry.changes : [];
          for (const change of changes) {
            const value = change?.value;
            const displayPhoneInPayload = value?.metadata?.display_phone_number;
            // Chakra'nın bildirdiği phone_number_id ile Meta'nın aktif olarak
            // webhook gönderdiği phone_number_id farklı olabiliyor (reconnect
            // sonrası stale state). Burada sadece "salonun en son aldığı WA
            // mesajındaki business display number" kuralını uygula; phoneId
            // match'i zorlamıyoruz.
            if (typeof displayPhoneInPayload === 'string' && displayPhoneInPayload.trim()) {
              whatsappPhoneDisplay = displayPhoneInPayload.trim();
              break;
            }
          }
          if (whatsappPhoneDisplay) break;
        }
        if (whatsappPhoneDisplay) {
          try {
            await prisma.salon.update({
              where: { id: salon.id },
              data: { whatsappPhone: whatsappPhoneDisplay },
            });
          } catch (writeErr: any) {
            console.warn('whatsappPhone log-backfill write failed:', writeErr?.message || writeErr);
          }
        }
      } catch (logErr: any) {
        console.warn('whatsappPhone log-backfill read failed:', logErr?.message || logErr);
      }
    }
    // Fallback: Chakra pass-through GET (best-effort, çoğu zaman 404 dönüyor)
    if (
      !whatsappPhoneDisplay &&
      salon.chakraPluginId &&
      whatsappPhoneNumberId
    ) {
      const fetched = await fetchWhatsappPhoneDisplay(salon.chakraPluginId, whatsappPhoneNumberId);
      if (fetched) {
        whatsappPhoneDisplay = fetched;
        try {
          await prisma.salon.update({
            where: { id: salon.id },
            data: { whatsappPhone: fetched },
          });
        } catch (backfillError: any) {
          console.warn('whatsappPhone backfill failed:', backfillError?.message || backfillError);
        }
      }
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      salonId: salon.id,
      salonName: salon.name,
      slug: salon.slug,
      pluginId: salon.chakraPluginId,
      hasPlugin: Boolean(salon.chakraPluginId),
      connected,
      isActive: pluginActive,
      whatsappPhoneNumberId,
      whatsappPhoneDisplay,
      hasActiveBinding,
      sdkUrl: CHAKRA_SDK_URL,
    });
  } catch (error: any) {
    console.error('Chakra status failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Chakra status failed.', 500, { error: error?.response?.data || error?.message || 'Unknown error', });
  }
});

// Connect token route (uses saved pluginId)
router.get('/connect-token', authenticateToken, async (req: any, res: any) => {
  try {
    const intent = parseConnectIntent(req.query?.intent);
    let salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    let pluginId = salon.chakraPluginId;

    if (!pluginId) {
      pluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });
      salon = (await getAuthenticatedSalon(req)) as NonNullable<Awaited<ReturnType<typeof getAuthenticatedSalon>>>;
    }

    await ensurePluginWebhookConfigured(pluginId);

    let connectToken: string;
    try {
      connectToken = await createConnectToken(pluginId);
    } catch (tokenError: any) {
      if (!isPluginNotFoundError(tokenError)) {
        throw tokenError;
      }

      await updateSalonChakraState(salon.id, {
        chakraPluginId: null,
        chakraPhoneNumberId: null,
      });

      const recreatedPluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });

      pluginId = recreatedPluginId;
      await ensurePluginWebhookConfigured(pluginId);
      connectToken = await createConnectToken(pluginId);
    }

    return res.status(200).json({
      connectToken,
      pluginId,
      sdkUrl: CHAKRA_SDK_URL,
      intent,
    });
  } catch (error: any) {
    console.error('Token generation failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Token generation failed.', 500, { error: error?.response?.data || error?.message || 'Unknown error', });
  }
});

// Capture popup/sdk response and echo normalized connection state
router.post('/connect-event', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    const event = req.body?.event;
    const data = req.body?.data;
    const intent = parseConnectIntent(req.body?.intent);
    const pluginIdFromClient =
      typeof req.body?.pluginId === 'string' && req.body.pluginId.trim() ? req.body.pluginId.trim() : null;
    const pluginId = pluginIdFromClient || salon.chakraPluginId || null;

    if (!pluginId) {
      throw new BusinessError('VALIDATION_FAILED', 'Plugin id is missing.', 400);
    }
    if (salon.chakraPluginId && pluginId !== salon.chakraPluginId) {
      throw new BusinessError('FORBIDDEN', 'Plugin does not match salon scope.', 403);
    }

    let connected = isConnectSuccessEvent(event, data);
    let pluginState: Record<string, any> | null = null;
    let whatsappPhoneNumberId: string | null = null;
    const oldPhoneNumberId =
      typeof salon.chakraPhoneNumberId === 'string' && salon.chakraPhoneNumberId.trim().length > 0
        ? salon.chakraPhoneNumberId.trim()
        : null;

    if (!salon.chakraPluginId) {
      await updateSalonChakraState(salon.id, {
        chakraPluginId: pluginId,
      });
    }

    if (connected) {
      pluginState = await setPluginActiveState(pluginId, true);
      whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || extractWhatsappPhoneNumberId(data);
      pluginState = await ensurePluginWebhookConfigured(pluginId, whatsappPhoneNumberId);
      whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || whatsappPhoneNumberId;

      await updateSalonChakraState(salon.id, {
        chakraPhoneNumberId: whatsappPhoneNumberId,
      });

      await upsertSalonAiAgentFaqAnswers(salon.id, {
        whatsappPluginActive: true,
        whatsappPhoneNumberId,
        whatsappConnectedAt: new Date().toISOString(),
      });

      // SYNC MASTER TEMPLATES ON SUCCESS
      await syncAndEnsureMasterTemplates(salon.id, pluginId).catch(err => {
        console.error('Initial template sync failed:', err);
      });
      // Queue the 90 tone-varied primaries (wave-based, active tone first).
      try {
        const salonRow = await prisma.salon.findUnique({
          where: { id: salon.id },
          select: { communicationTone: true },
        });
        const result = await enqueueSalonTemplates({
          salonId: salon.id,
          tone: salonRow?.communicationTone || 'BALANCED',
        });
        console.log(`[chakra] Enqueued ${result.enqueued} template submissions for salon ${salon.id}`);
      } catch (err) {
        console.error('Template queue enqueue failed:', err);
      }
    } else if (CHAKRA_API_TOKEN) {
      // Popup event adı beklediğimiz formatta gelmese bile canlı plugin durumundan doğrulayalım.
      try {
        const livePluginState = await fetchPluginState(pluginId);
        const liveHasAuth = Boolean(livePluginState?.auth && typeof livePluginState.auth === 'object');
        const livePhoneId = extractWhatsappPhoneNumberId(livePluginState);
        if (liveHasAuth || livePhoneId) {
          pluginState = await setPluginActiveState(pluginId, true);
          whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || livePhoneId || null;
          pluginState = await ensurePluginWebhookConfigured(pluginId, whatsappPhoneNumberId);
          whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || whatsappPhoneNumberId;
          connected = true;

          await updateSalonChakraState(salon.id, {
            chakraPhoneNumberId: whatsappPhoneNumberId,
          });

          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: true,
            whatsappPhoneNumberId,
            whatsappConnectedAt: new Date().toISOString(),
          });

          // SYNC MASTER TEMPLATES ON SUCCESS (Live Check)
          await syncAndEnsureMasterTemplates(salon.id, pluginId).catch(err => {
            console.error('Initial template sync (live) failed:', err);
          });
          try {
            const salonRow = await prisma.salon.findUnique({
              where: { id: salon.id },
              select: { communicationTone: true },
            });
            const result = await enqueueSalonTemplates({
              salonId: salon.id,
              tone: salonRow?.communicationTone || 'BALANCED',
            });
            console.log(`[chakra] Enqueued ${result.enqueued} template submissions for salon ${salon.id} (live)`);
          } catch (err) {
            console.error('Template queue enqueue (live) failed:', err);
          }
        }
      } catch (liveCheckError: any) {
        console.warn('Connect-event live check failed:', liveCheckError?.response?.data || liveCheckError?.message || liveCheckError);
      }
    }

    if (
      connected &&
      intent === 'REPLACE_CONNECTION' &&
      oldPhoneNumberId &&
      whatsappPhoneNumberId &&
      oldPhoneNumberId !== whatsappPhoneNumberId
    ) {
      await writeAccessAudit({
        salonId: salon.id,
        actorUserId: Number.isInteger(req?.user?.userId) ? Number(req.user.userId) : null,
        action: 'channel_identity_replaced',
        targetType: 'WHATSAPP',
        targetId: whatsappPhoneNumberId,
        metadata: {
          intent,
          oldId: oldPhoneNumberId,
          newId: whatsappPhoneNumberId,
          pluginId,
          changedAt: new Date().toISOString(),
        },
      });
    }

    console.log('Chakra connect event', {
      salonId: salon.id,
      pluginId,
      event,
      data,
      connected,
      whatsappPhoneNumberId,
      intent,
    });

    return res.status(200).json({
      ok: true,
      pluginId,
      connected,
      isActive: connected ? true : null,
      whatsappPhoneNumberId,
      pluginState,
      event: typeof event === 'string' ? event : null,
      intent,
    });
  } catch (error: any) {
    console.error('Connect event capture failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Connect event capture failed.', 500, { error: error?.response?.data || error?.message || 'Unknown error', });
  }
});

// Toggle plugin active/passive state explicitly from panel
router.put('/plugin-active', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    const bodyPluginId = typeof req.body?.pluginId === 'string' ? req.body.pluginId.trim() : '';
    const pluginId = bodyPluginId || salon.chakraPluginId || '';
    const isActive = req.body?.isActive;

    if (!pluginId) {
      throw new BusinessError('VALIDATION_FAILED', 'Plugin id is missing.', 400);
    }
    if (typeof isActive !== 'boolean') {
      throw new BusinessError('VALIDATION_FAILED', 'isActive must be boolean.', 400);
    }
    if (salon.chakraPluginId && pluginId !== salon.chakraPluginId) {
      throw new BusinessError('FORBIDDEN', 'Plugin does not match salon scope.', 403);
    }

    if (!salon.chakraPluginId) {
      await updateSalonChakraState(salon.id, {
        chakraPluginId: pluginId,
      });
    }

    const pluginState = await setPluginActiveState(pluginId, isActive);

    // Chakra tarafında state değişimi bazen gecikmeli yansıyabildiği için
    // canlı plugin state'i okuyup doğruluyoruz.
    let verifiedState = pluginState;
    try {
      verifiedState = await fetchPluginState(pluginId);
      if (Boolean(verifiedState?.isActive) !== isActive) {
        // Bir kez daha dene (eventual consistency)
        await setPluginActiveState(pluginId, isActive);
        verifiedState = await fetchPluginState(pluginId);
      }
    } catch (verifyError: any) {
      console.warn('Plugin active verify failed:', verifyError?.response?.data || verifyError?.message || verifyError);
    }

    const finalIsActive = Boolean(verifiedState?.isActive);
    const whatsappPhoneNumberId = extractWhatsappPhoneNumberId(verifiedState);
    const webhookSyncedState = await ensurePluginWebhookConfigured(pluginId, whatsappPhoneNumberId);
    const syncedWhatsappPhoneNumberId =
      extractWhatsappPhoneNumberId(webhookSyncedState) || whatsappPhoneNumberId || salon.chakraPhoneNumberId || null;

    await updateSalonChakraState(salon.id, {
      chakraPhoneNumberId: syncedWhatsappPhoneNumberId,
    });

    await upsertSalonAiAgentFaqAnswers(salon.id, {
      whatsappPluginActive: finalIsActive,
      whatsappPhoneNumberId: syncedWhatsappPhoneNumberId,
      whatsappConnectedAt: finalIsActive ? new Date().toISOString() : null,
    });

    return res.status(200).json({
      ok: true,
      pluginId,
      requestedIsActive: isActive,
      isActive: finalIsActive,
      whatsappPhoneNumberId: syncedWhatsappPhoneNumberId,
      pluginState: webhookSyncedState,
    });
  } catch (error: any) {
    console.error('Plugin active toggle failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Plugin active toggle failed.', 500, { error: error?.response?.data || error?.message || 'Unknown error', });
  }
});

// Disconnect WhatsApp: deactivate + delete plugin in Chakra (best-effort),
// then unlink from salon entirely. chakraPluginId must be cleared because
// /status re-reads Chakra plugin state and would otherwise resurrect the
// phone binding from Chakra's cached serverConfig.
router.post('/disconnect', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    if (salon.chakraPluginId && CHAKRA_API_TOKEN) {
      try {
        await setPluginActiveState(salon.chakraPluginId, false);
      } catch (deactErr: any) {
        console.warn('Chakra plugin deactivate on disconnect failed:', deactErr?.response?.data || deactErr?.message);
      }
      try {
        await axios.delete(`${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}`, {
          headers: {
            Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        });
      } catch (deleteErr: any) {
        // Plugin removal is best-effort; orphaned plugin in Chakra is
        // tolerable as long as we unlink locally.
        console.warn('Chakra plugin delete on disconnect failed:', deleteErr?.response?.status, deleteErr?.response?.data || deleteErr?.message);
      }
    }

    await updateSalonChakraState(salon.id, {
      chakraPluginId: null,
      chakraPhoneNumberId: null,
    });

    await upsertSalonAiAgentFaqAnswers(salon.id, {
      whatsappPluginActive: false,
      whatsappPhoneNumberId: null,
      whatsappConnectedAt: null,
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    if (error instanceof BusinessError) throw error;
    console.error('Chakra disconnect failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Chakra disconnect failed.', 500);
  }
});

// One-shot flow: create plugin (if missing) + create connect token
router.post('/setup-connect', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }

    let pluginId = salon.chakraPluginId;
    let pluginCreated = false;

    if (!pluginId) {
      pluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });
      pluginCreated = true;
    }

    await ensurePluginWebhookConfigured(pluginId);

    const connectToken = await createConnectToken(pluginId);

    return res.status(200).json({
      salonId: salon.id,
      pluginId,
      pluginCreated,
      connectToken,
      sdkUrl: CHAKRA_SDK_URL,
      containerId: 'chakra-whatsapp-connect-container',
    });
  } catch (error: any) {
    console.error('Setup connect failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Setup connect failed.', 500, { error: error?.response?.data || error?.message || 'Unknown error', });
  }
});

// Template routes
router.get('/templates', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = getSalonIdFromUser(req);
    if (!salonId) throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);

    const [templates, salon] = await Promise.all([
      prisma.salonMessageTemplate.findMany({
        where: { salonId },
        orderBy: { eventType: 'asc' }
      }),
      prisma.salon.findUnique({
        where: { id: salonId },
        select: { chakraPluginId: true }
      })
    ]);

    return res.status(200).json({ 
      templates, 
      isConnected: !!salon?.chakraPluginId 
    });
  } catch (error: any) {
    throw new BusinessError('INTERNAL_ERROR', 'Failed to fetch templates', 500, { error: error?.message || error });
  }
});

router.post('/templates/sync', authenticateToken, async (req: any, res: any) => {
  const logs: string[] = [];
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401, { logs: ['Yetkisiz erişim denemesi.'] });
    }
    
    if (!salon.chakraPluginId) {
      logs.push('HATA: Salonun Chakra Plugin ID\'si bulunamadı. Lütfen önce bağlantıyı kurun.');
      throw new BusinessError('VALIDATION_FAILED', 'WhatsApp not connected', 400, { logs });
    }

    await syncAndEnsureMasterTemplates(salon.id, salon.chakraPluginId, logs);
    
    const templates = await prisma.salonMessageTemplate.findMany({
      where: { salonId: salon.id }
    });

    return res.status(200).json({ 
      templates, 
      logs,
      stats: {
        total: templates.length,
        approved: templates.filter(t => t.metaStatus === 'APPROVED').length,
        lastSync: new Date().toISOString()
      }
    });
  } catch (error: any) {
    logs.push(`Sistem Hatası: ${error.message}`);
    console.error('Template sync error:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Sync failed', 500, { error: error?.message || error, logs });
  }
});

router.post('/templates/:templateId/appeal', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon || !salon.chakraPluginId) throw new BusinessError('VALIDATION_FAILED', 'WhatsApp not connected', 400);

    const { templateId } = req.params;
    const template = await prisma.salonMessageTemplate.findFirst({
      where: { id: parseInt(templateId), salonId: salon.id }
    });

    if (!template || !template.templateName) throw new BusinessError('NOT_FOUND', 'Template not found', 404);

    // Look up the master config
    const master = KEDY_MASTER_TEMPLATES.find(m => m.name === template.templateName);
    if (!master) throw new BusinessError('VALIDATION_FAILED', 'Not a master template', 400);

    // Re-submit with original category as a way to "appeal/force"
    await axios.post(
      `${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}/whatsapp-templates`,
      {
        name: master.name,
        category: master.category,
        language: 'tr',
        components: master.components,
      },
      { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } }
    );

    await prisma.salonMessageTemplate.update({
      where: { id: template.id },
      data: { metaStatus: 'APPEALED', lastSyncAt: new Date() }
    });

    return res.status(200).json({ message: 'Appeal submitted' });
  } catch (error: any) {
    console.error('Appeal failed:', error?.response?.data || error);
    throw new BusinessError('INTERNAL_ERROR', 'Appeal failed', 500);
  }
});

export default router;
