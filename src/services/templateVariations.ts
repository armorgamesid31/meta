// WhatsApp template variation registry — tier-aware, curated.
//
// Structure per template:
//   { FRIENDLY: { primary: [3], reserve: [7] }, BALANCED: {...}, PROFESSIONAL: {...} }
//
// Submission flow (handled by salonTemplateSubmitter):
//   1. Submit all 3 PRIMARY variations per (template × tone) as separate Meta templates.
//      Naming: kedy_<key>_<toneCode><variantSlot>  e.g. kedy_randevu_onay_f1, _f2, _f3
//   2. Wait for Meta webhook on each:
//      - APPROVED + category preserved → ACTIVE_VALID ✓ (counts toward 3 valid)
//      - APPROVED + category bumped (UTILITY→MARKETING) → CATEGORY_BUMPED (does NOT count)
//      - REJECTED → REJECTED
//   3. If validCount < 3 and reserve has unused slots, pull next reserve variation,
//      submit it (slot 4..10), repeat until 3 valid OR pool exhausted (POOL_EXHAUSTED).
//
// At send time picker reads salon.communicationTone, queries SalonMessageTemplate
// for ACTIVE_VALID rows of that tone, picks one at random.
//
// Source of truth for content: whatsapp_template_taslaklari/*.txt drafts.

import { SalonCommunicationTone } from '@prisma/client';

export type ToneTier = 'FRIENDLY' | 'BALANCED' | 'PROFESSIONAL';

export interface TonePool {
  primary: string[]; // 3 curated picks — submitted first
  reserve: string[]; // 7 backups — pulled when category bumps or rejects deplete primary
}

export interface TieredVariations {
  FRIENDLY: TonePool;
  BALANCED: TonePool;
  PROFESSIONAL: TonePool;
}

// ─────────────────────────────────────────────────────────────────
// kedy_randevu_onay — UTILITY appointment confirmation
// vars: {{customer_name}}, {{customer_surname}}, {{customer_honorific}},
//       {{appointment_date}}, {{appointment_time}}, {{service_name}}, {{location_url}}
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_ONAY: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Merhaba {{customer_name}}! {{appointment_date}} {{appointment_time}} için {{service_name}} randevun hazır ✨ Konum: {{location_url}}",
      "Randevun tamam {{customer_name}}! 💫 {{service_name}} için {{appointment_date}} {{appointment_time}} görüşüyoruz. {{location_url}}",
      "Kayıt tamam {{customer_name}} 🙌 {{service_name}} | {{appointment_date}} {{appointment_time}}. Harita: {{location_url}}",
    ],
    reserve: [
      "Harika {{customer_name}}! 🎉 {{appointment_date}} saat {{appointment_time}} randevun onaylandı. Yol tarifi: {{location_url}}",
      "Selam {{customer_name}}! {{service_name}} randevun kesinleşti 🗓️ {{appointment_date}} {{appointment_time}} — {{location_url}}",
      "{{customer_name}}, süper haber 🌟 {{appointment_date}} {{appointment_time}} için seni bekliyoruz. Konum: {{location_url}}",
      "{{customer_name}}, randevun onaylandı 🎉 {{appointment_date}} {{appointment_time}} için hazırız. Konum: {{location_url}}",
      "Hey {{customer_name}}! 🌸 {{service_name}} randevun {{appointment_date}} {{appointment_time}} olarak kayıtta. {{location_url}}",
      "Her şey hazır {{customer_name}}! ✨ {{appointment_date}} {{appointment_time}} randevunda seni bekliyoruz. {{location_url}}",
      "{{customer_name}}, randevu onayını iletiyoruz 💛 {{appointment_date}} {{appointment_time}} için görüşürüz. {{location_url}}",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} tarihli {{service_name}} randevunuz onaylandı 🙌 Konum: {{location_url}}",
      "{{customer_name}} {{customer_honorific}}, {{service_name}} randevunuz {{appointment_date}} {{appointment_time}} için oluşturuldu ✨ Yol tarifi: {{location_url}}",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} hizmetiniz {{appointment_date}} {{appointment_time}} tarihinde 💫 {{location_url}}",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, randevunuz {{appointment_date}} {{appointment_time}} olarak planlandı 🌟 {{location_url}}",
      "{{customer_name}} {{customer_honorific}}, {{appointment_date}} saat {{appointment_time}} rezervasyonunuz başarıyla tamamlandı 🌸 {{location_url}}",
      "{{customer_name}} {{customer_honorific}}, randevu kaydınız alındı 🙌 Tarih-saat: {{appointment_date}} {{appointment_time}}. Konum: {{location_url}}",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} randevunuz aktif ✨ {{location_url}}",
      "{{customer_name}} {{customer_honorific}}, planladığımız randevu detayları: {{service_name}} / {{appointment_date}} {{appointment_time}} 🌟 {{location_url}}",
      "Selamlar {{customer_name}} {{customer_honorific}}, rezervasyonunuz kesinleşti 🌸 Görüşme zamanı: {{appointment_date}} {{appointment_time}}. {{location_url}}",
      "{{customer_name}} {{customer_honorific}}, randevu durumunuz onaylı 💛 Konum: {{location_url}}",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} tarihli {{service_name}} randevunuz onaylanmıştır. Konum bağlantısı: {{location_url}}",
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} için randevu planlamanız tamamlanmıştır. Konum: {{location_url}}",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz aktif durumdadır. {{location_url}}",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, rezervasyon işleminiz tamamlanmıştır. Randevu: {{appointment_date}} {{appointment_time}}. {{location_url}}",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz sistemimizde onaylıdır. Detay: {{location_url}}",
      "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız başarıyla oluşturulmuştur. Tarih-saat: {{appointment_date}} {{appointment_time}}.",
      "Sayın {{customer_name}} {{customer_surname}}, hizmet randevunuz aşağıdaki tarihte gerçekleştirilecektir: {{appointment_date}} {{appointment_time}}.",
      "Sayın {{customer_name}} {{customer_surname}}, rezervasyon teyidiniz alınmıştır. Ulaşım için harita: {{location_url}}",
      "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız onaylanmıştır. Saat: {{appointment_time}}, Tarih: {{appointment_date}}.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu süreciniz başarıyla tamamlanmış olup detaylar bu mesajda paylaşılmıştır.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_randevu_hatirlatma_1_gun — UTILITY 1 day reminder
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA_1_GUN: TieredVariations = {
  FRIENDLY: {
    primary: [
      "{{customer_name}}, yarın görüşüyoruz 🎉 {{appointment_time}} için kısa bir onay bırakır mısın?",
      "{{customer_name}}, yarın {{appointment_time}} için seni bekliyoruz. Mini onayın yeterli 🙌",
      "Küçük hatırlatma {{customer_name}} 💫 Yarın buluşmamız var. Tek dokunuşla bildir.",
    ],
    reserve: [
      "Selam {{customer_name}}! Yarın {{service_name}} günü 💅 Katılımını bir tıkla seçebilirsin.",
      "{{customer_name}}, yarınki randevunu unutma diye geldim 😄 Saat {{appointment_time}}. Onaylayalım mı?",
      "Hey {{customer_name}}! Yarın takvimde biz varız ✨ Geliyorum / gelemiyorum'dan birini seç.",
      "Merhaba {{customer_name}}! {{appointment_date}} için randevun aktif 🌸 Katılım durumunu paylaşır mısın?",
      "{{customer_name}}, yarın {{service_name}} için hazırız ✨ Uygunsan \"Katılıyorum\" de.",
      "{{customer_name}}, yarınki planımızı netleştirelim mi? 🌟 Saat {{appointment_time}} için onay bekliyoruz.",
      "{{customer_name}}, seni yarın görmek istiyoruz 🌟 Müsaitsen katılımını işaretle lütfen.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} randevunuz için kısa bir teyit alabilir miyiz? 🙌",
      "Selamlar {{customer_name}} {{customer_honorific}}, yarınki randevunuzu netleştirelim mi? 🌸",
      "{{customer_name}} {{customer_honorific}}, yarınki {{service_name}} randevunuz için kısa bir onay alabilir miyiz? 🌟",
    ],
    reserve: [
      "{{customer_name}} {{customer_honorific}}, yarın {{service_name}} için sizi bekliyoruz ✨ Katılım durumunuzu paylaşır mısınız?",
      "{{customer_name}} {{customer_honorific}}, planlamayı netleştirmek için katılım bilginizi rica ediyoruz 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} için randevunuz aktif — geliyor musunuz? 💫",
      "Selamlar {{customer_name}} {{customer_honorific}}, randevunuz yaklaşırken küçük bir hatırlatma 🤗",
      "{{customer_name}} {{customer_honorific}}, yarınki katılımınızı butonlardan tek dokunuşla bildirebilirsiniz ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevu durumunuzu bildirmeniz planlamamıza yardımcı olur 🙏",
      "{{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} için sizi bekliyoruz — bir teyit bırakır mısınız? 🌸",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, yarın {{appointment_time}} randevunuz bulunmaktadır. Katılım durumunuzu iletebilir misiniz?",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz yarın planlanmıştır. Lütfen uygun seçeneği işaretleyiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, randevunuz yaklaşmaktadır. Onay veya iptal seçiminizi bekliyoruz.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli randevunuz için onayınızı rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, yarınki randevunuz için katılım bilginizi paylaşabilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, nazik hatırlatma: Yarın {{appointment_time}} için rezervasyonunuz aktiftir.",
      "Sayın {{customer_name}} {{customer_surname}}, planlamamızı netleştirmek için katılım durumunuzu bildirmenizi rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, yarınki randevunuz için kısa bir teyit alabilir miyiz?",
      "Sayın {{customer_name}} {{customer_surname}}, hizmet planlamamız için katılım bilginiz önem taşımaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, yarınki randevunuza ilişkin teyit mesajıdır.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_randevu_hatirlatma_3_gun — UTILITY 3 day reminder
// vars include {{late_policy_hours}}
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA_3_GUN: TieredVariations = {
  FRIENDLY: {
    primary: [
      "{{customer_name}}, randevu gününe 3 gün kaldı 🙌 İptal veya değişiklikleri en az {{late_policy_hours}} saat önce haber verirsen harika olur.",
      "Merhaba {{customer_name}}! Randevu yaklaşırken nazikçe hatırlatalım 🌸 İptal ve değişiklikler en az {{late_policy_hours}} saat öncesinden.",
      "Selam {{customer_name}}! 3 gün sonra {{service_name}} için buluşuyoruz 💫 Planın değişirse en az {{late_policy_hours}} saat önce bildir.",
    ],
    reserve: [
      "Selam {{customer_name}}! Takvimde geri sayım başladı ⏳ İptal/değişiklik gerekiyorsa en az {{late_policy_hours}} saat önce yaz lütfen.",
      "Hey {{customer_name}}! Programı birlikte sorunsuz yürütelim ✨ Son dakika yerine en az {{late_policy_hours}} saat önce bildirim rica ediyoruz.",
      "{{customer_name}}, küçük politika hatırlatması 💡 İptal/değişiklikler için {{late_policy_hours}} saat sınırını kaçırmamanı rica ederiz.",
      "{{customer_name}}, 72 saat sonra görüşüyoruz 🌟 Plan değişirse erken haber ver — {{late_policy_hours}} saat öncesine kadar.",
      "{{customer_name}}, son dakikaya kalmadan haber verirsen çok mutlu oluruz 😊 İptal/değişiklik için {{late_policy_hours}} saat öncesi.",
      "{{customer_name}}, no-show yaşamamak için iptal/değişiklik bilgini {{late_policy_hours}} saat öncesinden iletmeyi unutma 🙏",
      "{{customer_name}}, takvim akışı için erken bilgilendirme bizim için çok kıymetli 🌟 İptal/değişiklik {{late_policy_hours}} saat öncesi.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, randevu tarihinize 3 gün kalmıştır 🙌 İptal veya değişiklik taleplerinizi en az {{late_policy_hours}} saat önce iletmenizi rica ederiz.",
      "{{customer_name}} {{customer_honorific}}, plan değişikliği ve iptal taleplerinin en az {{late_policy_hours}} saat önceden bildirilmesi süreci kolaylaştırır 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuz yaklaşırken nazik bir hatırlatma 🤗 İptal/değişiklik için {{late_policy_hours}} saat.",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, randevu planlamamızda gecikme yaşanmaması için {{late_policy_hours}} saat sınırına uyum önemli 🌟",
      "{{customer_name}} {{customer_honorific}}, politika hatırlatması: İptal ve değişiklik talepleri en az {{late_policy_hours}} saat öncesinden ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, no-show politikamıza ilişkin küçük bir hatırlatma 💡 İptal/değişiklik {{late_policy_hours}} saat öncesi.",
      "{{customer_name}} {{customer_honorific}}, takvim akışımız için iptal/değişiklik taleplerinizi {{late_policy_hours}} saat önceden paylaşmanızı rica ederiz 🙏",
      "{{customer_name}} {{customer_honorific}}, müsaitlik planlamasının korunması için iptal/değişiklik bildirimleri {{late_policy_hours}} saat öncesi olmalı 🙏",
      "{{customer_name}} {{customer_honorific}}, geç bildirimler operasyonel akışı zorlaştırabilir 🙇 İptal veya değişiklik için lütfen {{late_policy_hours}} saat önce haber verin.",
      "{{customer_name}} {{customer_honorific}}, zamanında bilgilendirmeniz süreç kalitesini artırır — iptal/değişiklik için {{late_policy_hours}} saat öncesi 💛",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, randevu tarihinize 72 saat kalmıştır. İptal ve değişiklik bildirimleri en az {{late_policy_hours}} saat önce yapılmalıdır.",
      "Sayın {{customer_name}} {{customer_surname}}, plan değişikliği ve iptal taleplerinin en az {{late_policy_hours}} saat önceden iletilmesi gerekmektedir.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu yönetim prosedürlerimiz doğrultusunda iptal/değişiklik bildirimlerinin {{late_policy_hours}} saat öncesinden iletilmesini rica ederiz.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, no-show politikamız kapsamında {{late_policy_hours}} saatten daha geç yapılan iptal/değişiklikler değerlendirmeye alınmaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, hatırlatma: İptal ve değişiklik talepleri için süre {{late_policy_hours}} saat.",
      "Sayın {{customer_name}} {{customer_surname}}, operasyonel planlamamızın sürdürülebilirliği için {{late_policy_hours}} saat sınırına uyum önem taşımaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, belirtilen sürenin dışındaki iptal/değişiklik talepleri uygunluk durumuna bağlı olarak değerlendirilebilir.",
      "Sayın {{customer_name}} {{customer_surname}}, geç iptal ve değişiklik talepleri mevcut politika kuralları çerçevesinde ele alınmaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu sürekliliği için plan değişiklikleri ve iptalleri {{late_policy_hours}} saat öncesinden iletmenizi rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, politika kurallarına uyum hizmet kalitesi ve kapasite yönetimi açısından önem taşımaktadır.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_randevu_hatirlatma_2_saat — UTILITY 2 hour reminder
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA_2_SAAT: TieredVariations = {
  FRIENDLY: {
    primary: [
      "{{customer_name}}, 2 saat sonra buluşuyoruz 👀 Yol tarifi butondan açılıyor.",
      "Hey {{customer_name}}! {{service_name}} seansına 2 saat ⏰ Yola çıkmadan tarife göz at.",
      "{{customer_name}}, yaklaşıyoruz 🚀 Bugün {{appointment_time}} — yol tarifi butonda.",
    ],
    reserve: [
      "Selam {{customer_name}}! Her şey hazır, bir sen eksiksin ✨ Randevuna 2 saat kaldı.",
      "Merhaba {{customer_name}}! {{appointment_time}} için kapımız açık 🌸 Yola çıkarken tarifi unutma.",
      "Mini hatırlatma {{customer_name}}: 2 saat sonra seni ağırlıyoruz 💫",
      "{{customer_name}}, kendine ayırdığın zaman yaklaşıyor 🌟 {{appointment_time}} için bekliyoruz.",
      "{{customer_name}}, sayım başladı 🙌 Bugün {{appointment_time}}, görüşmek üzere.",
      "Selam {{customer_name}}! Bugünkü {{service_name}} için son hatırlatma ✨",
      "{{customer_name}}, hazır mıyız? 😊 2 saat sonra seansın başlıyor.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuza yaklaşık 2 saat kaldı 🫶 Yol tarifi butondan açılabilir.",
      "{{customer_name}} {{customer_honorific}}, bugün {{appointment_time}} randevunuz için sizi ağırlamaya hazırız ✨",
      "{{customer_name}} {{customer_honorific}}, planlanan {{service_name}} seansınıza 2 saat kalmıştır ⏰",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, rahat ulaşmanız için yol tarifini ekledik 🗺️",
      "Selamlar {{customer_name}} {{customer_honorific}}, gelirken trafiğe karşı tarifi kontrol etmenizi öneririz 🚗",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} seansınız için son hatırlatma 🌸",
      "{{customer_name}} {{customer_honorific}}, randevu saatiniz yaklaşmaktadır: {{appointment_time}} 🌟",
      "{{customer_name}} {{customer_honorific}}, bugünkü randevunuz için kısa hatırlatma iletmek istedik 🙌",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{appointment_time}} için sabırsızlanıyoruz 💫",
      "{{customer_name}} {{customer_honorific}}, randevu hatırlatması: bugün saat {{appointment_time}} 🌸",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, randevunuza yaklaşık 2 saat kalmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, bugünkü randevu saatiniz {{appointment_time}} olarak planlanmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} seansınız için hatırlatma mesajıdır.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, konum bilgisi butondan erişiminize sunulmuştur.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu saatinizden önce ulaşım planlamanızı öneririz.",
      "Sayın {{customer_name}} {{customer_surname}}, bugün {{appointment_time}} randevusu için hatırlatma süreci başlatılmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, ulaşım yönlendirmesi mesajda paylaşılmaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu zamanına yaklaşık 2 saat kalmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, gecikme yaşanmaması için zamanında yola çıkmanızı rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız aktiftir ve {{appointment_time}} saatinde gerçekleştirilecektir.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_no_show_hatirlatma — UTILITY no-show notification
// ─────────────────────────────────────────────────────────────────
const KEDY_NO_SHOW_HATIRLATMA: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Selam {{customer_name}}, bugünkü randevuna gelemedin 💭 Plan değiştiyse en az {{late_policy_hours}} saat önce haber verirsen yeni saat ayarlayabiliriz.",
      "Merhaba {{customer_name}}! Bugünkü randevunu kaçırdın 🌸 Yeni bir tarih için yanındayız.",
      "Hey {{customer_name}}, plan değişirse en az {{late_policy_hours}} saat önce haber ver — gelecekte bunu kaçırmayalım 🌸",
    ],
    reserve: [
      "{{customer_name}}, bugün buluşamadık 🙏 İstersen yeni bir tarih bulalım.",
      "Hey {{customer_name}}, randevuya bekledik ama gelemedin 💭 Plan değişirse en az {{late_policy_hours}} saat önce yazarsan ihlal sayılmaz.",
      "{{customer_name}}, bugün eksik kaldık 😊 Sana uygun bir saat bulalım mı?",
      "{{customer_name}}, üzgünüz bugün buluşamadık 🙏 Yeni randevu için tarafımıza yazabilirsin.",
      "Merhaba {{customer_name}}! Bugünkü randevuna gelme şansın olmadı 💫 Sana yeni saat öneriyoruz.",
      "{{customer_name}}, takvimde küçük bir eksiklik 😊 Randevuyu kaçırdın ama yeni bir tarih için buradayız.",
      "{{customer_name}}, randevunda eksiklik oldu 💭 Yeniden bir tarih için yanındayız.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuza gelemediğinizi fark ettik 🌸 İsterseniz yeni bir tarih ayarlayalım.",
      "{{customer_name}} {{customer_honorific}}, bugünkü {{service_name}} randevunuza katılım olmadı 💭 Plan değişikliği için en az {{late_policy_hours}} saat önceden bildirim rica ederiz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuzdan haberinizin olmaması bizi üzdü 🌟 İlerisi için {{late_policy_hours}} saat öncesinden bilgi vermenizi rica ederiz.",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, bugün buluşamadık 🙏 Yeni bir randevu için yardımcı olabiliriz.",
      "{{customer_name}} {{customer_honorific}}, bugünkü randevunuz kaçırılmış görünüyor ✨ Yeni bir tarih için bizimle iletişime geçebilirsiniz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, takvimimize göre bugünkü randevunuza gelmediniz 🙇 Yeni planlama için iletişime geçebilirsiniz.",
      "{{customer_name}} {{customer_honorific}}, bugünkü randevunuz tamamlanmadı 💭 Plan değişikliği için {{late_policy_hours}} saat öncesinden bilgi vermenizi öneririz.",
      "Selamlar {{customer_name}} {{customer_honorific}}, bugün eksik kaldık 🙏 Sizin için yeni bir tarih ayarlayabiliriz.",
      "{{customer_name}} {{customer_honorific}}, randevunuza katılım olmaması bizi üzdü 🌸 Bir sonraki seans için kapımız açık.",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevu durumunuz güncellendi 📋 Yeni randevu planlaması için bekliyoruz.",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} randevunuza katılım gerçekleşmemiştir. Sonraki randevularınız için iptal/değişiklik taleplerinin en az {{late_policy_hours}} saat öncesinden iletilmesini rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, bugünkü {{service_name}} randevunuza ilişkin katılım kaydı bulunmamaktadır. Yeni randevu için tarafımıza ulaşabilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız \"gelinmedi\" olarak işlenmiştir. Politikamız gereği iptal ve değişiklikler en az {{late_policy_hours}} saat öncesinden bildirilmelidir.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, randevunuza katılım sağlanmaması nedeniyle kaydınız güncellenmiştir. Yeni planlama için bizimle iletişime geçebilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli randevunuza katılım gerçekleşmemiştir. Hatırlatma: İptal ve değişiklik talepleri için süre {{late_policy_hours}} saattir.",
      "Sayın {{customer_name}} {{customer_surname}}, bugünkü randevunuzla ilgili katılım kaydı oluşmamıştır. Detaylar için iletişim sağlayabilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu sürecinizde gelinmedi statüsü oluşmuştur. Yeni planlama için bizimle iletişime geçebilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, randevunuz no-show kaydı ile sonuçlanmıştır. {{late_policy_hours}} saat öncesinden bildirim politikamızı hatırlatmak isteriz.",
      "Sayın {{customer_name}} {{customer_surname}}, bugünkü randevunuza katılım olmamıştır. Sonraki randevularınızda iptal/değişiklik için süre {{late_policy_hours}} saattir.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu süreciniz katılım olmadığı için güncellenmiştir. Yeni planlama yapmak isterseniz tarafımıza ulaşabilirsiniz.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_waitlist_teklif — UTILITY waitlist offer
// ─────────────────────────────────────────────────────────────────
const KEDY_WAITLIST_TEKLIF: TieredVariations = {
  FRIENDLY: {
    primary: [
      "{{customer_name}}, müjde 🎉 {{appointment_date}} {{appointment_time}} için bir yer açıldı!",
      "Selam {{customer_name}}! Bekleme listesindeki {{service_name}} için sıra sana geldi ✨",
      "Merhaba {{customer_name}}! {{service_name}} için müsaitlik açıldı 💫 Onaylarsan rezerve edelim.",
    ],
    reserve: [
      "{{customer_name}}, sürpriz var 🍀 {{appointment_date}} {{appointment_time}} aralığında müsait bir slot oluştu.",
      "Hey {{customer_name}}! Beklediğin teklif kapına geldi 🌟 {{appointment_time}} için yer ayıralım mı?",
      "{{customer_name}}, bir iptal oldu ve sana uygun bir slot çıktı 🙌 Hemen değerlendir.",
      "{{customer_name}}, sıradaki teklif sende ⏰ {{appointment_date}} {{appointment_time}} — istersen senin olsun.",
      "Selam {{customer_name}}! Bekleme listesi sırası sende 🌸 Onayını bekliyoruz.",
      "Hızlı not {{customer_name}}: {{service_name}} için yerimiz var 😊 Senin tercihin?",
      "{{customer_name}}, fırsat kapıda 🚪 {{appointment_time}} slotunu senin için ayıralım mı?",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme listesi talebiniz için uygun slot oluştu 🙌",
      "{{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} için müsaitlik mevcut ✨",
      "Selamlar {{customer_name}} {{customer_honorific}}, {{service_name}} için teklif hakkınız açıldı 🌟",
    ],
    reserve: [
      "{{customer_name}} {{customer_honorific}}, sıradaki uygunluk tarafınıza tahsis edildi 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, teklifi onaylamanız halinde randevu kaydınız oluşturulacak 💫",
      "{{customer_name}} {{customer_honorific}}, bekleme listesi durumunuz güncellendi — size öncelik tanımlandı 🙌",
      "Merhaba {{customer_name}} {{customer_honorific}}, uygunluk bildirimi: {{appointment_date}} {{appointment_time}} ⏰",
      "{{customer_name}} {{customer_honorific}}, talep ettiğiniz {{service_name}} için boşluk oluştu 🌟",
      "Selamlar {{customer_name}} {{customer_honorific}}, teklif süresi dolmadan yanıt vermenizi rica ederiz 🙏",
      "{{customer_name}} {{customer_honorific}}, slotu değerlendirmek isterseniz butondan onaylayabilirsiniz ✨",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, bekleme listesi kapsamında tarafınıza özel uygun randevu slotu açılmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} aralığında kapasite oluşmuştur.",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} talebiniz için teklif hakkınız aktif durumdadır.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, yanıtınız doğrultusunda rezervasyon işlemi tamamlanacaktır.",
      "Sayın {{customer_name}} {{customer_surname}}, bekleme listesi sıralamanız çerçevesinde öncelik tanımlanmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, teklif geçerlilik süresi içinde dönüş yapmanızı rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, müsait slot bilgisi sistemimiz tarafından tarafınıza iletilmiştir.",
      "Sayın {{customer_name}} {{customer_surname}}, teklif onayı alınmadığı durumda slot bir sonraki müşteriye devredilecektir.",
      "Sayın {{customer_name}} {{customer_surname}}, uygunluk durumunuzu onaylamak için butonu kullanabilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, anlayışınız ve takip etmeniz için teşekkür ederiz.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_memnuniyet_anketi — UTILITY satisfaction survey
// ─────────────────────────────────────────────────────────────────
const KEDY_MEMNUNIYET_ANKETI: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Merhaba {{customer_name}}! {{service_name}} deneyimin nasıldı? ⭐ 30 saniyede değerlendir.",
      "Selam {{customer_name}}! Görüşüne ihtiyacımız var 🌟 İki sorulu mini değerlendirme.",
      "Hey {{customer_name}}! {{service_name}} sonrası geri bildirimini bekliyoruz 💫",
    ],
    reserve: [
      "{{customer_name}}, bugün seni ağırlamak çok güzeldi 💛 Kısa bir puan bırakır mısın?",
      "{{customer_name}}, son randevun nasıldı? 🌸 Tek dokunuşla puanlayabilirsin.",
      "Bize puan ver {{customer_name}} ⭐ Yorumun ekibimize yol gösteriyor.",
      "{{customer_name}}, memnuniyetini ölçmek için iki soru ✨ Cevapların 1 dakikadan az sürer.",
      "{{customer_name}}, daha iyi olmak için yorumuna ihtiyacımız var 🙏",
      "Mini değerlendirme {{customer_name}}? 🌟 Linke dokunup yıldızlarını ver.",
      "Teşekkürler {{customer_name}}! 💛 Deneyiminizi paylaşır mısınız?",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, aldığınız {{service_name}} hizmetini değerlendirmenizi rica ederiz ⭐",
      "{{customer_name}} {{customer_honorific}}, kısa memnuniyet anketimize katılabilir misiniz? 🌟",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} süreciniz hakkında görüş paylaşabilir misiniz? 🌟",
    ],
    reserve: [
      "Merhaba {{customer_name}} {{customer_honorific}}, hizmet kalitemizi artırmak için değerlendirmenize ihtiyaç duyuyoruz 🙏",
      "{{customer_name}} {{customer_honorific}}, yorumlarınız süreçlerimizi geliştirmemize katkı sağlar 💛",
      "Selamlar {{customer_name}} {{customer_honorific}}, deneyiminizi iki kısa soruyla puanlayabilirsiniz ✨",
      "{{customer_name}} {{customer_honorific}}, hizmet sonu geri bildiriminiz bizim için kıymetli 🌸",
      "{{customer_name}} {{customer_honorific}}, kısa anketi tamamlamanız yeterli — 30 saniye sürmez ⏱️",
      "Selamlar {{customer_name}} {{customer_honorific}}, geri bildirimleriniz ekibimiz tarafından titizlikle incelenir 🙏",
      "{{customer_name}} {{customer_honorific}}, memnuniyet puanınızı iletmenizi rica ederiz 💫",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, hizmet kalitesi değerlendirme sürecine katkınızı rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} sonrası memnuniyet geri bildiriminizi bekliyoruz.",
      "Sayın {{customer_name}} {{customer_surname}}, kısa değerlendirme formunu tamamlamanızı rica ederiz.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, geri bildiriminiz kalite standartlarımızın iyileştirilmesinde kullanılacaktır.",
      "Sayın {{customer_name}} {{customer_surname}}, müşteri deneyim puanlaması iyileştirme süreçlerimiz için önem taşımaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, görüşleriniz hizmet denetim süreçlerimize dahil edilmektedir.",
      "Sayın {{customer_name}} {{customer_surname}}, tarafınıza iletilen bağlantı üzerinden puanlama yapabilirsiniz.",
      "Sayın {{customer_name}} {{customer_surname}}, memnuniyet süreci kapsamında değerlendirme paylaşmanızı bekliyoruz.",
      "Sayın {{customer_name}} {{customer_surname}}, zaman ayırdığınız için teşekkür ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, geri bildiriminiz sistem kayıtlarına işlenecektir.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_google_maps_yorum — UTILITY 3rd-visit Google review request
// ─────────────────────────────────────────────────────────────────
const KEDY_GOOGLE_MAPS_YORUM: TieredVariations = {
  FRIENDLY: {
    primary: [
      "{{customer_name}}, 3. kez seni ağırladık 🥹 Google'da bir yorum bırakır mısın?",
      "Merhaba {{customer_name}}! Üç kez tercih ettiğin için teşekkürler 🙏 Google'da bir cümle yazar mısın?",
      "Hey {{customer_name}}! Üç ziyaretin için teşekkür ediyoruz 🌟 Google'da kısa bir yorum dilersen.",
    ],
    reserve: [
      "Selam {{customer_name}}! Düzenli misafirimizsin artık 💛 Google'da deneyimini paylaşmaya ne dersin?",
      "Hey {{customer_name}}! Üçüncü ziyaretinin şerefine 🥂 Google haritalar'da bir yorum çok kıymetli.",
      "{{customer_name}}, başkalarına seni nasıl ağırladığımızı anlatır mısın? ✨ Google harita yorumu çok yardımcı olur.",
      "{{customer_name}}, 3 randevudur seninle çalışmak güzel 🌟 Bir yorumun başkaları için yol gösterir.",
      "{{customer_name}}, sadık misafirimiz 💫 Google'da 2 dakikalık bir yorum bizim için çok değerli.",
      "Selam {{customer_name}}! 3 randevu = sadık misafir 🎉 Google'da minik bir yorum?",
      "{{customer_name}}, deneyimini paylaşmak ister misin? 🌸 Google haritalar yeni misafirler için rehber.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, {{salon_name}} olarak sizi üçüncü kez ağırlamaktan mutluyuz 🌸",
      "{{customer_name}} {{customer_honorific}}, düzenli müşterimiz olarak Google Maps yorumunuzu rica edebilir miyiz? ⭐",
      "Selamlar {{customer_name}} {{customer_honorific}}, deneyiminizi Google üzerinden paylaşmanız bizim için çok kıymetli 💛",
    ],
    reserve: [
      "{{customer_name}} {{customer_honorific}}, üç randevu boyunca bizi tercih ettiğiniz için teşekkür ederiz 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, kısa bir Google yorumunuz yeni müşterilerimize yol gösterir ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, Google Maps yorumlarınız işletmemizin görünürlüğüne katkı sağlar 🌟",
      "Merhaba {{customer_name}} {{customer_honorific}}, düzenli müşterimiz olarak görüşlerinizi paylaşmanızı rica ederiz 🌸",
      "{{customer_name}} {{customer_honorific}}, Google Maps üzerinden bırakacağınız yorum bizim için değerli 💫",
      "Selamlar {{customer_name}} {{customer_honorific}}, üç randevudur sergilediğiniz güven için teşekkür ederiz 🤗",
      "{{customer_name}} {{customer_honorific}}, deneyiminizi Google'da paylaşmanız işletmemiz için anlamlı 🙌",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, düzenli müşterimiz olarak Google Maps üzerinden değerlendirme paylaşmanızı rica ederiz.",
      "Sayın {{customer_name}} {{customer_surname}}, Google harita üzerindeki yorumunuz potansiyel müşteriler için referans niteliği taşır.",
      "Sayın {{customer_name}} {{customer_surname}}, {{salon_name}} olarak Google üzerinden yorumunuzu rica etmekteyiz.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, üç randevu sonrası referans katkınız işletme görünürlüğümüze fayda sağlamaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, müşteri sadakatiniz için teşekkür eder, Google değerlendirmenizi bekleriz.",
      "Sayın {{customer_name}} {{customer_surname}}, deneyim paylaşımınız işletme yönetimi süreçlerimizde dikkate alınmaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, Google Maps üzerindeki yorumlarınız hizmet stratejimize katkı sağlamaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, üç randevu eşiğini geçmeniz nedeniyle özel referans isteğimizi iletmekteyiz.",
      "Sayın {{customer_name}} {{customer_surname}}, sadakatiniz için müteşekkiriz; Google değerlendirmesi bizim için kıymetlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, Google Maps yorumunuz işletme itibarımız açısından önemlidir.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_dogum_gunu_kutlamasi — MARKETING birthday
// ─────────────────────────────────────────────────────────────────
const KEDY_DOGUM_GUNU_KUTLAMASI: TieredVariations = {
  FRIENDLY: {
    primary: [
      "İyi ki doğdun {{customer_name}}! 🎂 Sana özel doğum günü hediyemiz: {{discount_amount}} indirim, {{validity_period}} geçerli ✨",
      "Doğum günün kutlu olsun {{customer_name}} 🎉 {{discount_amount}} indirim hediyemiz hazır, {{validity_period}} içinde kullanın!",
      "Mutlu yıllar {{customer_name}} 🌸 Doğum günü hediyemiz: {{discount_amount}} indirim ({{validity_period}} geçerli)!",
    ],
    reserve: [
      "Selam {{customer_name}}! 🎂 Doğum günün kutlu olsun, {{discount_amount}} indirim hediyemiz {{validity_period}} geçerli 🎁",
      "Hey {{customer_name}}! 🎈 Doğum günün kutlu olsun! Sana özel {{discount_amount}} indirim, {{validity_period}} senin için ayrıldı.",
      "{{customer_name}}, doğum günün kutlu olsun! 🎉 Hediye olarak {{discount_amount}} indirim seni bekliyor ({{validity_period}}).",
      "Merhaba {{customer_name}}! 🎂 Yeni yaşın hayırlı olsun, doğum günü indiriminiz: {{discount_amount}}, {{validity_period}} ✨",
      "{{customer_name}}, iyi ki varsın 💛 Doğum günün için {{discount_amount}} indirim hediyemiz var ({{validity_period}})!",
      "Selam {{customer_name}} 🥳 Doğum günün kutlu olsun! Sana özel {{discount_amount}} indirim {{validity_period}} geçerli.",
      "{{customer_name}}, doğum günün kutlu olsun 🎁 {{discount_amount}} hediyemizi {{validity_period}} içinde kullanabilirsin.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, size özel {{discount_amount}} indirim hediyemizi sunarız 🎉 ({{validity_period}} geçerli)",
      "{{customer_name}} {{customer_honorific}}, doğum gününüz kutlu olsun ✨ {{discount_amount}} indirim hediyemiz {{validity_period}} içinde geçerlidir.",
      "{{customer_name}} {{customer_honorific}}, salon ailesi olarak doğum gününüzü kutlar, {{discount_amount}} indirim hediyemizi {{validity_period}} ile sunarız 🎂",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, doğum günü hediyeniz hazır 🎂 {{discount_amount}} indirim, {{validity_period}} geçerli!",
      "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, {{discount_amount}} indirim fırsatımızı paylaşırız 🌟 {{validity_period}}",
      "Mutlu yıllar {{customer_name}} {{customer_honorific}} 🎈 Size özel doğum günü indiriminiz: {{discount_amount}}, {{validity_period}} içinde geçerli.",
      "{{customer_name}} {{customer_honorific}}, doğum gününüz kutlu olsun 🎈 Hediyemiz {{discount_amount}} indirim ({{validity_period}}).",
      "Selamlar {{customer_name}} {{customer_honorific}}, doğum günü mesajımızla birlikte {{discount_amount}} indirim sunarız 💛 {{validity_period}}",
      "Merhaba {{customer_name}} {{customer_honorific}}, bu özel günde size özel {{discount_amount}} indirim hazırladık 🌟 {{validity_period}}",
      "{{customer_name}} {{customer_honorific}}, nice mutlu yıllara 🌸 Doğum günü hediyeniz: {{discount_amount}} indirim, {{validity_period}} geçerli.",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, doğum gününüzü kutlar, tarafınıza özel {{discount_amount}} indirim fırsatımızı sunarız. Geçerlilik süresi: {{validity_period}}.",
      "Sayın {{customer_name}} {{customer_surname}}, bu özel gününüzü kutlar, {{discount_amount}} doğum günü hediyemizi sunarız. {{validity_period}} süreyle geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, mutlu yıllar dileklerimizle birlikte {{discount_amount}} doğum günü indirimimiz {{validity_period}} süreyle tarafınıza sunulmuştur.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, doğum günü mesajımızı sunmaktan mutluluk duyarız. {{discount_amount}} indirim, {{validity_period}} içinde geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, doğum gününüz kutlu olsun. Size özel {{discount_amount}} indirim {{validity_period}} içinde geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, doğum gününüzü kutlar, {{discount_amount}} indirim fırsatımızı paylaşırız. {{validity_period}} süreyle geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, bu anlamlı gününüzde tarafınıza özel {{discount_amount}} indirim sunmaktan mutluluk duyarız. Geçerlilik: {{validity_period}}.",
      "Sayın {{customer_name}} {{customer_surname}}, doğum gününüz vesilesiyle {{discount_amount}} indirim hakkınız {{validity_period}} içinde geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, yeni yaşınızın hayırlı olmasını diler, {{discount_amount}} doğum günü indirimimizi sunarız. {{validity_period}}.",
      "Sayın {{customer_name}} {{customer_surname}}, doğum günü dileklerimizi {{discount_amount}} indirim hediyemizle birlikte iletmek isteriz. {{validity_period}} geçerli.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kedy_geri_donus — MARKETING winback
// ─────────────────────────────────────────────────────────────────
const KEDY_GERI_DONUS: TieredVariations = {
  FRIENDLY: {
    primary: [
      "{{customer_name}}, uzun süredir görüşmedik 💭 Seni geri kazanmak için {{discount_amount}} indirim hediyemiz var, {{validity_period}} geçerli ✨",
      "Selam {{customer_name}} 🌸 Bir süredir uğramadın, sana özel {{discount_amount}} indirim ({{validity_period}})!",
      "{{customer_name}}, geri dönüş hediyemiz hazır 💫 {{discount_amount}} indirim, {{validity_period}} geçerli!",
    ],
    reserve: [
      "Hey {{customer_name}}, salon olarak seni özlüyoruz 💛 {{discount_amount}} indirimle tekrar bir araya gelelim! {{validity_period}} geçerli.",
      "Merhaba {{customer_name}}! Sana özel {{discount_amount}} indirim hazır 🌟 {{validity_period}} içinde kullanabilirsin.",
      "{{customer_name}}, seni özledik 💛 Sana özel {{discount_amount}} indirim hediyemiz {{validity_period}} içinde geçerli.",
      "Selam {{customer_name}}! 🌸 Tekrar görüşmek için sana {{discount_amount}} indirim hazırladık ({{validity_period}}).",
      "{{customer_name}}, geri dönüş için müjde 🎁 {{discount_amount}} indirim, {{validity_period}} geçerli!",
      "Hey {{customer_name}}, bekleyemedik 😊 Sana özel {{discount_amount}} indirim, {{validity_period}} içinde kullan.",
      "{{customer_name}}, salonumuzda eskisi gibi bir araya gelelim ✨ {{discount_amount}} indirim, {{validity_period}}.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşmedik 🌸 Size özel {{discount_amount}} indirim hediyemizi sunarız ({{validity_period}}).",
      "{{customer_name}} {{customer_honorific}}, bir süredir görüşmedik 💭 Geri dönüş hediyemiz: {{discount_amount}} indirim, {{validity_period}} geçerli.",
      "{{customer_name}} {{customer_honorific}}, eski güzel günleri yeniden yaşamak için sizi {{discount_amount}} indirimle bekleriz 💛 {{validity_period}}",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, sizi tekrar ağırlamak isteriz 🌟 {{discount_amount}} indirim fırsatımız {{validity_period}} içinde geçerlidir.",
      "Merhaba {{customer_name}} {{customer_honorific}}, salon olarak sizi özledik ✨ {{discount_amount}} indirim ile tekrar buluşalım ({{validity_period}}).",
      "{{customer_name}} {{customer_honorific}}, tekrar görüşmek için size {{discount_amount}} indirim sunuyoruz 💫 {{validity_period}}",
      "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşemedik 🌸 {{discount_amount}} indirimle tekrar bir araya gelelim ({{validity_period}}).",
      "Selamlar {{customer_name}} {{customer_honorific}}, salon ailesi olarak sizi özledik 🌟 {{discount_amount}} indirim hediyemiz {{validity_period}} geçerli.",
      "{{customer_name}} {{customer_honorific}}, geri dönüş için size özel {{discount_amount}} indirim hazırladık ✨ {{validity_period}} içinde kullanabilirsiniz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, sizi tekrar ağırlamak için kapımız açık — üstelik {{discount_amount}} indirimle 🌸 {{validity_period}}",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, uzun bir süredir randevu kaydınız oluşmamıştır. Tekrar ağırlamak amacıyla {{discount_amount}} indirim fırsatımızı sunarız. {{validity_period}} süreyle geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, salon olarak yokluğunuzu hissetmekteyiz. {{discount_amount}} indirim hakkınız {{validity_period}} içinde geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, müşterimiz olarak tarafınıza özel {{discount_amount}} indirim sunuyoruz. {{validity_period}} süreyle değerlendirebilirsiniz.",
    ],
    reserve: [
      "Sayın {{customer_name}} {{customer_surname}}, sizi tekrar ağırlamak için {{discount_amount}} indirim fırsatımızı paylaşırız. Geçerlilik süresi: {{validity_period}}.",
      "Sayın {{customer_name}} {{customer_surname}}, bir süredir görüşmediğimizin farkındayız. {{discount_amount}} indirim hediyemiz {{validity_period}} geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, son ziyaretinizden bu yana belirli bir süre geçmiştir. Tarafınıza özel {{discount_amount}} indirim fırsatı {{validity_period}} içinde geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, müşterimiz olarak yokluğunuzu önemsiyoruz. {{discount_amount}} indirim hediyemizi {{validity_period}} süreyle sunarız.",
      "Sayın {{customer_name}} {{customer_surname}}, salon olarak siz değerli müşterilerimizi {{discount_amount}} indirimle ağırlamaktan memnuniyet duyarız. {{validity_period}}.",
      "Sayın {{customer_name}} {{customer_surname}}, hizmetlerimizden tekrar yararlanmanız için {{discount_amount}} indirim fırsatımız {{validity_period}} içinde geçerlidir.",
      "Sayın {{customer_name}} {{customer_surname}}, müsait olduğunuz bir tarihte sizi {{discount_amount}} indirimle ağırlamaktan memnuniyet duyarız. {{validity_period}}.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────
export const TIERED_TEMPLATE_VARIATIONS: Record<string, TieredVariations> = {
  kedy_randevu_onay: KEDY_RANDEVU_ONAY,
  kedy_randevu_hatirlatma_1_gun: KEDY_RANDEVU_HATIRLATMA_1_GUN,
  kedy_randevu_hatirlatma_3_gun: KEDY_RANDEVU_HATIRLATMA_3_GUN,
  kedy_randevu_hatirlatma_2_saat: KEDY_RANDEVU_HATIRLATMA_2_SAAT,
  kedy_no_show_hatirlatma: KEDY_NO_SHOW_HATIRLATMA,
  kedy_waitlist_teklif: KEDY_WAITLIST_TEKLIF,
  kedy_memnuniyet_anketi: KEDY_MEMNUNIYET_ANKETI,
  kedy_google_maps_yorum: KEDY_GOOGLE_MAPS_YORUM,
  kedy_dogum_gunu_kutlamasi: KEDY_DOGUM_GUNU_KUTLAMASI,
  kedy_geri_donus: KEDY_GERI_DONUS,
};

// Logical-key → category mapping for category-bump watchdog.
// kedy_dogum_gunu_kutlamasi & kedy_geri_donus go up as MARKETING; rest as UTILITY.
export const TEMPLATE_EXPECTED_CATEGORY: Record<string, 'UTILITY' | 'MARKETING'> = {
  kedy_randevu_onay: 'UTILITY',
  kedy_randevu_hatirlatma_1_gun: 'UTILITY',
  kedy_randevu_hatirlatma_3_gun: 'UTILITY',
  kedy_randevu_hatirlatma_2_saat: 'UTILITY',
  kedy_no_show_hatirlatma: 'UTILITY',
  kedy_waitlist_teklif: 'UTILITY',
  kedy_memnuniyet_anketi: 'UTILITY',
  kedy_google_maps_yorum: 'UTILITY',
  kedy_dogum_gunu_kutlamasi: 'MARKETING',
  kedy_geri_donus: 'MARKETING',
};

// ─────────────────────────────────────────────────────────────────
// Tone helpers
// ─────────────────────────────────────────────────────────────────

export function toneToTier(tone: SalonCommunicationTone | string | null | undefined): ToneTier {
  const t = String(tone || '').toUpperCase();
  if (t === 'FRIENDLY' || t === 'PROFESSIONAL') return t;
  return 'BALANCED';
}

export function toneCode(tone: ToneTier): 'f' | 'b' | 'p' {
  if (tone === 'FRIENDLY') return 'f';
  if (tone === 'PROFESSIONAL') return 'p';
  return 'b';
}

/**
 * Compose the Meta template name for a given logical key, tone, and variant slot.
 *   buildTemplateName('kedy_randevu_onay', 'FRIENDLY', 1) → 'kedy_randevu_onay_f1'
 * Slot is 1-based: 1-3 = primary, 4-10 = reserve.
 */
export function buildTemplateName(logicalKey: string, tone: ToneTier, slot: number): string {
  return `${logicalKey}_${toneCode(tone)}${slot}`;
}

/**
 * Return the variation body for a (key, tone, slot). Slot is 1-based.
 *   slots 1-3  → primary[0-2]
 *   slots 4-10 → reserve[0-6]
 */
export function getVariationBySlot(
  logicalKey: string,
  tone: ToneTier,
  slot: number,
): string | null {
  const v = TIERED_TEMPLATE_VARIATIONS[logicalKey];
  if (!v) return null;
  const pool = v[tone];
  if (slot >= 1 && slot <= 3) return pool.primary[slot - 1] ?? null;
  if (slot >= 4 && slot <= 10) return pool.reserve[slot - 4] ?? null;
  return null;
}

/**
 * Total slots available in a (key, tone) pool — primary + reserve.
 */
export function totalSlots(logicalKey: string, tone: ToneTier): number {
  const v = TIERED_TEMPLATE_VARIATIONS[logicalKey];
  if (!v) return 0;
  return v[tone].primary.length + v[tone].reserve.length;
}

export function hasTieredVariations(logicalKey: string): boolean {
  return Boolean(TIERED_TEMPLATE_VARIATIONS[logicalKey]);
}

/**
 * List of all logical template keys.
 */
export function listTemplateKeys(): string[] {
  return Object.keys(TIERED_TEMPLATE_VARIATIONS);
}

/**
 * All three tones.
 */
export const ALL_TONES: ToneTier[] = ['FRIENDLY', 'BALANCED', 'PROFESSIONAL'];

// ─────────────────────────────────────────────────────────────────
// Legacy API shims (used by routes/chakra.ts bulk submitter — to be
// removed once that path is fully migrated to the queue-based worker).
// ─────────────────────────────────────────────────────────────────

export function getTierForTemplate(
  templateName: string,
  tone: SalonCommunicationTone | string | null | undefined,
): string[] | null {
  const v = TIERED_TEMPLATE_VARIATIONS[templateName];
  if (!v) return null;
  const pool = v[toneToTier(tone)];
  return [...pool.primary, ...pool.reserve];
}

export function pickVariation(
  templateName: string,
  tone: SalonCommunicationTone | string | null | undefined,
  rng: () => number = Math.random,
): string | null {
  const tier = getTierForTemplate(templateName, tone);
  if (!tier || tier.length === 0) return null;
  const idx = Math.floor(rng() * tier.length);
  return tier[idx];
}

export function pickNextInTier(
  templateName: string,
  tone: SalonCommunicationTone | string | null | undefined,
  currentBody: string,
): string | null {
  const tier = getTierForTemplate(templateName, tone);
  if (!tier || tier.length === 0) return null;
  const currentIdx = tier.indexOf(currentBody);
  const nextIdx = (currentIdx + 1) % tier.length;
  return tier[nextIdx];
}
