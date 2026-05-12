-- Salon offer config — used by birthday + winback MARKETING templates.
-- Salon admin enters discount + validity text; empty → template not sent.
-- Additive, idempotent.

BEGIN;

ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "birthdayDiscountText" TEXT,
  ADD COLUMN IF NOT EXISTS "birthdayValidityText" TEXT,
  ADD COLUMN IF NOT EXISTS "winbackDiscountText"  TEXT,
  ADD COLUMN IF NOT EXISTS "winbackValidityText"  TEXT;

COMMIT;
