-- Verification system migration (additive only — safe for production)
-- See plan: plans/refactored-sparking-blossom.md
--
-- Idempotent: uses IF NOT EXISTS / NOT EXISTS guards so re-running is safe.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. Extend AppointmentMessageEventType (referenced by Chakra
--    template registry for the new kedy_dogrulama_link template).
-- ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE "AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'AUTH_CODE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'WAITLIST_OFFER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_LINK';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────
-- 2. New enums (purpose, channel).
-- ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "VerificationPurpose" AS ENUM (
    'SALON_SIGNUP_EMAIL',
    'TEAM_INVITE_PHONE',
    'PHONE_CHANGE',
    'PASSWORD_RESET',
    'CUSTOMER_PHONE',
    'CUSTOMER_LINK_CONSENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VerificationChannel" AS ENUM ('WHATSAPP', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────
-- 3. UserIdentity verification timestamps.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE "UserIdentity"
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

-- ─────────────────────────────────────────────────────────────────
-- 4. VerificationLink table.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VerificationLink" (
  "id"                TEXT NOT NULL,
  "tokenHash"         TEXT NOT NULL,
  "purpose"           "VerificationPurpose" NOT NULL,
  "channel"           "VerificationChannel" NOT NULL,
  "targetIdentityId"  INTEGER,
  "targetSalonId"     INTEGER,
  "targetPhone"       TEXT,
  "targetEmail"       TEXT,
  "payload"           JSONB,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "usedAt"            TIMESTAMP(3),
  "invalidatedAt"     TIMESTAMP(3),
  "deliveryStatus"    TEXT,
  "sendCount"         INTEGER NOT NULL DEFAULT 1,
  "lastSentAt"        TIMESTAMP(3),
  "ipAddress"         TEXT,
  "userAgent"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_verification_token_hash"        ON "VerificationLink"("tokenHash");
CREATE INDEX        IF NOT EXISTS "idx_verification_identity"          ON "VerificationLink"("targetIdentityId");
CREATE INDEX        IF NOT EXISTS "idx_verification_salon"             ON "VerificationLink"("targetSalonId");
CREATE INDEX        IF NOT EXISTS "idx_verification_phone"             ON "VerificationLink"("targetPhone");
CREATE INDEX        IF NOT EXISTS "idx_verification_email"             ON "VerificationLink"("targetEmail");
CREATE INDEX        IF NOT EXISTS "idx_verification_expires"           ON "VerificationLink"("expiresAt");
CREATE INDEX        IF NOT EXISTS "idx_verification_purpose_channel"   ON "VerificationLink"("purpose", "channel");

DO $$ BEGIN
  ALTER TABLE "VerificationLink"
    ADD CONSTRAINT "VerificationLink_targetIdentityId_fkey"
    FOREIGN KEY ("targetIdentityId") REFERENCES "UserIdentity"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VerificationLink"
    ADD CONSTRAINT "VerificationLink_targetSalonId_fkey"
    FOREIGN KEY ("targetSalonId") REFERENCES "Salon"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────
-- 5. PhoneIdentity table.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PhoneIdentity" (
  "id"              SERIAL NOT NULL,
  "phone"           TEXT NOT NULL,
  "firstVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastVerifiedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "blockedAt"       TIMESTAMP(3),
  "blockedReason"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhoneIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_phone_identity_phone" ON "PhoneIdentity"("phone");

-- ─────────────────────────────────────────────────────────────────
-- 6. CustomerPhoneLink (salon ↔ ecosystem PhoneIdentity).
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CustomerPhoneLink" (
  "id"               SERIAL NOT NULL,
  "salonId"          INTEGER NOT NULL,
  "phoneIdentityId"  INTEGER NOT NULL,
  "customerId"       INTEGER NOT NULL,
  "linkedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consentSource"    TEXT NOT NULL,
  "optInChannels"    JSONB,
  CONSTRAINT "CustomerPhoneLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_phone_link_salon_phone" ON "CustomerPhoneLink"("salonId", "phoneIdentityId");
CREATE INDEX        IF NOT EXISTS "idx_customer_phone_link_customer"   ON "CustomerPhoneLink"("customerId");
CREATE INDEX        IF NOT EXISTS "idx_customer_phone_link_phone"      ON "CustomerPhoneLink"("phoneIdentityId");

DO $$ BEGIN
  ALTER TABLE "CustomerPhoneLink"
    ADD CONSTRAINT "CustomerPhoneLink_phoneIdentityId_fkey"
    FOREIGN KEY ("phoneIdentityId") REFERENCES "PhoneIdentity"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
