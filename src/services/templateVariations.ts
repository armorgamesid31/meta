// WhatsApp template variation registry — tier-aware.
//
// For each customer-facing master template (kedy_randevu_onay etc.) we keep
// 30 variations split into 3 tiers:
//   FRIENDLY     — 1st-name only, emoji, casual                 (10)
//   BALANCED     — name + Bey/Hanım, emoji                       (10)
//   PROFESSIONAL — Sayın name surname, no emoji                  (10)
//
// At sync time the chakra route reads salon.communicationTone, picks a
// random variation from THAT tier, and submits it to the salon's WABA.
// If Meta rejects, rotation stays within the same tier.
//
// Source of truth: whatsapp_template_taslaklari/*.txt drafts.

import { SalonCommunicationTone } from '@prisma/client';

export type ToneTier = 'FRIENDLY' | 'BALANCED' | 'PROFESSIONAL';

export interface TieredVariations {
  FRIENDLY: string[];
  BALANCED: string[];
  PROFESSIONAL: string[];
}

// ─────────────────────────────────────────────────────────────────
// kedy_randevu_onay — appointment confirmation
// vars: {{customer_name}}, {{customer_surname}}, {{customer_honorific}},
//       {{appointment_date}}, {{appointment_time}}, {{service_name}},
//       {{location_url}}
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_ONAY: TieredVariations = {
  FRIENDLY: [
    "Merhaba {{customer_name}}! {{appointment_date}} {{appointment_time}} için {{service_name}} randevun hazır ✨ Konum: {{location_url}}",
    "Harika {{customer_name}}! 🎉 {{appointment_date}} saat {{appointment_time}} randevun onaylandı. Yol tarifi: {{location_url}}",
    "Selam {{customer_name}}! {{service_name}} randevun kesinleşti 🗓️ {{appointment_date}} {{appointment_time}} — {{location_url}}",
    "{{customer_name}}, süper haber 🌟 {{appointment_date}} {{appointment_time}} için seni bekliyoruz. Konum: {{location_url}}",
    "Randevun tamam {{customer_name}}! 💫 {{service_name}} için {{appointment_date}} {{appointment_time}} görüşüyoruz. {{location_url}}",
    "{{customer_name}}, randevun onaylandı 🎉 {{appointment_date}} {{appointment_time}} için hazırız. Konum: {{location_url}}",
    "Hey {{customer_name}}! 🌸 {{service_name}} randevun {{appointment_date}} {{appointment_time}} olarak kayıtta. {{location_url}}",
    "Her şey hazır {{customer_name}}! ✨ {{appointment_date}} {{appointment_time}} randevunda seni bekliyoruz. {{location_url}}",
    "Kayıt tamam {{customer_name}} 🙌 {{service_name}} | {{appointment_date}} {{appointment_time}}. Harita: {{location_url}}",
    "{{customer_name}}, randevu onayını iletiyoruz 💛 {{appointment_date}} {{appointment_time}} için görüşürüz. {{location_url}}",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} tarihli {{service_name}} randevunuz onaylandı 🙌 Konum: {{location_url}}",
    "{{customer_name}} {{customer_honorific}}, {{service_name}} randevunuz {{appointment_date}} {{appointment_time}} için oluşturuldu ✨ Yol tarifi: {{location_url}}",
    "Selamlar {{customer_name}} {{customer_honorific}}, randevunuz {{appointment_date}} {{appointment_time}} olarak planlandı 🌟 {{location_url}}",
    "{{customer_name}} {{customer_honorific}}, {{appointment_date}} saat {{appointment_time}} rezervasyonunuz başarıyla tamamlandı 🌸 {{location_url}}",
    "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} hizmetiniz {{appointment_date}} {{appointment_time}} tarihinde 💫 {{location_url}}",
    "{{customer_name}} {{customer_honorific}}, randevu kaydınız alındı 🙌 Tarih-saat: {{appointment_date}} {{appointment_time}}. Konum: {{location_url}}",
    "Merhaba {{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} randevunuz aktif ✨ {{location_url}}",
    "{{customer_name}} {{customer_honorific}}, planladığımız randevu detayları: {{service_name}} / {{appointment_date}} {{appointment_time}} 🌟 {{location_url}}",
    "Selamlar {{customer_name}} {{customer_honorific}}, rezervasyonunuz kesinleşti 🌸 Görüşme zamanı: {{appointment_date}} {{appointment_time}}. {{location_url}}",
    "{{customer_name}} {{customer_honorific}}, randevu durumunuz onaylı 💛 Konum: {{location_url}}",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} tarihli {{service_name}} randevunuz onaylanmıştır. Konum bağlantısı: {{location_url}}",
    "Sayın {{customer_name}} {{customer_surname}}, rezervasyon işleminiz tamamlanmıştır. Randevu: {{appointment_date}} {{appointment_time}}. {{location_url}}",
    "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz sistemimizde onaylıdır. Detay: {{location_url}}",
    "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız başarıyla oluşturulmuştur. Tarih-saat: {{appointment_date}} {{appointment_time}}.",
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} için randevu planlamanız tamamlanmıştır. Konum: {{location_url}}",
    "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz aktif durumdadır. {{location_url}}",
    "Sayın {{customer_name}} {{customer_surname}}, hizmet randevunuz aşağıdaki tarihte gerçekleştirilecektir: {{appointment_date}} {{appointment_time}}.",
    "Sayın {{customer_name}} {{customer_surname}}, rezervasyon teyidiniz alınmıştır. Ulaşım için harita: {{location_url}}",
    "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız onaylanmıştır. Saat: {{appointment_time}}, Tarih: {{appointment_date}}.",
    "Sayın {{customer_name}} {{customer_surname}}, randevu süreciniz başarıyla tamamlanmış olup detaylar bu mesajda paylaşılmıştır.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// kedy_randevu_hatirlatma — 1 day reminder
// vars: {{customer_name}}, {{customer_surname}}, {{customer_honorific}},
//       {{appointment_date}}, {{appointment_time}}, {{service_name}}
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_HATIRLATMA: TieredVariations = {
  FRIENDLY: [
    "{{customer_name}}, yarın görüşüyoruz 🎉 {{appointment_time}} için kısa bir onay bırakır mısın?",
    "Selam {{customer_name}}! Yarın {{service_name}} günü 💅 Katılımını bir tıkla seçebilirsin.",
    "{{customer_name}}, yarınki randevunu unutma diye geldim 😄 Saat {{appointment_time}}. Onaylayalım mı?",
    "Hey {{customer_name}}! Yarın takvimde biz varız ✨ Geliyorum / gelemiyorum'dan birini seç.",
    "{{customer_name}}, yarın {{appointment_time}} için seni bekliyoruz. Mini onayın yeterli 🙌",
    "Merhaba {{customer_name}}! {{appointment_date}} için randevun aktif 🌸 Katılım durumunu paylaşır mısın?",
    "{{customer_name}}, yarın {{service_name}} için hazırız ✨ Uygunsan \"Katılıyorum\" de.",
    "Küçük hatırlatma {{customer_name}} 💫 Yarın buluşmamız var. Tek dokunuşla bildir.",
    "{{customer_name}}, yarınki planımızı netleştirelim mi? 🌟 Saat {{appointment_time}} için onay bekliyoruz.",
    "{{customer_name}}, seni yarın görmek istiyoruz 🌟 Müsaitsen katılımını işaretle lütfen.",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} randevunuz için kısa bir teyit alabilir miyiz? 🙌",
    "{{customer_name}} {{customer_honorific}}, yarın {{service_name}} için sizi bekliyoruz ✨ Katılım durumunuzu paylaşır mısınız?",
    "Selamlar {{customer_name}} {{customer_honorific}}, yarınki randevunuzu netleştirelim mi? 🌸",
    "{{customer_name}} {{customer_honorific}}, planlamayı netleştirmek için katılım bilginizi rica ediyoruz 🙏",
    "Merhaba {{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} için randevunuz aktif — geliyor musunuz? 💫",
    "{{customer_name}} {{customer_honorific}}, yarınki {{service_name}} randevunuz için kısa bir onay alabilir miyiz? 🌟",
    "Selamlar {{customer_name}} {{customer_honorific}}, randevunuz yaklaşırken küçük bir hatırlatma 🤗",
    "{{customer_name}} {{customer_honorific}}, yarınki katılımınızı butonlardan tek dokunuşla bildirebilirsiniz ✨",
    "Merhaba {{customer_name}} {{customer_honorific}}, randevu durumunuzu bildirmeniz planlamamıza yardımcı olur 🙏",
    "{{customer_name}} {{customer_honorific}}, yarın {{appointment_time}} için sizi bekliyoruz — bir teyit bırakır mısınız? 🌸",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, yarın {{appointment_time}} randevunuz bulunmaktadır. Katılım durumunuzu iletebilir misiniz?",
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli randevunuz için onayınızı rica ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, yarınki randevunuz için katılım bilginizi paylaşabilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevunuz yarın planlanmıştır. Lütfen uygun seçeneği işaretleyiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, nazik hatırlatma: Yarın {{appointment_time}} için rezervasyonunuz aktiftir.",
    "Sayın {{customer_name}} {{customer_surname}}, planlamamızı netleştirmek için katılım durumunuzu bildirmenizi rica ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, randevunuz yaklaşmaktadır. Onay veya iptal seçiminizi bekliyoruz.",
    "Sayın {{customer_name}} {{customer_surname}}, yarınki randevunuz için kısa bir teyit alabilir miyiz?",
    "Sayın {{customer_name}} {{customer_surname}}, hizmet planlamamız için katılım bilginiz önem taşımaktadır.",
    "Sayın {{customer_name}} {{customer_surname}}, yarınki randevunuza ilişkin teyit mesajıdır.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// kedy_no_show_hatirlatma — sent when an appointment is marked NO_SHOW.
// The {{late_policy_hours}} variable is sourced from the salon's unified
// lateChangeHours setting (Customer Risk Policy → Geç bildirim eşiği).
// vars: {{customer_name}}, {{customer_surname}}, {{customer_honorific}},
//       {{appointment_date}}, {{appointment_time}}, {{service_name}},
//       {{late_policy_hours}}
// ─────────────────────────────────────────────────────────────────
const KEDY_NO_SHOW_HATIRLATMA: TieredVariations = {
  FRIENDLY: [
    "Selam {{customer_name}}, bugünkü randevuna gelemedin 💭 Plan değiştiyse en az {{late_policy_hours}} saat önce haber verirsen yeni saat ayarlayabiliriz.",
    "{{customer_name}}, bugün buluşamadık 🙏 İstersen yeni bir tarih bulalım.",
    "Merhaba {{customer_name}}! Bugünkü randevunu kaçırdın 🌸 Yeni bir tarih için yanındayız.",
    "Hey {{customer_name}}, randevuya bekledik ama gelemedin 💭 Plan değişirse en az {{late_policy_hours}} saat önce yazarsan ihlal sayılmaz.",
    "{{customer_name}}, bugün eksik kaldık 😊 Sana uygun bir saat bulalım mı?",
    "{{customer_name}}, üzgünüz bugün buluşamadık 🙏 Yeni randevu için tarafımıza yazabilirsin.",
    "Merhaba {{customer_name}}! Bugünkü randevuna gelme şansın olmadı 💫 Sana yeni saat öneriyoruz.",
    "{{customer_name}}, takvimde küçük bir eksiklik 😊 Randevuyu kaçırdın ama yeni bir tarih için buradayız.",
    "Hey {{customer_name}}, plan değişirse en az {{late_policy_hours}} saat önce haber ver — gelecekte bunu kaçırmayalım 🌸",
    "{{customer_name}}, randevunda eksiklik oldu 💭 Yeniden bir tarih için yanındayız.",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, bugünkü randevunuza gelemediğinizi fark ettik 🌸 İsterseniz yeni bir tarih ayarlayalım.",
    "{{customer_name}} {{customer_honorific}}, bugünkü {{service_name}} randevunuza katılım olmadı 💭 Plan değişikliği için en az {{late_policy_hours}} saat önceden bildirim rica ederiz.",
    "Selamlar {{customer_name}} {{customer_honorific}}, bugün buluşamadık 🙏 Yeni bir randevu için yardımcı olabiliriz.",
    "Merhaba {{customer_name}} {{customer_honorific}}, randevunuzdan haberinizin olmaması bizi üzdü 🌟 İlerisi için {{late_policy_hours}} saat öncesinden bilgi vermenizi rica ederiz.",
    "{{customer_name}} {{customer_honorific}}, bugünkü randevunuz kaçırılmış görünüyor ✨ Yeni bir tarih için bizimle iletişime geçebilirsiniz.",
    "Merhaba {{customer_name}} {{customer_honorific}}, takvimimize göre bugünkü randevunuza gelmediniz 🙇 Yeni planlama için iletişime geçebilirsiniz.",
    "{{customer_name}} {{customer_honorific}}, bugünkü randevunuz tamamlanmadı 💭 Plan değişikliği için {{late_policy_hours}} saat öncesinden bilgi vermenizi öneririz.",
    "Selamlar {{customer_name}} {{customer_honorific}}, bugün eksik kaldık 🙏 Sizin için yeni bir tarih ayarlayabiliriz.",
    "{{customer_name}} {{customer_honorific}}, randevunuza katılım olmaması bizi üzdü 🌸 Bir sonraki seans için kapımız açık.",
    "Merhaba {{customer_name}} {{customer_honorific}}, randevu durumunuz güncellendi 📋 Yeni randevu planlaması için bekliyoruz.",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} randevunuza katılım gerçekleşmemiştir. Sonraki randevularınız için iptal/değişiklik taleplerinin en az {{late_policy_hours}} saat öncesinden iletilmesini rica ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, bugünkü {{service_name}} randevunuza ilişkin katılım kaydı bulunmamaktadır. Yeni randevu için tarafımıza ulaşabilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız \"gelinmedi\" olarak işlenmiştir. Politikamız gereği iptal ve değişiklikler en az {{late_policy_hours}} saat öncesinden bildirilmelidir.",
    "Sayın {{customer_name}} {{customer_surname}}, randevunuza katılım sağlanmaması nedeniyle kaydınız güncellenmiştir. Yeni planlama için bizimle iletişime geçebilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli randevunuza katılım gerçekleşmemiştir. Hatırlatma: İptal ve değişiklik talepleri için süre {{late_policy_hours}} saattir.",
    "Sayın {{customer_name}} {{customer_surname}}, bugünkü randevunuzla ilgili katılım kaydı oluşmamıştır. Detaylar için iletişim sağlayabilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, randevu sürecinizde gelinmedi statüsü oluşmuştur. Yeni planlama için bizimle iletişime geçebilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, randevunuz no-show kaydı ile sonuçlanmıştır. {{late_policy_hours}} saat öncesinden bildirim politikamızı hatırlatmak isteriz.",
    "Sayın {{customer_name}} {{customer_surname}}, bugünkü randevunuza katılım olmamıştır. Sonraki randevularınızda iptal/değişiklik için süre {{late_policy_hours}} saattir.",
    "Sayın {{customer_name}} {{customer_surname}}, randevu süreciniz katılım olmadığı için güncellenmiştir. Yeni planlama yapmak isterseniz tarafımıza ulaşabilirsiniz.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// kedy_waitlist_teklif
// ─────────────────────────────────────────────────────────────────
const KEDY_WAITLIST_TEKLIF: TieredVariations = {
  FRIENDLY: [
    "{{customer_name}}, müjde 🎉 {{appointment_date}} {{appointment_time}} için bir yer açıldı!",
    "Selam {{customer_name}}! Bekleme listesindeki {{service_name}} için sıra sana geldi ✨",
    "{{customer_name}}, sürpriz var 🍀 {{appointment_date}} {{appointment_time}} aralığında müsait bir slot oluştu.",
    "Hey {{customer_name}}! Beklediğin teklif kapına geldi 🌟 {{appointment_time}} için yer ayıralım mı?",
    "{{customer_name}}, bir iptal oldu ve sana uygun bir slot çıktı 🙌 Hemen değerlendir.",
    "Merhaba {{customer_name}}! {{service_name}} için müsaitlik açıldı 💫 Onaylarsan rezerve edelim.",
    "{{customer_name}}, sıradaki teklif sende ⏰ {{appointment_date}} {{appointment_time}} — istersen senin olsun.",
    "Selam {{customer_name}}! Bekleme listesi sırası sende 🌸 Onayını bekliyoruz.",
    "Hızlı not {{customer_name}}: {{service_name}} için yerimiz var 😊 Senin tercihin?",
    "{{customer_name}}, fırsat kapıda 🚪 {{appointment_time}} slotunu senin için ayıralım mı?",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, bekleme listesi talebiniz için uygun slot oluştu 🙌",
    "{{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} için müsaitlik mevcut ✨",
    "Selamlar {{customer_name}} {{customer_honorific}}, {{service_name}} için teklif hakkınız açıldı 🌟",
    "{{customer_name}} {{customer_honorific}}, sıradaki uygunluk tarafınıza tahsis edildi 🌸",
    "Merhaba {{customer_name}} {{customer_honorific}}, teklifi onaylamanız halinde randevu kaydınız oluşturulacak 💫",
    "{{customer_name}} {{customer_honorific}}, bekleme listesi durumunuz güncellendi — size öncelik tanımlandı 🙌",
    "Merhaba {{customer_name}} {{customer_honorific}}, uygunluk bildirimi: {{appointment_date}} {{appointment_time}} ⏰",
    "{{customer_name}} {{customer_honorific}}, talep ettiğiniz {{service_name}} için boşluk oluştu 🌟",
    "Selamlar {{customer_name}} {{customer_honorific}}, teklif süresi dolmadan yanıt vermenizi rica ederiz 🙏",
    "{{customer_name}} {{customer_honorific}}, slotu değerlendirmek isterseniz butondan onaylayabilirsiniz ✨",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, bekleme listesi kapsamında tarafınıza özel uygun randevu slotu açılmıştır.",
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} aralığında kapasite oluşmuştur.",
    "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} talebiniz için teklif hakkınız aktif durumdadır.",
    "Sayın {{customer_name}} {{customer_surname}}, yanıtınız doğrultusunda rezervasyon işlemi tamamlanacaktır.",
    "Sayın {{customer_name}} {{customer_surname}}, bekleme listesi sıralamanız çerçevesinde öncelik tanımlanmıştır.",
    "Sayın {{customer_name}} {{customer_surname}}, teklif geçerlilik süresi içinde dönüş yapmanızı rica ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, müsait slot bilgisi sistemimiz tarafından tarafınıza iletilmiştir.",
    "Sayın {{customer_name}} {{customer_surname}}, teklif onayı alınmadığı durumda slot bir sonraki müşteriye devredilecektir.",
    "Sayın {{customer_name}} {{customer_surname}}, uygunluk durumunuzu onaylamak için butonu kullanabilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, anlayışınız ve takip etmeniz için teşekkür ederiz.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// kedy_memnuniyet_anketi (standart feedback)
// ─────────────────────────────────────────────────────────────────
const KEDY_MEMNUNIYET_ANKETI: TieredVariations = {
  FRIENDLY: [
    "Merhaba {{customer_name}}! {{service_name}} deneyimin nasıldı? ⭐ 30 saniyede değerlendir.",
    "{{customer_name}}, bugün seni ağırlamak çok güzeldi 💛 Kısa bir puan bırakır mısın?",
    "Selam {{customer_name}}! Görüşüne ihtiyacımız var 🌟 İki sorulu mini değerlendirme.",
    "{{customer_name}}, son randevun nasıldı? 🌸 Tek dokunuşla puanlayabilirsin.",
    "Bize puan ver {{customer_name}} ⭐ Yorumun ekibimize yol gösteriyor.",
    "{{customer_name}}, memnuniyetini ölçmek için iki soru ✨ Cevapların 1 dakikadan az sürer.",
    "Hey {{customer_name}}! {{service_name}} sonrası geri bildirimini bekliyoruz 💫",
    "{{customer_name}}, daha iyi olmak için yorumuna ihtiyacımız var 🙏",
    "Mini değerlendirme {{customer_name}}? 🌟 Linke dokunup yıldızlarını ver.",
    "Teşekkürler {{customer_name}}! 💛 Deneyiminizi paylaşır mısınız?",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, aldığınız {{service_name}} hizmetini değerlendirmenizi rica ederiz ⭐",
    "{{customer_name}} {{customer_honorific}}, kısa memnuniyet anketimize katılabilir misiniz? 🌟",
    "Merhaba {{customer_name}} {{customer_honorific}}, hizmet kalitemizi artırmak için değerlendirmenize ihtiyaç duyuyoruz 🙏",
    "{{customer_name}} {{customer_honorific}}, yorumlarınız süreçlerimizi geliştirmemize katkı sağlar 💛",
    "Selamlar {{customer_name}} {{customer_honorific}}, deneyiminizi iki kısa soruyla puanlayabilirsiniz ✨",
    "{{customer_name}} {{customer_honorific}}, hizmet sonu geri bildiriminiz bizim için kıymetli 🌸",
    "Merhaba {{customer_name}} {{customer_honorific}}, {{service_name}} süreciniz hakkında görüş paylaşabilir misiniz? 🌟",
    "{{customer_name}} {{customer_honorific}}, kısa anketi tamamlamanız yeterli — 30 saniye sürmez ⏱️",
    "Selamlar {{customer_name}} {{customer_honorific}}, geri bildirimleriniz ekibimiz tarafından titizlikle incelenir 🙏",
    "{{customer_name}} {{customer_honorific}}, memnuniyet puanınızı iletmenizi rica ederiz 💫",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, hizmet kalitesi değerlendirme sürecine katkınızı rica ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} sonrası memnuniyet geri bildiriminizi bekliyoruz.",
    "Sayın {{customer_name}} {{customer_surname}}, geri bildiriminiz kalite standartlarımızın iyileştirilmesinde kullanılacaktır.",
    "Sayın {{customer_name}} {{customer_surname}}, kısa değerlendirme formunu tamamlamanızı rica ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, müşteri deneyim puanlaması iyileştirme süreçlerimiz için önem taşımaktadır.",
    "Sayın {{customer_name}} {{customer_surname}}, görüşleriniz hizmet denetim süreçlerimize dahil edilmektedir.",
    "Sayın {{customer_name}} {{customer_surname}}, tarafınıza iletilen bağlantı üzerinden puanlama yapabilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, memnuniyet süreci kapsamında değerlendirme paylaşmanızı bekliyoruz.",
    "Sayın {{customer_name}} {{customer_surname}}, zaman ayırdığınız için teşekkür ederiz.",
    "Sayın {{customer_name}} {{customer_surname}}, geri bildiriminiz sistem kayıtlarına işlenecektir.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// kedy_dogum_gunu_kutlamasi — birthday MARKETING template
// ⚠️ MARKETING category (not UTILITY) — needs Customer.acceptMarketing.
// vars: {{customer_name}}, {{customer_surname}}, {{customer_honorific}},
//       {{discount_amount}} (Salon.birthdayDiscountText),
//       {{validity_period}} (Salon.birthdayValidityText)
// ─────────────────────────────────────────────────────────────────
const KEDY_DOGUM_GUNU_KUTLAMASI: TieredVariations = {
  FRIENDLY: [
    "İyi ki doğdun {{customer_name}}! 🎂 Sana özel doğum günü hediyemiz: {{discount_amount}} indirim, {{validity_period}} geçerli ✨",
    "Doğum günün kutlu olsun {{customer_name}} 🎉 {{discount_amount}} indirim hediyemiz hazır, {{validity_period}} içinde kullanın!",
    "Selam {{customer_name}}! 🎂 Doğum günün kutlu olsun, {{discount_amount}} indirim hediyemiz {{validity_period}} geçerli 🎁",
    "Hey {{customer_name}}! 🎈 Doğum günün kutlu olsun! Sana özel {{discount_amount}} indirim, {{validity_period}} senin için ayrıldı.",
    "Mutlu yıllar {{customer_name}} 🌸 Doğum günü hediyemiz: {{discount_amount}} indirim ({{validity_period}} geçerli)!",
    "{{customer_name}}, doğum günün kutlu olsun! 🎉 Hediye olarak {{discount_amount}} indirim seni bekliyor ({{validity_period}}).",
    "Merhaba {{customer_name}}! 🎂 Yeni yaşın hayırlı olsun, doğum günü indiriminiz: {{discount_amount}}, {{validity_period}} ✨",
    "{{customer_name}}, iyi ki varsın 💛 Doğum günün için {{discount_amount}} indirim hediyemiz var ({{validity_period}})!",
    "Selam {{customer_name}} 🥳 Doğum günün kutlu olsun! Sana özel {{discount_amount}} indirim {{validity_period}} geçerli.",
    "{{customer_name}}, doğum günün kutlu olsun 🎁 {{discount_amount}} hediyemizi {{validity_period}} içinde kullanabilirsin.",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, size özel {{discount_amount}} indirim hediyemizi sunarız 🎉 ({{validity_period}} geçerli)",
    "{{customer_name}} {{customer_honorific}}, doğum gününüz kutlu olsun ✨ {{discount_amount}} indirim hediyemiz {{validity_period}} içinde geçerlidir.",
    "Selamlar {{customer_name}} {{customer_honorific}}, doğum günü hediyeniz hazır 🎂 {{discount_amount}} indirim, {{validity_period}} geçerli!",
    "Merhaba {{customer_name}} {{customer_honorific}}, doğum gününüzü kutlar, {{discount_amount}} indirim fırsatımızı paylaşırız 🌟 {{validity_period}}",
    "Mutlu yıllar {{customer_name}} {{customer_honorific}} 🎈 Size özel doğum günü indiriminiz: {{discount_amount}}, {{validity_period}} içinde geçerli.",
    "{{customer_name}} {{customer_honorific}}, doğum gününüz kutlu olsun 🎈 Hediyemiz {{discount_amount}} indirim ({{validity_period}}).",
    "Selamlar {{customer_name}} {{customer_honorific}}, doğum günü mesajımızla birlikte {{discount_amount}} indirim sunarız 💛 {{validity_period}}",
    "Merhaba {{customer_name}} {{customer_honorific}}, bu özel günde size özel {{discount_amount}} indirim hazırladık 🌟 {{validity_period}}",
    "{{customer_name}} {{customer_honorific}}, salon ailesi olarak doğum gününüzü kutlar, {{discount_amount}} indirim hediyemizi {{validity_period}} ile sunarız 🎂",
    "{{customer_name}} {{customer_honorific}}, nice mutlu yıllara 🌸 Doğum günü hediyeniz: {{discount_amount}} indirim, {{validity_period}} geçerli.",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, doğum gününüzü kutlar, tarafınıza özel {{discount_amount}} indirim fırsatımızı sunarız. Geçerlilik süresi: {{validity_period}}.",
    "Sayın {{customer_name}} {{customer_surname}}, doğum günü mesajımızı sunmaktan mutluluk duyarız. {{discount_amount}} indirim, {{validity_period}} içinde geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, bu özel gününüzü kutlar, {{discount_amount}} doğum günü hediyemizi sunarız. {{validity_period}} süreyle geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, doğum gününüz kutlu olsun. Size özel {{discount_amount}} indirim {{validity_period}} içinde geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, mutlu yıllar dileklerimizle birlikte {{discount_amount}} doğum günü indirimimiz {{validity_period}} süreyle tarafınıza sunulmuştur.",
    "Sayın {{customer_name}} {{customer_surname}}, doğum gününüzü kutlar, {{discount_amount}} indirim fırsatımızı paylaşırız. {{validity_period}} süreyle geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, bu anlamlı gününüzde tarafınıza özel {{discount_amount}} indirim sunmaktan mutluluk duyarız. Geçerlilik: {{validity_period}}.",
    "Sayın {{customer_name}} {{customer_surname}}, doğum gününüz vesilesiyle {{discount_amount}} indirim hakkınız {{validity_period}} içinde geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, yeni yaşınızın hayırlı olmasını diler, {{discount_amount}} doğum günü indirimimizi sunarız. {{validity_period}}.",
    "Sayın {{customer_name}} {{customer_surname}}, doğum günü dileklerimizi {{discount_amount}} indirim hediyemizle birlikte iletmek isteriz. {{validity_period}} geçerli.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// kedy_geri_donus — winback MARKETING template
// ⚠️ MARKETING category — needs Customer.acceptMarketing.
// vars: {{customer_name}}, {{customer_surname}}, {{customer_honorific}},
//       {{discount_amount}} (Salon.winbackDiscountText),
//       {{validity_period}} (Salon.winbackValidityText)
// ─────────────────────────────────────────────────────────────────
const KEDY_GERI_DONUS: TieredVariations = {
  FRIENDLY: [
    "{{customer_name}}, uzun süredir görüşmedik 💭 Seni geri kazanmak için {{discount_amount}} indirim hediyemiz var, {{validity_period}} geçerli ✨",
    "Selam {{customer_name}} 🌸 Bir süredir uğramadın, sana özel {{discount_amount}} indirim ({{validity_period}})!",
    "Hey {{customer_name}}, salon olarak seni özlüyoruz 💛 {{discount_amount}} indirimle tekrar bir araya gelelim! {{validity_period}} geçerli.",
    "Merhaba {{customer_name}}! Sana özel {{discount_amount}} indirim hazır 🌟 {{validity_period}} içinde kullanabilirsin.",
    "{{customer_name}}, geri dönüş hediyemiz hazır 💫 {{discount_amount}} indirim, {{validity_period}} geçerli!",
    "{{customer_name}}, seni özledik 💛 Sana özel {{discount_amount}} indirim hediyemiz {{validity_period}} içinde geçerli.",
    "Selam {{customer_name}}! 🌸 Tekrar görüşmek için sana {{discount_amount}} indirim hazırladık ({{validity_period}}).",
    "{{customer_name}}, geri dönüş için müjde 🎁 {{discount_amount}} indirim, {{validity_period}} geçerli!",
    "Hey {{customer_name}}, bekleyemedik 😊 Sana özel {{discount_amount}} indirim, {{validity_period}} içinde kullan.",
    "{{customer_name}}, salonumuzda eskisi gibi bir araya gelelim ✨ {{discount_amount}} indirim, {{validity_period}}.",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşmedik 🌸 Size özel {{discount_amount}} indirim hediyemizi sunarız ({{validity_period}}).",
    "{{customer_name}} {{customer_honorific}}, bir süredir görüşmedik 💭 Geri dönüş hediyemiz: {{discount_amount}} indirim, {{validity_period}} geçerli.",
    "Selamlar {{customer_name}} {{customer_honorific}}, sizi tekrar ağırlamak isteriz 🌟 {{discount_amount}} indirim fırsatımız {{validity_period}} içinde geçerlidir.",
    "Merhaba {{customer_name}} {{customer_honorific}}, salon olarak sizi özledik ✨ {{discount_amount}} indirim ile tekrar buluşalım ({{validity_period}}).",
    "{{customer_name}} {{customer_honorific}}, tekrar görüşmek için size {{discount_amount}} indirim sunuyoruz 💫 {{validity_period}}",
    "Merhaba {{customer_name}} {{customer_honorific}}, uzun süredir görüşemedik 🌸 {{discount_amount}} indirimle tekrar bir araya gelelim ({{validity_period}}).",
    "{{customer_name}} {{customer_honorific}}, eski güzel günleri yeniden yaşamak için sizi {{discount_amount}} indirimle bekleriz 💛 {{validity_period}}",
    "Selamlar {{customer_name}} {{customer_honorific}}, salon ailesi olarak sizi özledik 🌟 {{discount_amount}} indirim hediyemiz {{validity_period}} geçerli.",
    "{{customer_name}} {{customer_honorific}}, geri dönüş için size özel {{discount_amount}} indirim hazırladık ✨ {{validity_period}} içinde kullanabilirsiniz.",
    "Merhaba {{customer_name}} {{customer_honorific}}, sizi tekrar ağırlamak için kapımız açık — üstelik {{discount_amount}} indirimle 🌸 {{validity_period}}",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, uzun bir süredir randevu kaydınız oluşmamıştır. Tekrar ağırlamak amacıyla {{discount_amount}} indirim fırsatımızı sunarız. {{validity_period}} süreyle geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, salon olarak yokluğunuzu hissetmekteyiz. {{discount_amount}} indirim hakkınız {{validity_period}} içinde geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, müşterimiz olarak tarafınıza özel {{discount_amount}} indirim sunuyoruz. {{validity_period}} süreyle değerlendirebilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, sizi tekrar ağırlamak için {{discount_amount}} indirim fırsatımızı paylaşırız. Geçerlilik süresi: {{validity_period}}.",
    "Sayın {{customer_name}} {{customer_surname}}, bir süredir görüşmediğimizin farkındayız. {{discount_amount}} indirim hediyemiz {{validity_period}} geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, son ziyaretinizden bu yana belirli bir süre geçmiştir. Tarafınıza özel {{discount_amount}} indirim fırsatı {{validity_period}} içinde geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, müşterimiz olarak yokluğunuzu önemsiyoruz. {{discount_amount}} indirim hediyemizi {{validity_period}} süreyle sunarız.",
    "Sayın {{customer_name}} {{customer_surname}}, salon olarak siz değerli müşterilerimizi {{discount_amount}} indirimle ağırlamaktan memnuniyet duyarız. {{validity_period}}.",
    "Sayın {{customer_name}} {{customer_surname}}, hizmetlerimizden tekrar yararlanmanız için {{discount_amount}} indirim fırsatımız {{validity_period}} içinde geçerlidir.",
    "Sayın {{customer_name}} {{customer_surname}}, müsait olduğunuz bir tarihte sizi {{discount_amount}} indirimle ağırlamaktan memnuniyet duyarız. {{validity_period}}.",
  ],
};

// ─────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────
export const TIERED_TEMPLATE_VARIATIONS: Record<string, TieredVariations> = {
  kedy_randevu_onay: KEDY_RANDEVU_ONAY,
  kedy_randevu_hatirlatma: KEDY_RANDEVU_HATIRLATMA,
  kedy_no_show_hatirlatma: KEDY_NO_SHOW_HATIRLATMA,
  kedy_waitlist_teklif: KEDY_WAITLIST_TEKLIF,
  kedy_memnuniyet_anketi: KEDY_MEMNUNIYET_ANKETI,
  kedy_dogum_gunu_kutlamasi: KEDY_DOGUM_GUNU_KUTLAMASI,
  kedy_geri_donus: KEDY_GERI_DONUS,
};

// ─────────────────────────────────────────────────────────────────
// Public API — variation picker
// ─────────────────────────────────────────────────────────────────

function toneToTier(tone: SalonCommunicationTone | string | null | undefined): ToneTier {
  const t = String(tone || '').toUpperCase();
  if (t === 'FRIENDLY' || t === 'PROFESSIONAL') return t;
  return 'BALANCED';
}

export function getTierForTemplate(templateName: string, tone: SalonCommunicationTone | string | null | undefined): string[] | null {
  const variations = TIERED_TEMPLATE_VARIATIONS[templateName];
  if (!variations) return null;
  return variations[toneToTier(tone)];
}

/**
 * Pick a single variation body for a given (template, salon-tone).
 * Returns null if the template is not registered in the tiered registry
 * (caller should fall back to legacy flat array).
 */
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

/**
 * On rejection: move to the NEXT variation within the same tier.
 * Returns null if no rotation available.
 */
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

export function hasTieredVariations(templateName: string): boolean {
  return Boolean(TIERED_TEMPLATE_VARIATIONS[templateName]);
}
