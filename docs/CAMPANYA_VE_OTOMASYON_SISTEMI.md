# Kampanya ve Otomasyon Sistemi Modernizasyonu

Bu doküman, salon yönetim sisteminin bildirim ve kampanya altyapısında yapılan teknik güncellemeleri özetler.

## 1. Ödül Sistemi: Ücretsiz Hizmet (Free Service)
Sistem artık nakdi indirimlerin ötesinde "Hediye Hizmet" mantığını desteklemektedir.
- **Servis**: `meta/src/services/campaignPricing.ts` dosyası güncellendi.
- **Mantık**: Kampanyada tanımlanan `rewardServiceId`, randevu içeriğiyle eşleşirse %100 indirim uygulanır.

## 2. Yönetim Paneli (Admin UI)
`Salonmanagementsaasapp` projesindeki `CampaignsCrudPage.tsx` yüksek standartlara göre revize edildi:
- **Dinamik Seçiciler**: Ücretsiz hizmet ödülü seçildiğinde otomatik hizmet listesi yüklenir.
- **Tooltip Desteği**: Kullanıcılara rehberlik eden ipuçları eklendi.
- **Basitleştirilmiş Form**: Teknik karmaşıklığı azaltmak için `priority` alanı gizlendi.

## 3. n8n Otomasyon Hub (v2)
`meta/n8n/workflows/salon_automation_hub_v2.json` ile profesyonel bir otomasyon akışı kuruldu:
- **Randevu Hatırlatma**: 2s, 24s ve 72s ofsetleri.
- **Doğum Günü**: 7 gün öncesi ve tam günü tetikleyicileri.
- **Müşteri Geri Kazanma**: 45 günlük inaktiflik takibi.
- **Tekillik (Idempotency)**: `NotificationLog` tablosu üzerinden mükerrer mesaj engelleme.

## 4. Teknik Notlar
- Veritabanı push işlemleri `prisma db push` ile yapılmaktadır (referans: ServiceCategory göç hatası).
- Tüm kampanya etiketleri "Title Case" kuralına tabidir.
