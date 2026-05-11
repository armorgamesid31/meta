-- Salon communication tone — drives WhatsApp template variation selection
-- and AI agent response tone. Single source of truth across both surfaces.
-- Additive + idempotent.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "SalonCommunicationTone" AS ENUM ('FRIENDLY', 'BALANCED', 'PROFESSIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "communicationTone" "SalonCommunicationTone" NOT NULL DEFAULT 'BALANCED';

COMMIT;
