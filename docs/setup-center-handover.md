# Setup Center / Trial+Bonus — Handover

PR-1 ürünü: salon kayıt → 14 gün ücretsiz kurulum → bonus kriterleri tamamlanırsa +30 gün bonus → 7 gün grace → Profesyonel+ 2.999 TL/ay otomatik ödeme.

> **Güvenlik:** Daha önce chat'e yapıştırılan `sk_live_51TSww...IRM00MFABTMsf` anahtarı **rotate edilmeli**. Bu doküman yeni anahtarı asla içermez. Yeni anahtarı yalnızca `.env` ve prod ortamına koy.

---

## 1) Değişen / eklenen dosyalar

### Backend (`C:\Users\berka\projeler\meta`)

| Dosya | Ne yapıyor |
|---|---|
| `prisma/migrations/20260518200000_setup_center_trial_bonus/migration.sql` | Yeni alanlar + enum + audit tablo. Legacy salonları `ACTIVE_PAID` olarak backfill eder. |
| `prisma/schema.prisma` | `Salon` modeline 14 yeni alan + `SalonAccessStatus` enum + `SalonOnboardingEvent` model. |
| `src/onboarding/offers.ts` | Acquisition offer registry. Default: `STANDARD_2026_05` (14d/30d/7d). |
| `src/onboarding/criteria.ts` | 9 bonus kriteri — declarative. Wizard zorunlu yaptıklarını duplicate etmez. |
| `src/services/onboarding/progress.ts` | Kriter hesaplama (idempotent, cache yok). |
| `src/services/onboarding/lifecycle.ts` | State machine: startSetupPeriod / tryGrantBonus / grantBonus / revokeBonus / extendPeriod / activatePaid / processStatusTransitions / setChannelStatus / markBookingLinkTested / setImportDecision / setPaymentMethodOnFile. |
| `src/services/onboarding/access.ts` | `requireActiveAccess` middleware + `getAccessSnapshot`. |
| `src/services/onboarding/billing.ts` | Stripe trial-subscription checkout + billing portal session. |
| `src/services/stripeBilling.ts` | Webhook handler güncellendi: `customer.subscription.created/updated/deleted` → setupCenter trial flow için `paymentMethodOnFile` set ve `tryGrantBonus`. `active` → `activatePaid`. |
| `src/routes/setupCenter.ts` | 5 salon-facing endpoint. |
| `src/routes/internalSetupCenter.ts` | 5 internal admin endpoint (grant/revoke/extend/run-transitions/get). |
| `src/routes/billing.ts` | 2 yeni endpoint: `/trial-subscription/checkout`, `/portal-link`. |
| `src/routes/auth.ts` | `register-salon` sonrası `startSetupPeriod(salon.id)` çağrısı. |
| `src/jobs/index.ts` | 6 saatte bir `processStatusTransitions` cron. |
| `src/server.ts` | `setupCenterRoutes` + `internalSetupCenterRoutes` mount. |
| `scripts/stripe-setup-trial-flow.mjs` | Stripe ürün/fiyat/webhook provisioning script. **Sen çalıştıracaksın.** |

### Frontend admin paneli (`C:\Users\berka\projeler\Salonmanagementsaasapp`)

| Dosya | Ne yapıyor |
|---|---|
| `src/app/hooks/useSetupCenter.ts` | React Query hooks + mutations + bonus event bus. |
| `src/app/pages/SetupCenterPage.tsx` | `/app/setup-center` ana sayfa: hero + checklist + Stripe CTA. |
| `src/app/components/setup-center/ChannelOnboardingStatusModal.tsx` | WA/IG durum işaretleme modal. |
| `src/app/components/setup-center/BonusGrantedCelebration.tsx` | "+1 ay kazandın 🎉" modal. |
| `src/app/components/dashboard/SetupCenterBanner.tsx` | Dashboard üstü kompakt countdown şeridi. |
| `src/app/components/dashboard/AdminDashboard.tsx` | Banner ekleme. |
| `src/app/App.tsx` | `/app/setup-center` route. |

### Marketing site (`C:\Users\berka\projeler\v0-kedy-marketing-website`)

| Dosya | Ne yapıyor |
|---|---|
| `lib/plans.ts` | Profesyonel+ kopyası "14 gün + 30 gün bonus" mesajına güncellendi; eski "İlk 3 ay 999 TL" indirimi kaldırıldı. |
| `app/fiyatlandirma/page.tsx` | Metadata güncellendi. |

---

## 2) Stripe konfigürasyonu — TAM ADIM ADIM

### 2.1) Live key'i rotate et

1. Stripe Dashboard → Developers → API keys
2. Mevcut Secret key (`sk_live_51TSww…IRM00MFABTMsf`) satırının yanındaki "..." menüsünden **Roll** veya **Delete**.
3. Yeni secret key oluştur. Bu pencereyi kapatma — anahtar bir kez gösterilir.

### 2.2) `.env` dosyalarına yapıştır

**`meta/.env`** (backend):
```
STRIPE_SECRET_KEY=sk_live_YENI_ANAHTAR
STRIPE_WEBHOOK_SECRET=whsec_YENI_WEBHOOK_SECRET  # 2.3'te alacaksın
STRIPE_PRICE_TEMEL=price_xxx                     # 2.3'te alacaksın
STRIPE_PRICE_PROFESSIONAL_PLUS=price_yyy         # 2.3'te alacaksın
STRIPE_WEBHOOK_TARGET_URL=https://api.kedyapp.com/api/billing/stripe/webhook
# (Eski "STRIPE_COUPON_PROFESSIONAL_PLUS_INTRO" varsa kaldır.)
```

**`v0-kedy-marketing-website/.env.local`**:
```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_YENI_PK
```

> Test mode'da denemek için tüm `sk_live_` → `sk_test_` ve `pk_live_` → `pk_test_`.

### 2.3) Stripe ürünleri + webhook oluştur

```bash
cd meta
node scripts/stripe-setup-trial-flow.mjs
```

Script idempotenttir: yoksa oluşturur, varsa atlar. Çıktıda 3 satır env var basar:
```
STRIPE_PRICE_TEMEL=price_...
STRIPE_PRICE_PROFESSIONAL_PLUS=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Bunları `meta/.env`'a yapıştır ve backend'i yeniden başlat.

> Webhook endpoint zaten varsa script signing secret'ı okuyamaz (Stripe sırrı bir kere gösteriyor). Bu durumda: Stripe Dashboard → Developers → Webhooks → endpoint → "Roll signing secret" → yeni değeri `STRIPE_WEBHOOK_SECRET`'a yaz.

### 2.4) Stripe Dashboard'da kontrol et

- Products: **Kedy Temel** (price `kedy_temel_monthly_v1` → 499 TRY/ay) ve **Kedy Profesyonel+** (price `kedy_profesyonel_plus_monthly_v1` → 2.999 TRY/ay) var.
- Webhooks: endpoint `https://api.kedyapp.com/api/billing/stripe/webhook`, 8 event seçili.

---

## 3) Migration

```bash
cd meta
# 1. Migration'ı uygula (Prisma migrate)
npx prisma migrate deploy
# Veya geliştirme için:
npx prisma migrate dev
# 2. Prisma client'ı yeniden generate et
npx prisma generate
# 3. TypeScript'i build et / dev server'ı yeniden başlat
npm run build && npm start
```

Migration backfill mantığı:
- Aktif SalonSubscription'ı olan salonlar → `setupAccessStatus = ACTIVE_PAID`, `offerKey = LEGACY_PAID`
- `pending_activation` subscription olanlar → `setupAccessStatus = ACTIVE_PAID`, `offerKey = LEGACY_PENDING_ACTIVATION`
- Hiç subscription'ı olmayanlar → `setupAccessStatus = ACTIVE_PAID`, `offerKey = LEGACY_NO_SUBSCRIPTION`

> Bu şekilde **mevcut salonların hiçbiri 14-günlük saata düşmez**. Sadece migration sonrası yeni `/api/auth/register-salon` üzerinden gelen salonlar trial sistemine girer.

---

## 4) End-to-end test planı

### A) Yeni salon kaydı → setup period başlar

```bash
curl -X POST http://localhost:3000/api/auth/register-salon \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"deneme1234","salonName":"Test Salon"}'
```

DB kontrolü:
```sql
SELECT id, "setupAccessStatus", "offerKey", "setupPeriodStartedAt", "setupPeriodEndsAt"
FROM "Salon" ORDER BY id DESC LIMIT 1;
```
Beklenen: `SETUP_PERIOD`, `STANDARD_2026_05`, +14 gün sonrası tarih.

Event log:
```sql
SELECT * FROM "SalonOnboardingEvent" WHERE "salonId" = X ORDER BY "createdAt" DESC;
```
Beklenen: 1 satır `period_started`.

### B) Setup Center payload

Token alıp:
```bash
TOKEN=...
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/setup-center
```
Cevapta `progress.criteria` 9 madde, hepsi `completed:false`, `progress.percent: 0`, `access.daysLeftInCurrentWindow: 14` olmalı.

### C) Kriterleri tamamla → bonus otomatik grant

Wizard'ı bitir + hizmet/çalışan/staffService/randevu ekle + logo yükle, sonra:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"whatsapp","status":"pending_verification"}' \
  http://localhost:3000/api/setup-center/channel-status
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision":"no_data_to_import"}' \
  http://localhost:3000/api/setup-center/import-decision
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/setup-center/booking-link-tested
```

Stripe trial-subscription checkout başlat:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"successUrl":"http://localhost:5173/app/setup-center?stripe=success","cancelUrl":"http://localhost:5173/app/setup-center?stripe=cancel"}' \
  http://localhost:3000/api/billing/trial-subscription/checkout
```
`checkoutUrl`'i tarayıcıda aç, Stripe test kartıyla ödeme yöntemi gir (`4242 4242 4242 4242`, CVC `123`, expiry herhangi).

Webhook geldikten sonra:
```sql
SELECT "paymentMethodOnFile", "setupBonusGrantedAt", "setupBonusEndsAt"
FROM "Salon" WHERE id = X;
```
Beklenen: `paymentMethodOnFile = true`, bonus tarihleri set.

### D) Lifecycle cron — period bittiğinde transition

Test için `setupPeriodEndsAt`'i geriye al ve cron'u tetikle:
```bash
# DB'de tarihi geriye al
psql "UPDATE \"Salon\" SET \"setupPeriodEndsAt\" = NOW() - INTERVAL '1 day' WHERE id = X;"

# Internal API key ile manuel trigger
curl -X POST -H "X-Internal-API-Key: $INTERNAL_API_KEY" \
  http://localhost:3000/api/internal/setup-center/run-transitions
```
Beklenen cevap: `{ scanned: N, toBonus: 1, toGrace: 0, toPaymentRequired: 0 }`.
DB'de: `setupAccessStatus = BONUS_PERIOD`.

### E) Admin grant / revoke

```bash
# Manuel bonus
curl -X POST -H "X-Internal-API-Key: $INTERNAL_API_KEY" \
  -H "X-Admin-Id: berkay" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Manuel test","bonusDays":30}' \
  http://localhost:3000/api/internal/setup-center/salons/X/grant-bonus

# Revoke
curl -X POST -H "X-Internal-API-Key: $INTERNAL_API_KEY" \
  -H "X-Admin-Id: berkay" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Yanlış grant"}' \
  http://localhost:3000/api/internal/setup-center/salons/X/revoke-bonus
```

### F) Frontend smoke

1. Yeni salon ile login → dashboard'da turuncu Setup Center banner görmeli.
2. "Devam et" → `/app/setup-center` açılmalı. Hero + 9 satırlık checklist.
3. Bir hizmet ekle → setup-center sayfasını yenile → "min_5_services" yanında "1/5" göstermeli.
4. WhatsApp düğmesi → channel modal → "Meta doğrulama bekliyor" seçip kaydet → kriter tamamlanmalı.
5. Tüm kriterler tamamlanınca "Bonusu şimdi al" düğmesi çıkar → tıkla → Stripe Checkout (test mode'da `4242 4242 4242 4242`).
6. Geri yönlendirildiğinde celebration modal açılmalı.

---

## 5) Bilerek MVP dışında bırakılanlar

- **Magic link gönderme özelliği** (konuşma penceresinden müşteriye link). Stripe trial flow'undan bağımsız, ayrı bir PR olarak ele alınacak. WhatsApp template dispatcher altyapısı eksik (`OutboundMessage` modeli yok), o yüzden tek sprintte yapılamaz.
- **Admin UI** — admin grant/revoke şu an internal API key + curl ile. İleride bir `/admin` paneline gömülebilir.
- **Salon bazlı offer override** — şimdilik tüm yeni salonlar `STANDARD_2026_05` ile başlar. Referral kodu / kampanya querystring ile farklı offer atama, `register-salon` endpoint'inde tek satır eklenerek desteklenir.
- **Marketing site checkout sayfasının yeni offer'a güncellenmesi** — şimdilik `/checkout` eski "pay-first" akışı korunuyor (mevcut müşterileri kırmamak için). Yeni offer için marketing site'ta bir "Ücretsiz başla" CTA eklemek ve `/auth/signup` flow'unu açmak ayrı bir iş.
- **`paymentMethodOnFile` için ayrı SetupIntent endpoint'i** — şu anki tasarımda kart toplama, doğrudan trial subscription kurarak yapılıyor. Bu Stripe-blessed pattern: cüzdana kart ekleme + ileride otomatik tahsil. Eğer "sadece kart kaydetmek, abonelik kurmamak" istenirse `SetupIntent` ile ayrı endpoint eklenir.

---

## 6) Operasyonel notlar

- Cron 6 saatte bir koşar. Tek seferlik manuel tetik: `POST /api/internal/setup-center/run-transitions`.
- Audit log: `SELECT * FROM "SalonOnboardingEvent" WHERE "salonId" = X ORDER BY "createdAt" DESC;`
- `requireActiveAccess` middleware **henüz hiçbir route'a mount edilmedi**. Sebep: PAYMENT_REQUIRED uyarısını önce frontend banner ile yumuşak göstermek, sonra middleware ile sertleştirmek istiyoruz. Hazır olunca `app.use('/api/admin', requireActiveAccess, ...)` ekleyerek hard-block aç.
- Yeni teklif eklemek: `meta/src/onboarding/offers.ts` içine yeni entry → `DEFAULT_OFFER_KEY` değiştir ya da register-salon endpoint'inde branch et.

---

## 7) İlerleyen sprintlerde

1. **Marketing site → free signup CTA + `/auth/signup` web sayfası** (şu an admin app yeni salon kayıtlarını kabul ediyor, ama marketing'te buton yok).
2. **Magic link feature** (conversation penceresinden müşteriye account-claim linki).
3. **Email kampanyası**: setup period gün 3 / gün 7 / gün 12 / bonus alındı / grace başladı / paywall etkin oldu — pazarlama otomasyonu için bu event'ler `SalonOnboardingEvent` tablosundan trigger edilebilir.
4. **Analytics dashboard** — kaç salon hangi statüde, dönüşüm oranı, hangi kriter en çok takılıyor.
