-- Setup Center / Free Trial / Bonus Period — initial schema.
--
-- Adds the bookkeeping fields the SetupCenter service needs to drive the
-- "14 gün ücretsiz kurulum + 30 gün bonus + 7 gün grace + Profesyonel+
-- 2.999 TL/ay" funnel. Existing salons that came in through the
-- pay-first Stripe flow are backfilled to ACTIVE_PAID so they don't
-- accidentally land in a setup period they never needed.
--
-- See:
--   meta/src/onboarding/offers.ts        — offer config (days, plan, etc.)
--   meta/src/onboarding/criteria.ts      — declarative bonus criteria
--   meta/src/services/onboarding/access.ts — derives the access status

-- 1. Salon access status enum --------------------------------------------------
CREATE TYPE "SalonAccessStatus" AS ENUM (
  'SETUP_PERIOD',
  'BONUS_PERIOD',
  'GRACE_PERIOD',
  'ACTIVE_PAID',
  'PAYMENT_REQUIRED',
  'SUSPENDED',
  'CANCELLED'
);

-- 2. Salon: setup-period & bonus bookkeeping ----------------------------------
ALTER TABLE "Salon"
  ADD COLUMN "offerKey"                    TEXT,
  ADD COLUMN "setupPeriodStartedAt"        TIMESTAMP(6),
  ADD COLUMN "setupPeriodEndsAt"           TIMESTAMP(6),
  ADD COLUMN "setupBonusEligibleAt"        TIMESTAMP(6),
  ADD COLUMN "setupBonusGrantedAt"         TIMESTAMP(6),
  ADD COLUMN "setupBonusEndsAt"            TIMESTAMP(6),
  ADD COLUMN "setupBonusGrantedBy"         TEXT,
  ADD COLUMN "setupGracePeriodEndsAt"      TIMESTAMP(6),
  ADD COLUMN "setupAccessStatus"           "SalonAccessStatus" NOT NULL DEFAULT 'SETUP_PERIOD',
  ADD COLUMN "channelOnboardingState"      JSONB,
  ADD COLUMN "paymentMethodOnFile"         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "paymentMethodAddedAt"        TIMESTAMP(6),
  ADD COLUMN "bookingLinkTestedAt"         TIMESTAMP(6),
  ADD COLUMN "appointmentImportDecision"   TEXT,
  ADD COLUMN "appointmentImportDecidedAt"  TIMESTAMP(6);

-- 3. Audit log for every lifecycle transition ---------------------------------
CREATE TABLE "SalonOnboardingEvent" (
  "id"         SERIAL PRIMARY KEY,
  "salonId"    INTEGER NOT NULL,
  "eventType"  TEXT NOT NULL,
  "payload"    JSONB,
  "actorType"  TEXT NOT NULL,
  "actorId"    TEXT,
  "createdAt"  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_setup_event_salon"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_setup_event_salon_time" ON "SalonOnboardingEvent" ("salonId", "createdAt");
CREATE INDEX "idx_setup_event_type" ON "SalonOnboardingEvent" ("eventType");

CREATE INDEX "idx_salon_access_status" ON "Salon" ("setupAccessStatus");
CREATE INDEX "idx_salon_period_ends" ON "Salon" ("setupPeriodEndsAt") WHERE "setupPeriodEndsAt" IS NOT NULL;
CREATE INDEX "idx_salon_bonus_ends" ON "Salon" ("setupBonusEndsAt") WHERE "setupBonusEndsAt" IS NOT NULL;
CREATE INDEX "idx_salon_grace_ends" ON "Salon" ("setupGracePeriodEndsAt") WHERE "setupGracePeriodEndsAt" IS NOT NULL;

-- 4. Backfill existing salons -------------------------------------------------
--
-- Anyone who already has a non-trivial subscription row (Stripe-flow paid
-- signup) is ACTIVE_PAID. Everyone else (legacy free signups via
-- /api/auth/register-salon, dev/test fixtures, etc.) is parked in
-- SETUP_PERIOD but with no end date — the lifecycle cron will pick them
-- up next run and either close them out via admin action or migrate
-- them by hand. We intentionally do NOT auto-start their 14-day clock,
-- because that would surprise legacy free users with a paywall.

UPDATE "Salon" s
SET
  "setupAccessStatus" = 'ACTIVE_PAID',
  "offerKey" = 'LEGACY_PAID'
WHERE EXISTS (
  SELECT 1 FROM "SalonSubscription" ss
  WHERE ss."salonId" = s."id"
    AND ss."status" IN ('active', 'trialing', 'past_due')
);

UPDATE "Salon" s
SET
  "setupAccessStatus" = 'ACTIVE_PAID',
  "offerKey" = 'LEGACY_PENDING_ACTIVATION'
WHERE
  "setupAccessStatus" = 'SETUP_PERIOD'  -- not handled above
  AND EXISTS (
    SELECT 1 FROM "SalonSubscription" ss
    WHERE ss."salonId" = s."id"
      AND ss."status" = 'pending_activation'
  );

-- For everyone else (no subscription row whatsoever) we mark them as
-- ACTIVE_PAID too — these are dev/test salons or partial fixtures. The
-- lifecycle service treats this as "out of scope, leave alone".
UPDATE "Salon" s
SET
  "setupAccessStatus" = 'ACTIVE_PAID',
  "offerKey" = 'LEGACY_NO_SUBSCRIPTION'
WHERE "setupAccessStatus" = 'SETUP_PERIOD';

-- After backfill the default for NEW rows (set via DEFAULT on the column)
-- becomes the only path: a fresh /api/auth/register-salon insert lands
-- in SETUP_PERIOD with offerKey=null, and the auth route fills in the
-- offer + period dates immediately after creation. See
-- meta/src/services/onboarding/lifecycle.ts:startSetupPeriod().
