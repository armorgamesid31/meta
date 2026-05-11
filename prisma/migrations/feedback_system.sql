-- Feedback system migration (additive, idempotent)
-- See plan: feedback magic link + 2 ratings + Google Maps one-shot

BEGIN;

-- Add FEEDBACK to MagicLinkType enum.
DO $$ BEGIN
  ALTER TYPE "MagicLinkType" ADD VALUE IF NOT EXISTS 'FEEDBACK';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Appointment.salonRating (separate from customerRating which is service rating).
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "salonRating" INTEGER;

-- Customer.googleReviewRequestedAt — single-shot guard for the
-- kedy_google_maps_yorum template (sent once per (customer, salon)).
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "googleReviewRequestedAt" TIMESTAMP(6);

COMMIT;
