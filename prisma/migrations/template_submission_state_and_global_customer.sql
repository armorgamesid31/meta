-- Migration: template submission state machine + global customer identity.
--
-- Two changes:
-- 1. SalonMessageTemplate gets tone/variant/state tracking columns and a
--    new TemplateSubmissionState enum to drive the queue-based Meta
--    template submission worker.
-- 2. GlobalCustomerIdentity introduced; Customer linked via globalIdentityId.

-- ─────────────────────────────────────────────────────────────────
-- 1. TemplateSubmissionState enum
-- ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "TemplateSubmissionState" AS ENUM (
    'NOT_QUEUED',
    'SUBMITTED',
    'ACTIVE_VALID',
    'CATEGORY_BUMPED',
    'REJECTED',
    'POOL_EXHAUSTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────
-- 2. SalonMessageTemplate columns
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE "SalonMessageTemplate"
  ADD COLUMN IF NOT EXISTS "templateKey"        TEXT,
  ADD COLUMN IF NOT EXISTS "tone"               "SalonCommunicationTone",
  ADD COLUMN IF NOT EXISTS "variantSlot"        INTEGER,
  ADD COLUMN IF NOT EXISTS "submissionState"    "TemplateSubmissionState" NOT NULL DEFAULT 'NOT_QUEUED',
  ADD COLUMN IF NOT EXISTS "expectedCategory"   TEXT,
  ADD COLUMN IF NOT EXISTS "actualCategory"     TEXT,
  ADD COLUMN IF NOT EXISTS "submissionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "scheduledSubmitAt"  TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "lastSubmittedAt"    TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "approvedAt"         TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "rejectedAt"         TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "rejectionReason"    TEXT;

-- Backfill existing rows: rows with APPROVED metaStatus → ACTIVE_VALID.
UPDATE "SalonMessageTemplate"
SET "submissionState" = 'ACTIVE_VALID', "approvedAt" = COALESCE("lastSyncAt", NOW())
WHERE "metaStatus" = 'APPROVED' AND "submissionState" = 'NOT_QUEUED';

UPDATE "SalonMessageTemplate"
SET "submissionState" = 'SUBMITTED', "lastSubmittedAt" = COALESCE("lastSyncAt", NOW())
WHERE "metaStatus" IN ('PENDING', 'IN_APPEAL') AND "submissionState" = 'NOT_QUEUED';

UPDATE "SalonMessageTemplate"
SET "submissionState" = 'REJECTED', "rejectedAt" = COALESCE("lastSyncAt", NOW())
WHERE "metaStatus" = 'REJECTED' AND "submissionState" = 'NOT_QUEUED';

-- Drop the old unique constraint (multiple rows per eventType now allowed).
ALTER TABLE "SalonMessageTemplate" DROP CONSTRAINT IF EXISTS "uq_salon_message_template";

-- New unique: templateName scoped to salon (since Meta template names are
-- now of the form kedy_<key>_<tone><slot> — unique within a WABA).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_salon_message_template_name"
  ON "SalonMessageTemplate" ("salonId", "templateName");

-- Index for picker (find ACTIVE_VALID rows for a given key+tone).
CREATE INDEX IF NOT EXISTS "idx_salon_template_key_tone_state"
  ON "SalonMessageTemplate" ("salonId", "templateKey", "tone", "submissionState");

-- Index for worker (scan NOT_QUEUED rows ready to submit).
CREATE INDEX IF NOT EXISTS "idx_salon_template_scheduled"
  ON "SalonMessageTemplate" ("submissionState", "scheduledSubmitAt");

-- ─────────────────────────────────────────────────────────────────
-- 3. GlobalCustomerIdentity table
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GlobalCustomerIdentity" (
  "id"              TEXT PRIMARY KEY,
  "phoneE164"       TEXT NOT NULL UNIQUE,
  "email"           TEXT UNIQUE,
  "firstName"       TEXT,
  "lastName"        TEXT,
  "gender"          "CustomerGender",
  "birthDate"       DATE,
  "acceptMarketing" BOOLEAN NOT NULL DEFAULT FALSE,
  "verifiedAt"      TIMESTAMP(6),
  "createdAt"       TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_global_customer_phone"
  ON "GlobalCustomerIdentity" ("phoneE164");

-- ─────────────────────────────────────────────────────────────────
-- 4. Customer.globalIdentityId + Customer.firstAppointmentAt
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "globalIdentityId"   TEXT,
  ADD COLUMN IF NOT EXISTS "firstAppointmentAt" TIMESTAMP(6);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_globalIdentityId_fkey') THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_globalIdentityId_fkey"
      FOREIGN KEY ("globalIdentityId") REFERENCES "GlobalCustomerIdentity"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_customer_global_identity"
  ON "Customer" ("globalIdentityId");

-- ─────────────────────────────────────────────────────────────────
-- 5. Backfill GlobalCustomerIdentity from existing Customer rows
-- ─────────────────────────────────────────────────────────────────
-- For each unique phone, create a GlobalCustomerIdentity holding the
-- most-recently-updated Customer's PII as canonical. Then link all
-- Customer rows sharing that phone back to it.
--
-- We use phone (already E.164 in this schema) as the dedupe key.

WITH canonical AS (
  SELECT DISTINCT ON ("phone")
    "phone",
    "firstName",
    "lastName",
    "gender",
    "birthDate",
    COALESCE("acceptMarketing", FALSE) AS "acceptMarketing"
  FROM "Customer"
  WHERE "phone" IS NOT NULL AND "phone" <> ''
  ORDER BY "phone", "updatedAt" DESC NULLS LAST, "id" DESC
)
INSERT INTO "GlobalCustomerIdentity" (
  "id", "phoneE164", "firstName", "lastName", "gender", "birthDate",
  "acceptMarketing", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::TEXT,
  "phone",
  "firstName",
  "lastName",
  "gender",
  "birthDate",
  "acceptMarketing",
  NOW(), -- treat existing customers as already verified
  NOW(),
  NOW()
FROM canonical
ON CONFLICT ("phoneE164") DO NOTHING;

-- Link every Customer row to the global identity sharing its phone.
UPDATE "Customer" c
SET "globalIdentityId" = g."id"
FROM "GlobalCustomerIdentity" g
WHERE c."phone" = g."phoneE164"
  AND c."globalIdentityId" IS NULL;

-- Backfill firstAppointmentAt = earliest completed appointment per customer.
UPDATE "Customer" c
SET "firstAppointmentAt" = a.first_at
FROM (
  SELECT "customerId", MIN("createdAt") AS first_at
  FROM "Appointment"
  WHERE "status" = 'COMPLETED' AND "customerId" IS NOT NULL
  GROUP BY "customerId"
) a
WHERE c."id" = a."customerId" AND c."firstAppointmentAt" IS NULL;
