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
// kedy_randevu_iptal
// ─────────────────────────────────────────────────────────────────
const KEDY_RANDEVU_IPTAL: TieredVariations = {
  FRIENDLY: [
    "{{customer_name}}, küçük bir not 🙏 {{appointment_date}} {{appointment_time}} randevun iptal edildi. Dilersen yeni saat bulalım.",
    "Merhaba {{customer_name}}, {{service_name}} randevun iptal görünüyor 💭 İstersen yeniden planlayalım.",
    "{{customer_name}}, planlar değişti 🤝 Randevun kaldırıldı; uygun olduğunda yeni tarih ayarlarız.",
    "Üzgünüz {{customer_name}} 🙏 {{appointment_date}} randevun iptal edildi.",
    "Selam {{customer_name}}! {{appointment_time}} randevun artık aktif değil — yenisini hemen bulabiliriz ✨",
    "{{customer_name}}, randevu kaydın iptal oldu 💫 Sana uygun bir saat bulmak için buradayız.",
    "Hey {{customer_name}}, {{service_name}} randevunu iptal etmek zorunda kaldık 🙌 Aynı haftaya bakalım mı?",
    "{{customer_name}}, sistemdeki randevu kaydın kaldırıldı 📋 Destek istersen yazabilirsin.",
    "Merhaba {{customer_name}}! {{appointment_date}} randevun iptal durumunda ✏️ Yeni planlama için yanındayız.",
    "{{customer_name}}, takvimi birlikte yenileyelim mi? 📅 Sana uygun saatleri paylaşabiliriz.",
  ],
  BALANCED: [
    "Merhaba {{customer_name}} {{customer_honorific}}, {{appointment_date}} {{appointment_time}} randevunuz iptal edildi 🙏 Yeni tarih için yardımcı olabiliriz.",
    "{{customer_name}} {{customer_honorific}}, {{service_name}} randevunuzun iptal bilgisini iletiyoruz 💭",
    "Selamlar {{customer_name}} {{customer_honorific}}, randevu kaydınız pasif duruma alındı 📋",
    "{{customer_name}} {{customer_honorific}}, {{appointment_date}} tarihli rezervasyonunuz iptal edildi 🌸",
    "Merhaba {{customer_name}} {{customer_honorific}}, dilerseniz yeni bir randevu planlamasında yardımcı olabiliriz 💫",
    "{{customer_name}} {{customer_honorific}}, {{appointment_time}} randevunuz artık geçerli değil ✏️",
    "Selamlar {{customer_name}} {{customer_honorific}}, randevu iptal bilgisi: {{service_name}} 🙏",
    "{{customer_name}} {{customer_honorific}}, yeni planlama için bizimle iletişime geçebilirsiniz 🤝",
    "Merhaba {{customer_name}} {{customer_honorific}}, iptal işleminiz başarıyla tamamlandı 🌟",
    "{{customer_name}} {{customer_honorific}}, randevu durumunuz güncellendi: İPTAL 📋",
  ],
  PROFESSIONAL: [
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} {{appointment_time}} tarihli randevunuz iptal edilmiştir.",
    "Sayın {{customer_name}} {{customer_surname}}, rezervasyon kaydınız sistemden kaldırılmıştır.",
    "Sayın {{customer_name}} {{customer_surname}}, {{service_name}} randevu planlamanız iptal durumuna alınmıştır.",
    "Sayın {{customer_name}} {{customer_surname}}, randevu kaydınız geçersiz statüsündedir.",
    "Sayın {{customer_name}} {{customer_surname}}, uygunluk durumunuza göre yeni rezervasyon oluşturulabilir.",
    "Sayın {{customer_name}} {{customer_surname}}, iptal işleminiz sistem kayıtlarına işlenmiştir.",
    "Sayın {{customer_name}} {{customer_surname}}, yeni randevu oluşturmak için destek ekibimizle iletişime geçebilirsiniz.",
    "Sayın {{customer_name}} {{customer_surname}}, {{appointment_date}} tarihli rezervasyonunuz sonlandırılmıştır.",
    "Sayın {{customer_name}} {{customer_surname}}, randevu statünüz \"İptal\" olarak güncellenmiştir.",
    "Sayın {{customer_name}} {{customer_surname}}, anlayışınız için teşekkür ederiz.",
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
// Registry
// ─────────────────────────────────────────────────────────────────
export const TIERED_TEMPLATE_VARIATIONS: Record<string, TieredVariations> = {
  kedy_randevu_onay: KEDY_RANDEVU_ONAY,
  kedy_randevu_hatirlatma: KEDY_RANDEVU_HATIRLATMA,
  kedy_randevu_iptal: KEDY_RANDEVU_IPTAL,
  kedy_waitlist_teklif: KEDY_WAITLIST_TEKLIF,
  kedy_memnuniyet_anketi: KEDY_MEMNUNIYET_ANKETI,
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
