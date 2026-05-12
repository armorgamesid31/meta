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
  {
    logicalKey: 'kedy_randevu_onay',
    displayName: 'Randevu Onayı',
    category: 'musteri',
    description: 'Yeni randevu oluşturulduğunda otomatik gönderilir',
    expectedCategory: 'UTILITY',
  },
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

export type OperationalStatus = 'preparing' | 'active' | 'transient_issue' | 'unavailable';

export const STATUS_LABELS: Record<OperationalStatus, { tr: string; tone: string }> = {
  preparing:        { tr: 'Meta onayı bekliyor',           tone: 'pending'  },
  active:           { tr: 'Hazır',                          tone: 'success'  },
  transient_issue:  { tr: 'Geçici sorun, tekrar deniyoruz', tone: 'warn'     },
  unavailable:      { tr: 'Onay alınamadı',                 tone: 'error'    },
};
