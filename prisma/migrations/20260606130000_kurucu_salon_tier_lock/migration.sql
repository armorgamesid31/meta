-- kurucu_salon_tier_lock
-- Kurucu Salon 4-tier kampanya kilit. Salon kayıt sırasını atomik global
-- sequence ile damgalar (race-safe). Tier price id'leri salon yaratılırken
-- env'den okunup kilitlenir (env değişse bile checkout o salon için
-- damgalanan price ile açılır). Migration tamamen additive + idempotent.
--
-- - salon_campaign_signup_rank_seq: PostgreSQL native sequence. nextval()
--   doğal olarak race-safe; aynı anda 100 salon yaratılsa bile her biri
--   benzersiz, ardışık sıra alır.
-- - "Salon"."campaignSignupRank": global unique. Sequence çıkışı buraya
--   tek seferde yazılır; double-lock imkansız (UNIQUE INDEX bekçilik eder).
-- - "campaignTier" + "campaignLockedMonthlyPriceId" + "campaignLockedAnnualPriceId":
--   salon kaydı sırasında damgalanır. Sonradan değişmez.

CREATE SEQUENCE IF NOT EXISTS salon_campaign_signup_rank_seq;

ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "campaignSignupRank" INTEGER,
  ADD COLUMN IF NOT EXISTS "campaignTier" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignLockedMonthlyPriceId" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignLockedAnnualPriceId" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignLockedAt" TIMESTAMP(6);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_salon_campaign_signup_rank"
  ON "Salon"("campaignSignupRank")
  WHERE "campaignSignupRank" IS NOT NULL;
