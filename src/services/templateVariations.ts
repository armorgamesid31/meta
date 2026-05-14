// WhatsApp template variation registry — tier-aware, curated.
//
// Structure per template:
//   { FRIENDLY: { primary: [3], reserve: [7] }, BALANCED: {...}, PROFESSIONAL: {...} }
//
// Submission flow (handled by salonTemplateSubmitter):
//   1. Submit all 3 PRIMARY variations per (template × tone) as separate Meta templates.
//      Naming: kdy_<key>_<toneCode><variantSlot>  e.g. kdy_randevu_onay_f1, _f2, _f3
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

// kdy_randevu_onay (appointment confirmation) removed per business
// decision — the salon's existing booking flow already shows the
// confirmation in the customer's WhatsApp inbound thread; a separate
// outbound template was redundant.

// ─────────────────────────────────────────────────────────────────
// kdy_randevu_hatirlatma_1_gun — UTILITY 1 day reminder
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA_1_GUN: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Hey {{customer_name}}, yarın görüşüyoruz 🎉 {{appointment_time}} için kısa bir onay bırakır mısın?",
      "Hey {{customer_name}}, yarın {{appointment_time}} için seni bekliyoruz. Mini onayın yeterli 🙌",
      "Küçük hatırlatma {{customer_name}} 💫 Yarın buluşmamız var. Tek dokunuşla bildir.",
    ],
    reserve: [
      "Selam {{customer_name}}! Yarın {{service_name}} günü 💅 Katılımını bir tıkla seçebilirsin.",
      "Hey {{customer_name}}, yarınki randevunu unutma diye geldim 😄 Saat {{appointment_time}}. Onaylayalım mı?",
      "Hey {{customer_name}}! Yarın takvimde biz varız ✨ Geliyorum / gelemiyorum'dan birini seç.",
      "Merhaba {{customer_name}}! {{appointment_date}} için randevun aktif 🌸 Katılım durumunu paylaşır mısın?",
      "Hey {{customer_name}}, yarın {{service_name}} için hazırız ✨ Uygunsan \"Katılıyorum\" de.",
      "Hey {{customer_name}}, yarınki planımızı netleştirelim mi? 🌟 Saat {{appointment_time}} için onay bekliyoruz.",
      "Hey {{customer_name}}, seni yarın görmek istiyoruz 🌟 Müsaitsen katılımını işaretle lütfen.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} randevunuz için kısa bir teyit alabilir miyiz? 🙌",
      "Selamlar {{customer_name}} {{customer_honorific}}, yarınki randevunuzu netleştirelim mi? 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, yarınki {{service_name}} randevunuz için kısa bir onay alabilir miyiz? 🌟",
    ],
    reserve: [
      "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{service_name}} için sizi bekliyoruz ✨ Katılım durumunuzu paylaşır mısınız?",
      "Merhaba {{customer_name}} {{customer_honorific}}, planlamayı netleştirmek için katılım bilginizi rica ediyoruz 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} için randevunuz aktif — geliyor musunuz? 💫",
      "Selamlar {{customer_name}} {{customer_honorific}}, randevunuz yaklaşırken küçük bir hatırlatma 🤗",
      "Merhaba {{customer_name}} {{customer_honorific}}, yarınki katılımınızı butonlardan tek dokunuşla bildirebilirsiniz ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevu durumunuzu bildirmeniz planlamamıza yardımcı olur 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} için sizi bekliyoruz — bir teyit bırakır mısınız? 🌸",
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
// kdy_randevu_hatirlatma_3_gun — UTILITY 3 day reminder
// vars include {{late_policy_hours}}
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA_3_GUN: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Hey {{customer_name}}, randevu gününe 3 gün kaldı 🙌 İptal veya değişiklikleri en az {{late_policy_hours}} saat önce haber verirsen harika olur.",
      "Merhaba {{customer_name}}! Randevu yaklaşırken nazikçe hatırlatalım 🌸 İptal ve değişiklikler en az {{late_policy_hours}} saat öncesinden.",
      "Selam {{customer_name}}! 3 gün sonra {{service_name}} için buluşuyoruz 💫 Planın değişirse en az {{late_policy_hours}} saat önce bildir.",
    ],
    reserve: [
      "Selam {{customer_name}}! Takvimde geri sayım başladı ⏳ İptal/değişiklik gerekiyorsa en az {{late_policy_hours}} saat önce yaz lütfen.",
      "Hey {{customer_name}}! Programı birlikte sorunsuz yürütelim ✨ Son dakika yerine en az {{late_policy_hours}} saat önce bildirim rica ediyoruz.",
      "Hey {{customer_name}}, küçük politika hatırlatması 💡 İptal/değişiklikler için {{late_policy_hours}} saat sınırını kaçırmamanı rica ederiz.",
      "Hey {{customer_name}}, 72 saat sonra görüşüyoruz 🌟 Plan değişirse erken haber ver — {{late_policy_hours}} saat öncesine kadar.",
      "Hey {{customer_name}}, son dakikaya kalmadan haber verirsen çok mutlu oluruz 😊 İptal/değişiklik için {{late_policy_hours}} saat öncesi.",
      "Hey {{customer_name}}, no-show yaşamamak için iptal/değişiklik bilgini {{late_policy_hours}} saat öncesinden iletmeyi unutma 🙏",
      "Hey {{customer_name}}, takvim akışı için erken bilgilendirme bizim için çok kıymetli 🌟 İptal/değişiklik {{late_policy_hours}} saat öncesi.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, randevu tarihinize 3 gün kalmıştır 🙌 İptal veya değişiklik taleplerinizi en az {{late_policy_hours}} saat önce iletmenizi rica ederiz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, plan değişikliği ve iptal taleplerinin en az {{late_policy_hours}} saat önceden bildirilmesi süreci kolaylaştırır 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuz yaklaşırken nazik bir hatırlatma 🤗 İptal/değişiklik için {{late_policy_hours}} saat.",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, randevu planlamamızda gecikme yaşanmaması için {{late_policy_hours}} saat sınırına uyum önemli 🌟",
      "Merhaba {{customer_name}} {{customer_honorific}}, politika hatırlatması: İptal ve değişiklik talepleri en az {{late_policy_hours}} saat öncesinden ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, no-show politikamıza ilişkin küçük bir hatırlatma 💡 İptal/değişiklik {{late_policy_hours}} saat öncesi.",
      "Merhaba {{customer_name}} {{customer_honorific}}, takvim akışımız için iptal/değişiklik taleplerinizi {{late_policy_hours}} saat önceden paylaşmanızı rica ederiz 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, müsaitlik planlamasının korunması için iptal/değişiklik bildirimleri {{late_policy_hours}} saat öncesi olmalı 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, geç bildirimler operasyonel akışı zorlaştırabilir 🙇 İptal veya değişiklik için lütfen {{late_policy_hours}} saat önce haber verin.",
      "Merhaba {{customer_name}} {{customer_honorific}}, zamanında bilgilendirmeniz süreç kalitesini artırır — iptal/değişiklik için {{late_policy_hours}} saat öncesi 💛",
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
// kdy_randevu_hatirlatma_2_saat — UTILITY 2 hour reminder
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA_2_SAAT: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Hey {{customer_name}}, 2 saat sonra buluşuyoruz 👀 Yol tarifi butondan açılıyor.",
      // Eski hali "Yola çıkmadan tarife göz at" imperative CTA içeriyordu,
      // Meta MARKETING'e bump'ladı. Bilgilendirici tona çevrildi.
      "Hey {{customer_name}}, {{service_name}} randevuna 2 saat kaldı ⏰ Yol tarifi butonda hazır.",
      "Hey {{customer_name}}, yaklaşıyoruz 🚀 Bugün {{appointment_time}} — yol tarifi butonda.",
    ],
    reserve: [
      "Selam {{customer_name}}! Her şey hazır, bir sen eksiksin ✨ Randevuna 2 saat kaldı.",
      "Merhaba {{customer_name}}! {{appointment_time}} için kapımız açık 🌸 Yola çıkarken tarifi unutma.",
      "Mini hatırlatma {{customer_name}}: 2 saat sonra seni ağırlıyoruz 💫",
      "Hey {{customer_name}}, kendine ayırdığın zaman yaklaşıyor 🌟 {{appointment_time}} için bekliyoruz.",
      "Hey {{customer_name}}, sayım başladı 🙌 Bugün {{appointment_time}}, görüşmek üzere.",
      "Selam {{customer_name}}! Bugünkü {{service_name}} için son hatırlatma ✨",
      "Hey {{customer_name}}, hazır mıyız? 😊 2 saat sonra seansın başlıyor.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuza yaklaşık 2 saat kaldı 🫶 Yol tarifi butondan açılabilir.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugün {{appointment_time}} randevunuz için sizi ağırlamaya hazırız ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, planlanan {{service_name}} seansınıza 2 saat kalmıştır ⏰",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, rahat ulaşmanız için yol tarifini ekledik 🗺️",
      "Selamlar {{customer_name}} {{customer_honorific}}, gelirken trafiğe karşı tarifi kontrol etmenizi öneririz 🚗",
      "Merhaba {{customer_name}} {{customer_honorific}}, planlanan {{service_name}} seansınız için kısa bir hatırlatma iletiyoruz, randevunuza yaklaşık iki saat kalmıştır 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugün için planlanan randevu saatiniz yaklaşmaktadır, randevu zamanınız {{appointment_time}} olarak belirlenmiştir 🌟",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuz için kısa bir hatırlatma iletmek istedik, görüşmek üzere 🙌",
      "Merhaba {{customer_name}} {{customer_honorific}}, planlanan randevu zamanınız {{appointment_time}} olarak yaklaşmaktadır, sizi ağırlamaya hazırız 💫",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevu hatırlatması: planlanan randevu saatiniz {{appointment_time}} olarak belirlenmiştir 🌸",
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
// kdy_no_show_hatirlatma — UTILITY no-show notification
// ─────────────────────────────────────────────────────────────────
const KEDY_NO_SHOW_HATIRLATMA: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Selam {{customer_name}}, bugünkü randevuna gelemedin 💭 Plan değiştiyse en az {{late_policy_hours}} saat önce haber verirsen yeni saat ayarlayabiliriz.",
      "Merhaba {{customer_name}}! Bugünkü randevunu kaçırdın 🌸 Yeni bir tarih için yanındayız.",
      "Hey {{customer_name}}, plan değişirse en az {{late_policy_hours}} saat önce haber ver — gelecekte bunu kaçırmayalım 🌸",
    ],
    reserve: [
      "Hey {{customer_name}}, bugün buluşamadık 🙏 İstersen yeni bir tarih bulalım.",
      "Hey {{customer_name}}, randevuya bekledik ama gelemedin 💭 Plan değişirse en az {{late_policy_hours}} saat önce yazarsan ihlal sayılmaz.",
      "Hey {{customer_name}}, bugün eksik kaldık 😊 Sana uygun bir saat bulalım mı?",
      "Hey {{customer_name}}, üzgünüz bugün buluşamadık 🙏 Yeni randevu için tarafımıza yazabilirsin.",
      "Merhaba {{customer_name}}! Bugünkü randevuna gelme şansın olmadı 💫 Sana yeni saat öneriyoruz.",
      "Hey {{customer_name}}, takvimde küçük bir eksiklik 😊 Randevuyu kaçırdın ama yeni bir tarih için buradayız.",
      "Hey {{customer_name}}, randevunda eksiklik oldu 💭 Yeniden bir tarih için yanındayız.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuza gelemediğinizi fark ettik 🌸 İsterseniz yeni bir tarih ayarlayalım.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü {{service_name}} randevunuza katılım olmadı 💭 Plan değişikliği için en az {{late_policy_hours}} saat önceden bildirim rica ederiz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuzdan haberinizin olmaması bizi üzdü 🌟 İlerisi için {{late_policy_hours}} saat öncesinden bilgi vermenizi rica ederiz.",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, bugün buluşamadık 🙏 Yeni bir randevu için yardımcı olabiliriz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuz kaçırılmış görünüyor ✨ Yeni bir tarih için bizimle iletişime geçebilirsiniz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, takvimimize göre bugünkü randevunuza gelmediniz 🙇 Yeni planlama için iletişime geçebilirsiniz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuz tamamlanmadı 💭 Plan değişikliği için {{late_policy_hours}} saat öncesinden bilgi vermenizi öneririz.",
      "Selamlar {{customer_name}} {{customer_honorific}}, bugün eksik kaldık 🙏 Sizin için yeni bir tarih ayarlayabiliriz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevunuza katılım olmaması bizi üzdü 🌸 Bir sonraki seans için kapımız açık.",
      "Merhaba {{customer_name}} {{customer_honorific}}, randevu durumunuz güncellendi 📋 Yeni randevu planlaması için bekliyoruz.",
    ],
  },
  // PROFESSIONAL rewritten: removed "Yeni randevu için tarafımıza
  // ulaşabilirsiniz" call-to-action sentences (Meta reads these as
  // promotional), centered every line on the existing appointment record
  // and the cancellation policy.
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} {{service_name}} randevunuza katılım kaydı oluşmamıştır. İptal/değişiklik bildirimleri en az {{late_policy_hours}} saat öncesinden yapılmalıdır.",
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli {{service_name}} randevunuza gelinmedi statüsü işlenmiştir. Bildirim politikamız: {{late_policy_hours}} saat.",
      // Eski hali çok kısa, değişken/kelime oranı yüksek (WORDS_RATIO red).
      // Açıklayıcı bağlam kelimeleri eklendi.
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} randevu kaydınız için katılım olmadığı tespit edilmiş ve randevu durumu gelinmedi olarak güncellenmiştir.",
    ],
    reserve: [
      // Eski hali 6 değişkene karşılık az kelime içeriyordu (WORDS_RATIO).
      // Anlatım genişletildi, late_policy_hours bağlamı korundu.
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli randevu kaydınız için katılım gerçekleşmemiş ve süreç kapatılmıştır. Bildirim politikamız {{late_policy_hours}} saat olarak uygulanmaktadır.",
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} randevu kaydınız no-show statüsü ile kapatılmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuza ait katılım kaydı tamamlanmamıştır. İptal/değişiklik süresi {{late_policy_hours}} saattir.",
      "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} randevu kaydı katılım olmadığı için güncellenmiştir.",
      "Sayın {{customer_name}} {{customer_surname}}, no-show politikamız kapsamında {{appointment_date}} kaydınız işlenmiştir.",
      "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz katılım gerçekleşmediği için tamamlanmamıştır. Hatırlatma: {{late_policy_hours}} saat bildirim süresi.",
      "Sayın {{customer_name}} {{customer_surname}}, randevu sürecinizde {{appointment_date}} için gelinmedi kaydı oluşmuştur.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kdy_waitlist_teklif — UTILITY waitlist offer
// ─────────────────────────────────────────────────────────────────
// Rewritten to read as transactional notification (not promotional offer).
// Key changes vs the original: removed "teklif/fırsat/müjde" vocabulary,
// added concrete date/time/service anchors in every primary variation,
// kept emojis sparse, and centered language on the customer's existing
// waitlist record rather than presenting it as a new offer.
// Bekleme listesi şablonları — Meta defalarca MARKETING'e bump'ladı veya
// reddetti. Onaylananları (f3, f5) inceleyerek çıkardığım pattern:
//   1. "uygun hale geldi" yerine "ayrıldı / açıldı" (pasif, bildirimsel)
//   2. "Onaylarsan çevirelim" gibi CTA'lar YOK
//   3. Loss-aversion sürer ("yanıt vermezsen sıra geçer")
//   4. Variable'lar asla cümle başında veya sonunda — çevresinde mutlaka kelimeler
//   5. Yeterli kelime hacmi — değişken/kelime oranı %35-40 altında
const KEDY_WAITLIST_TEKLIF: TieredVariations = {
  FRIENDLY: {
    primary: [
      // Eski: "uygun hale geldi. Onaylarsan randevuya çevirelim" — CTA → CAT_BUMP.
      // Yeni: pasif bildirim + loss-aversion (kardeş f3 deseni).
      "Merhaba {{customer_name}}, bekleme listendeki {{service_name}} kaydın için {{appointment_date}} {{appointment_time}} saati açıldı. Yanıt vermezsen sıra bir sonraki kişiye geçer.",
      // Eski: variable ile bitiyordu (LEADING_TRAILING).
      // Yeni: "ayrıldı" trailing kelimesiyle kapanış.
      "Selam {{customer_name}}, bekleme kaydındaki {{service_name}} için sıran geldi. {{appointment_date}} {{appointment_time}} saati senin için ayrıldı.",
      "Merhaba {{customer_name}}, bekleme kaydındaki {{appointment_date}} {{appointment_time}} saati artık müsait. Yanıt vermezsen sıra bir sonrakine geçecek.",
    ],
    reserve: [
      // Eski: "uygun hale geldi" → CAT_BUMP.
      // Yeni: "seni bekliyor" pasif bildirim.
      "Hey {{customer_name}}, daha önce ilettiğin {{service_name}} bekleme kaydında {{appointment_date}} {{appointment_time}} saati seni bekliyor.",
      "Merhaba {{customer_name}}, bekleme kaydın aktif. {{appointment_date}} {{appointment_time}} saati senin için ayrıldı.",
      // Eski: "için {{appointment_date}} {{appointment_time}} açıldı" — kelime az,
      // 4 vars 8 word (WORDS_RATIO). Genişletildi.
      "Hey {{customer_name}}, daha önce talep ettiğin {{service_name}} için bekleme listenden bir saat açıldı: {{appointment_date}} {{appointment_time}} senin için ayrıldı.",
      // Eski: variable ile bitiyordu (LEADING_TRAILING).
      "Merhaba {{customer_name}}, bekleme kaydın için {{appointment_date}} {{appointment_time}} saati planlamaya alındı, yanıtını bekliyoruz.",
      // Eski: "Saat: {{appointment_date}} {{appointment_time}}." — variable trailing
      // ve kısa cümle (WORDS_RATIO). Yeni: bağlam genişletildi.
      "Selam {{customer_name}}, bekleme listendeki {{service_name}} kaydın hâlâ aktif. {{appointment_date}} {{appointment_time}} saati senin için ayrıldı, yanıtını bekliyoruz.",
      // Eski: variable ile bitiyordu (LEADING_TRAILING).
      "Hey {{customer_name}}, bekleme listendeki kayıt için {{appointment_date}} {{appointment_time}} saati açıldı, yanıtını bekliyoruz.",
      // Eski: "aktif edildi" sona ulaşmadan variable bitiyordu, kelime az
      // (WORDS_RATIO). Genişletildi.
      "Merhaba {{customer_name}}, bekleme listendeki {{service_name}} kaydın için {{appointment_date}} {{appointment_time}} saati aktif edildi, yanıtını bekliyoruz.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme listenizdeki {{service_name}} için {{appointment_date}} {{appointment_time}} saati uygun hale gelmiştir.",
      // Eski: variable ile bitiyordu (LEADING_TRAILING) ve kelime az (WORDS_RATIO).
      // Yeni: "tamamlanmıştır" ve "ayrılmıştır" trailing kelimelerle.
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme kaydınız için planlama tamamlanmıştır ve {{appointment_date}} {{appointment_time}} saati tarafınıza ayrılmıştır.",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} için bekleme listenizdeki sıranız {{appointment_date}} {{appointment_time}} saati ile uyumlandı.",
    ],
    reserve: [
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme kaydınızdaki {{service_name}} için {{appointment_date}} {{appointment_time}} planlamaya alınmıştır.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme listenizdeki sıranıza istinaden {{appointment_date}} {{appointment_time}} saati tarafınıza ayrılmıştır.",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} bekleme kaydınız için {{appointment_date}} {{appointment_time}} aktif edilmiştir.",
      "Selamlar {{customer_name}} {{customer_honorific}}, bekleme kaydınız için müsaitlik bilgisi: {{appointment_date}} {{appointment_time}}.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme listenizdeki {{service_name}} kaydı için {{appointment_date}} {{appointment_time}} uygundur.",
      "Merhaba {{customer_name}} {{customer_honorific}}, daha önce ilettiğiniz {{service_name}} bekleme talebiniz için {{appointment_date}} {{appointment_time}} planlanmıştır.",
      "Merhaba {{customer_name}} {{customer_honorific}}, bekleme kaydınız için {{appointment_date}} {{appointment_time}} saati onayınıza sunulmuştur.",
    ],
  },
  PROFESSIONAL: {
    primary: [
      "Sayın {{customer_name}} {{customer_surname}}, bekleme listesi kaydınızdaki {{service_name}} için {{appointment_date}} {{appointment_time}} saati uygun hale gelmiştir.",
      // Eski: 5 vars 7 word (WORDS_RATIO). Bağlam genişletildi.
      "Sayın {{customer_name}} {{customer_surname}}, daha önce ilettiğiniz {{service_name}} bekleme kaydınız için {{appointment_date}} {{appointment_time}} saati randevu planlamasına alınmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, bekleme listenizdeki sıranıza istinaden {{appointment_date}} {{appointment_time}} saati randevu kaydı olarak hazırlanmıştır.",
    ],
    reserve: [
      // Eski: 5 vars 10 word, ratio sınırda (WORDS_RATIO). Anlatım genişletildi.
      "Sayın {{customer_name}} {{customer_surname}}, daha önce iletmiş olduğunuz {{service_name}} bekleme talebinize istinaden {{appointment_date}} {{appointment_time}} saati randevu olarak planlamaya alınmıştır.",
      // Eski: variable ile bitiyordu (LEADING_TRAILING).
      "Sayın {{customer_name}} {{customer_surname}}, bekleme kaydınız için randevu zamanı {{appointment_date}} {{appointment_time}} olarak belirlenmiştir, onayınızı bekliyoruz.",
      // Eski: 5 vars 9 word (WORDS_RATIO). Bağlam genişletildi.
      "Sayın {{customer_name}} {{customer_surname}}, daha önce ilettiğiniz {{service_name}} bekleme talebi için randevu saati {{appointment_date}} {{appointment_time}} olarak aktif duruma getirilmiştir.",
      "Sayın {{customer_name}} {{customer_surname}}, bekleme listenizde kayıtlı talebiniz {{appointment_date}} {{appointment_time}} olarak planlanmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, bekleme kaydınızla ilişkili randevu {{appointment_date}} {{appointment_time}} saatine ayarlanmıştır.",
      "Sayın {{customer_name}} {{customer_surname}}, müşteri kaydınızdaki {{service_name}} talebi için randevu saati: {{appointment_date}} {{appointment_time}}.",
      "Sayın {{customer_name}} {{customer_surname}}, bekleme listenizden randevu planlamasına geçiş yapılmıştır. Saat: {{appointment_date}} {{appointment_time}}.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// kdy_memnuniyet_anketi — UTILITY satisfaction survey
// ─────────────────────────────────────────────────────────────────
const KEDY_MEMNUNIYET_ANKETI: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Merhaba {{customer_name}}, {{service_name}} randevun tamamlandı. Kısa bir geri bildirim formu hazırladık.",
      "Selam {{customer_name}}, son randevun için hizmet değerlendirme formu açıldı. İki kısa soru bekleniyor.",
      "Merhaba {{customer_name}}, {{service_name}} randevun sonrasında geri bildirim aşamasına geldik.",
    ],
    reserve: [
      "Merhaba {{customer_name}}, hizmet sonrası değerlendirme adımına geçildi. Görüşlerini iletebilirsin.",
      "Selam {{customer_name}}, {{service_name}} kaydın için değerlendirme formu hazır.",
      "Merhaba {{customer_name}}, hizmet kalitesi değerlendirme süreci başlatıldı.",
      "Hey {{customer_name}}, randevu sonrası değerlendirme formu butondan açılabilir.",
      "Merhaba {{customer_name}}, hizmet değerlendirme sürecine katılım için bağlantı iletildi.",
      "Selam {{customer_name}}, son hizmet kaydın için değerlendirme adımı aktif.",
      "Merhaba {{customer_name}}, geri bildirim formu randevu sonrası kayıtlara dahil edildi.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, aldığınız {{service_name}} hizmetini değerlendirmenizi rica ederiz ⭐",
      "Merhaba {{customer_name}} {{customer_honorific}}, kısa memnuniyet anketimize katılabilir misiniz? 🌟",
      "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} süreciniz hakkında görüş paylaşabilir misiniz? 🌟",
    ],
    reserve: [
      "Merhaba {{customer_name}} {{customer_honorific}}, hizmet kalitemizi artırmak için değerlendirmenize ihtiyaç duyuyoruz 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, yorumlarınız süreçlerimizi geliştirmemize katkı sağlar 💛",
      "Selamlar {{customer_name}} {{customer_honorific}}, deneyiminizi iki kısa soruyla puanlayabilirsiniz ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, hizmet sonu geri bildiriminiz bizim için kıymetli 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, kısa anketi tamamlamanız yeterli — 30 saniye sürmez ⏱️",
      "Selamlar {{customer_name}} {{customer_honorific}}, geri bildirimleriniz ekibimiz tarafından titizlikle incelenir 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, memnuniyet puanınızı iletmenizi rica ederiz 💫",
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
// kdy_google_maps_yorum — UTILITY 3rd-visit Google review request
// ─────────────────────────────────────────────────────────────────
const KEDY_GOOGLE_MAPS_YORUM: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Hey {{customer_name}}, 3. kez seni ağırladık 🥹 Google'da bir yorum bırakır mısın?",
      "Merhaba {{customer_name}}! Üç kez tercih ettiğin için teşekkürler 🙏 Google'da bir cümle yazar mısın?",
      "Hey {{customer_name}}! Üç ziyaretin için teşekkür ediyoruz 🌟 Google'da kısa bir yorum dilersen.",
    ],
    reserve: [
      "Selam {{customer_name}}! Düzenli misafirimizsin artık 💛 Google'da deneyimini paylaşmaya ne dersin?",
      "Hey {{customer_name}}! Üçüncü ziyaretinin şerefine 🥂 Google haritalar'da bir yorum çok kıymetli.",
      "Hey {{customer_name}}, başkalarına seni nasıl ağırladığımızı anlatır mısın? ✨ Google harita yorumu çok yardımcı olur.",
      "Hey {{customer_name}}, 3 randevudur seninle çalışmak güzel 🌟 Bir yorumun başkaları için yol gösterir.",
      "Hey {{customer_name}}, sadık misafirimiz 💫 Google'da 2 dakikalık bir yorum bizim için çok değerli.",
      "Selam {{customer_name}}! 3 randevu = sadık misafir 🎉 Google'da minik bir yorum?",
      "Hey {{customer_name}}, deneyimini paylaşmak ister misin? 🌸 Google haritalar yeni misafirler için rehber.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, {{salon_name}} olarak sizi üçüncü kez ağırlamaktan mutluyuz 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, düzenli müşterimiz olarak Google Maps yorumunuzu rica edebilir miyiz? ⭐",
      "Selamlar {{customer_name}} {{customer_honorific}}, deneyiminizi Google üzerinden paylaşmanız bizim için çok kıymetli 💛",
    ],
    reserve: [
      "Merhaba {{customer_name}} {{customer_honorific}}, üç randevu boyunca bizi tercih ettiğiniz için teşekkür ederiz 🙏",
      "Merhaba {{customer_name}} {{customer_honorific}}, kısa bir Google yorumunuz yeni müşterilerimize yol gösterir ✨",
      "Merhaba {{customer_name}} {{customer_honorific}}, Google Maps yorumlarınız işletmemizin görünürlüğüne katkı sağlar 🌟",
      "Merhaba {{customer_name}} {{customer_honorific}}, düzenli müşterimiz olarak görüşlerinizi paylaşmanızı rica ederiz 🌸",
      "Merhaba {{customer_name}} {{customer_honorific}}, Google Maps üzerinden bırakacağınız yorum bizim için değerli 💫",
      "Selamlar {{customer_name}} {{customer_honorific}}, üç randevudur sergilediğiniz güven için teşekkür ederiz 🤗",
      "Merhaba {{customer_name}} {{customer_honorific}}, deneyiminizi Google'da paylaşmanız işletmemiz için anlamlı 🙌",
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
// kdy_dogum_gunu_kutlamasi — MARKETING birthday
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
      "Hey {{customer_name}}, doğum günün kutlu olsun! 🎉 Hediye olarak {{discount_amount}} indirim seni bekliyor ({{validity_period}}).",
      "Merhaba {{customer_name}}! 🎂 Yeni yaşın hayırlı olsun, doğum günü indiriminiz: {{discount_amount}}, {{validity_period}} ✨",
      "Hey {{customer_name}}, iyi ki varsın 💛 Doğum günün için {{discount_amount}} indirim hediyemiz var ({{validity_period}})!",
      "Selam {{customer_name}} 🥳 Doğum günün kutlu olsun! Sana özel {{discount_amount}} indirim {{validity_period}} geçerli.",
      "Hey {{customer_name}}, doğum günün kutlu olsun 🎁 {{discount_amount}} hediyemizi {{validity_period}} içinde kullanabilirsin.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, size özel {{discount_amount}} indirim hediyemizi sunarız 🎉 ({{validity_period}} geçerli)",
      "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüz kutlu olsun ✨ {{discount_amount}} indirim hediyemiz {{validity_period}} içinde geçerlidir.",
      "Merhaba {{customer_name}} {{customer_honorific}}, salon ailesi olarak doğum gününüzü kutlar, {{discount_amount}} indirim hediyemizi {{validity_period}} ile sunarız 🎂",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, doğum günü hediyeniz hazır 🎂 {{discount_amount}} indirim, {{validity_period}} geçerli!",
      "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, {{discount_amount}} indirim fırsatımızı paylaşırız 🌟 {{validity_period}} »",
      "Mutlu yıllar {{customer_name}} {{customer_honorific}} 🎈 Size özel doğum günü indiriminiz: {{discount_amount}}, {{validity_period}} içinde geçerli.",
      "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüz kutlu olsun 🎈 Hediyemiz {{discount_amount}} indirim ({{validity_period}}).",
      "Selamlar {{customer_name}} {{customer_honorific}}, doğum günü mesajımızla birlikte {{discount_amount}} indirim sunarız 💛 {{validity_period}} »",
      "Merhaba {{customer_name}} {{customer_honorific}}, bu özel günde size özel {{discount_amount}} indirim hazırladık 🌟 {{validity_period}} »",
      "Merhaba {{customer_name}} {{customer_honorific}}, nice mutlu yıllara 🌸 Doğum günü hediyeniz: {{discount_amount}} indirim, {{validity_period}} geçerli.",
    ],
  },
  PROFESSIONAL: {
    primary: [
      // Eski hali variable ile bitiyordu ("Geçerlilik süresi: {{validity_period}}."),
      // Meta LEADING_TRAILING ile reddetti. Trailing kelime eklendi.
      "Sayın {{customer_name}} {{customer_surname}}, doğum gününüzü kutlar, tarafınıza özel {{discount_amount}} indirim fırsatımızı {{validity_period}} süreyle paylaşmaktan memnuniyet duyarız.",
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
// kdy_geri_donus — MARKETING winback
// ─────────────────────────────────────────────────────────────────
const KEDY_GERI_DONUS: TieredVariations = {
  FRIENDLY: {
    primary: [
      "Hey {{customer_name}}, uzun süredir görüşmedik 💭 Seni geri kazanmak için {{discount_amount}} indirim hediyemiz var, {{validity_period}} geçerli ✨",
      "Selam {{customer_name}} 🌸 Bir süredir uğramadın, sana özel {{discount_amount}} indirim ({{validity_period}})!",
      "Hey {{customer_name}}, geri dönüş hediyemiz hazır 💫 {{discount_amount}} indirim, {{validity_period}} geçerli!",
    ],
    reserve: [
      "Hey {{customer_name}}, salon olarak seni özlüyoruz 💛 {{discount_amount}} indirimle tekrar bir araya gelelim! {{validity_period}} geçerli.",
      "Merhaba {{customer_name}}! Sana özel {{discount_amount}} indirim hazır 🌟 {{validity_period}} içinde kullanabilirsin.",
      "Hey {{customer_name}}, seni özledik 💛 Sana özel {{discount_amount}} indirim hediyemiz {{validity_period}} içinde geçerli.",
      "Selam {{customer_name}}! 🌸 Tekrar görüşmek için sana {{discount_amount}} indirim hazırladık ({{validity_period}}).",
      "Hey {{customer_name}}, geri dönüş için müjde 🎁 {{discount_amount}} indirim, {{validity_period}} geçerli!",
      "Hey {{customer_name}}, bekleyemedik 😊 Sana özel {{discount_amount}} indirim, {{validity_period}} içinde kullan.",
      "Hey {{customer_name}}, salonumuzda eskisi gibi bir araya gelelim ✨ {{discount_amount}} indirim, {{validity_period}}.",
    ],
  },
  BALANCED: {
    primary: [
      "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşmedik 🌸 Size özel {{discount_amount}} indirim hediyemizi sunarız ({{validity_period}}).",
      "Merhaba {{customer_name}} {{customer_honorific}}, bir süredir görüşmedik 💭 Geri dönüş hediyemiz: {{discount_amount}} indirim, {{validity_period}} geçerli.",
      "Merhaba {{customer_name}} {{customer_honorific}}, eski güzel günleri yeniden yaşamak için sizi {{discount_amount}} indirimle bekleriz 💛 {{validity_period}} »",
    ],
    reserve: [
      "Selamlar {{customer_name}} {{customer_honorific}}, sizi tekrar ağırlamak isteriz 🌟 {{discount_amount}} indirim fırsatımız {{validity_period}} içinde geçerlidir.",
      "Merhaba {{customer_name}} {{customer_honorific}}, salon olarak sizi özledik ✨ {{discount_amount}} indirim ile tekrar buluşalım ({{validity_period}}).",
      "Merhaba {{customer_name}} {{customer_honorific}}, tekrar görüşmek için size {{discount_amount}} indirim sunuyoruz 💫 {{validity_period}} »",
      "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşemedik 🌸 {{discount_amount}} indirimle tekrar bir araya gelelim ({{validity_period}}).",
      "Selamlar {{customer_name}} {{customer_honorific}}, salon ailesi olarak sizi özledik 🌟 {{discount_amount}} indirim hediyemiz {{validity_period}} geçerli.",
      "Merhaba {{customer_name}} {{customer_honorific}}, geri dönüş için size özel {{discount_amount}} indirim hazırladık ✨ {{validity_period}} içinde kullanabilirsiniz.",
      "Merhaba {{customer_name}} {{customer_honorific}}, sizi tekrar ağırlamak için kapımız açık — üstelik {{discount_amount}} indirimle 🌸 {{validity_period}} »",
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
  kdy_randevu_hatirlatma_1_gun: KEDY_RANDEVU_HATIRLATMA_1_GUN,
  kdy_randevu_hatirlatma_3_gun: KEDY_RANDEVU_HATIRLATMA_3_GUN,
  kdy_randevu_hatirlatma_2_saat: KEDY_RANDEVU_HATIRLATMA_2_SAAT,
  kdy_no_show_hatirlatma: KEDY_NO_SHOW_HATIRLATMA,
  kdy_waitlist_teklif: KEDY_WAITLIST_TEKLIF,
  kdy_memnuniyet_anketi: KEDY_MEMNUNIYET_ANKETI,
  kdy_google_maps_yorum: KEDY_GOOGLE_MAPS_YORUM,
  kdy_dogum_gunu_kutlamasi: KEDY_DOGUM_GUNU_KUTLAMASI,
  kdy_geri_donus: KEDY_GERI_DONUS,
};

// Logical-key → category mapping for category-bump watchdog.
// kdy_dogum_gunu_kutlamasi & kdy_geri_donus go up as MARKETING; rest as UTILITY.
export const TEMPLATE_EXPECTED_CATEGORY: Record<string, 'UTILITY' | 'MARKETING'> = {
  kdy_randevu_hatirlatma_1_gun: 'UTILITY',
  kdy_randevu_hatirlatma_3_gun: 'UTILITY',
  kdy_randevu_hatirlatma_2_saat: 'UTILITY',
  kdy_no_show_hatirlatma: 'UTILITY',
  kdy_waitlist_teklif: 'UTILITY',
  kdy_memnuniyet_anketi: 'UTILITY',
  // Google review requests are fundamentally promotional from Meta's view —
  // every variation gets bumped to MARKETING. Accept it: requires
  // Customer.acceptMarketing to send.
  kdy_google_maps_yorum: 'MARKETING',
  kdy_dogum_gunu_kutlamasi: 'MARKETING',
  kdy_geri_donus: 'MARKETING',
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
 *   buildTemplateName('kdy_randevu_onay', 'FRIENDLY', 1) → 'kdy_randevu_onay_f1'
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
