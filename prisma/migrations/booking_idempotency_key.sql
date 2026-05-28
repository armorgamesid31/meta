-- BookingIdempotencyKey: çift tıklama / retry koruması (PR8 availability-engine-rework, 2026-05-28).
-- Client booking commit'lerde UUID gönderir, ilk başarılı commit'in
-- appointment id'leri burada cache'lenir. Aynı key ile tekrar gelen
-- request mevcut appointment'ları döndürür; yeni randevu yaratmaz.

CREATE TABLE "BookingIdempotencyKey" (
  "key"            TEXT        NOT NULL,
  "salonId"        INTEGER     NOT NULL,
  -- number[] — created appointment ids in commit order
  "appointmentIds" JSONB       NOT NULL,
  "createdAt"      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(6) NOT NULL,
  CONSTRAINT "BookingIdempotencyKey_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "BookingIdempotencyKey_expiresAt_idx" ON "BookingIdempotencyKey"("expiresAt");
