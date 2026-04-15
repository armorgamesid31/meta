# KedyApp Kapsamlı Kampanya & Otomasyon Modernizasyonu

## Hedef
Kampanya ve otomasyon sistemini; Backend (Meta), Mobil Uygulama (Admin) ve Randevu Sayfası (Public) üçgeninde tam senkronize, premium ve hatasız hale getirmek.

---

## 1. Backend & Veritabanı (Meta - Prisma/Express)

- [ ] **Bildirim Loglama Sistemi:** `ReminderLog` tablosu (veya benzeri) ile hangi randevuya hangi hatırlatıcının (72s, 24s, 2s) gittiğini takip et.
  - *Doğrulama:* Aynı hatırlatıcı n8n tekrar çalışsa bile mükerrer gitmez.
- [ ] **Tavsiye (Referral) Altyapısı:** `referralCode` ile gelen randevuları işaretle ve kampanya kuralına göre (ilk randevu tamamlanınca) hem davet edene hem davet edilene ödül/puan tanımla.
  - *Doğrulama:* `/api/bookings/submit` rotasında referral kontrolü çalışıyor.
- [ ] **Kampanya Servis Güncellemesi:** "Ücretsiz Hizmet" (free_service) ödül tipini destekle.
  - *Doğrulama:* `Campaign` modeli içindeki `config` JSON'ı metin değerlerini doğru saklıyor.

## 2. Mobil Uygulama - Admin (Frontend)

- [ ] **`CampaignsCrudPage.tsx` UX Revizyonu:**
  - `priority` alanını gizle (arka planda 100 kalabilir).
  - `deliveryMode` seçimini "OTOMATİK" / "MANUEL" buton grubu (Toggle) yap.
  - Her alan için `HelpCircle` ikonlu Türkçe tooltip'ler ekle.
- [ ] **Şablon & Yazım Düzeltme:**
  - Tüm seçenekleri büyük harf ve Türkçe karakter uyumlu yap (bkz: Yüzde İndirim, Sabit Tutar).
  - Sadakat ve Doğum Günü şablonlarına "Ücretsiz Hizmet" seçeneğini ekle.
- [ ] **Geri Kazanım (Win-back) Ayarları:** 30/45/60 gün seçeneklerini dropdown yerine görsel kartlar veya belirgin seçim alanı olarak sun.

## 3. Randevu Sayfası - Public (Meta - BookingPage)

- [ ] **Aktif Kampanyaları Göster:** Randevu aşamasında "Boş Saatleri Doldurma" veya "Yeni Müşteri" indirimlerini sepete yansıt ve kullanıcıya göster.
- [ ] **Müşteri Referral Alanı:** Mevcut bir müşteri randevu sonunda kendine özel referral linkini kopyalayabilmeli.

## 4. n8n Otomasyon & Akış (Orchestration)

- [ ] **3 Aşamalı Randevu Hatırlatıcı:**
    - 72 Saat: Vazgeçme ihtimaline karşı onay mesajı.
    - 24 Saat: Klasik hatırlatıcı.
    - 2 Saat: "Kahveniz hazır" temalı sıcak hatırlatıcı.
- [ ] **2 Aşamalı Doğum Günü:**
    - Doğum gününden 7 gün önce: "Hazırlık" daveti.
    - Doğum gününde: Saf kutlama/hediye mesajı.
- [ ] **Dinamik Geri Kazanım:** Kampanya konfigürasyonundaki (30/45/60) güne göre otomatik tetiklenen WhatsApp akışı.

---

## Done When
- [ ] Admin panelinde kampanyalar Türkçeleşmiş ve tooltipli.
- [ ] n8n workflow'u randevu saatine göre 3 farklı varyasyonu hatasız gönderiyor.
- [ ] Randevu sayfasında aktif indirimler kullanıcıya anlık yansıyor.
- [ ] Ücretsiz hizmet ödülü hem admin paneli hem backend tarafından tanınıyor.
