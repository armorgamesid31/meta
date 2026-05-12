// Friendly operational names + descriptions for salon-facing template UI.
// Technical kedy_* identifiers are mapped to human-readable Turkish labels
// shown in WhatsAppTemplateStatusPage.

export type TemplateCategory = 'musteri' | 'pazarlama' | 'dogrulama';

export interface OperationalTemplate {
  logicalKey: string;
  displayName: string;
  category: TemplateCategory;
  description: string;
  expectedCategory: 'UTILITY' | 'MARKETING';
}

export const OPERATIONAL_TEMPLATES: OperationalTemplate[] = [
  // Müşteri mesajları
  // kedy_randevu_onay removed — see templateVariations.ts comment.
  {
    logicalKey: 'kedy_randevu_hatirlatma_1_gun',
    displayName: '1 Gün Önce Hatırlatma',
    category: 'musteri',
    description: 'Randevudan 1 gün önce gönderilir',
    expectedCategory: 'UTILITY',
  },
  {
    logicalKey: 'kedy_randevu_hatirlatma_3_gun',
    displayName: '3 Gün Önce Hatırlatma',
    category: 'musteri',
    description: 'Randevudan 3 gün önce — iptal/değişiklik politikasıyla',
    expectedCategory: 'UTILITY',
  },
  {
    logicalKey: 'kedy_randevu_hatirlatma_2_saat',
    displayName: 'Randevuya 2 Saat Kala',
    category: 'musteri',
    description: 'Randevudan 2 saat önce — yol tarifiyle birlikte',
    expectedCategory: 'UTILITY',
  },
  {
    logicalKey: 'kedy_no_show_hatirlatma',
    displayName: 'Gelmeyene Bildirim',
    category: 'musteri',
    description: 'Müşteri randevuya gelmediğinde gönderilir',
    expectedCategory: 'UTILITY',
  },
  {
    logicalKey: 'kedy_waitlist_teklif',
    displayName: 'Bekleme Listesi Teklifi',
    category: 'musteri',
    description: 'Bekleme listesindeki müşteriye boş saat çıkınca gönderilir',
    expectedCategory: 'UTILITY',
  },
  {
    logicalKey: 'kedy_memnuniyet_anketi',
    displayName: 'Hizmet Memnuniyet Anketi',
    category: 'musteri',
    description: 'Randevu sonrası değerlendirme isteği',
    expectedCategory: 'UTILITY',
  },
  {
    logicalKey: 'kedy_google_maps_yorum',
    displayName: 'Google Yorum İsteği',
    category: 'musteri',
    description: "Müşterinin 3. ziyaretinden sonra bir kez gönderilir",
    expectedCategory: 'UTILITY',
  },
  // Pazarlama mesajları
  {
    logicalKey: 'kedy_dogum_gunu_kutlamasi',
    displayName: 'Doğum Günü Kutlaması',
    category: 'pazarlama',
    description: 'Müşterinin doğum gününde — indirim ayarladıysanız aktif',
    expectedCategory: 'MARKETING',
  },
  {
    logicalKey: 'kedy_geri_donus',
    displayName: 'Geri Kazanım Mesajı',
    category: 'pazarlama',
    description: '45+ gündür gelmeyen müşteriye — indirim ayarladıysanız',
    expectedCategory: 'MARKETING',
  },
  // Doğrulama mesajları (salon WABA — kedy_islem_link)
  {
    logicalKey: 'kedy_islem_link',
    displayName: 'Müşteri Doğrulama',
    category: 'dogrulama',
    description: 'Yeni müşteri telefonunu doğrularken otomatik gönderilir',
    expectedCategory: 'UTILITY',
  },
];

export type OperationalStatus =
  | 'not_queued'        // logical key has no row in DB yet — sync not run
  | 'queued'            // NOT_QUEUED row, scheduled but worker hasn't sent to Meta yet
  | 'submitted'         // SUBMITTED to Meta, waiting for approval decision
  | 'active'            // ACTIVE_VALID — at least one variant approved + category preserved
  | 'transient_issue'   // some variants rejected/bumped but reserves are still being tried
  | 'unavailable';      // POOL_EXHAUSTED — all 10 slots tried, < 3 valid

export const STATUS_LABELS: Record<OperationalStatus, { tr: string; tone: string }> = {
  not_queued:       { tr: 'Henüz başlatılmadı',              tone: 'idle'     },
  queued:           { tr: 'Sırada — Meta\'ya gönderilecek',  tone: 'pending'  },
  submitted:        { tr: 'Meta onayında',                   tone: 'pending'  },
  active:           { tr: 'Hazır',                            tone: 'success'  },
  transient_issue:  { tr: 'Yedekler deneniyor',              tone: 'warn'     },
  unavailable:      { tr: 'Onay alınamadı',                  tone: 'error'    },
};
