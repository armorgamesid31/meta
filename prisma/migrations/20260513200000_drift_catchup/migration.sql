-- Idempotent catchup migration. Captures DB-schema drift that accumulated
-- outside migration history. Safe to apply repeatedly via
-- `prisma migrate resolve --applied 20260513200000_drift_catchup`.
--
-- Source: `prisma migrate diff --from-migrations prisma/migrations
-- --to-schema-datasource prisma/schema.prisma --script`.
--
-- DROP statements from the diff have been intentionally omitted; those
-- represent indexes/FKs the live DB has under custom names that the schema
-- expects under default names — renaming them requires a follow-up review
-- migration (see TODO at the bottom of this file).
--
-- All additions below are wrapped in `IF NOT EXISTS` (DDL) or DO-blocks
-- (enum values / foreign keys) so applying them against a DB that already
-- has the change is a no-op.

-- =========================================================================
-- 1) New enum types
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE "public"."OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."OnboardingStep" AS ENUM ('NOT_STARTED', 'WELCOME', 'SALON_NAME', 'SLUG', 'ADDRESS', 'PHONE', 'WORKING_HOURS', 'LOGO', 'GALLERY', 'SERVICES', 'TONE', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."SalonCategory" AS ENUM ('KUAFOR_KADIN', 'KUAFOR_ERKEK', 'KUAFOR_UNISEX', 'GUZELLIK_MERKEZI', 'TIRNAK_STUDYOSU', 'ESTETIK_KLINIK', 'SPA_WELLNESS', 'BARBER', 'DIGER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."SalonCommunicationTone" AS ENUM ('FRIENDLY', 'BALANCED', 'PROFESSIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."TemplateSubmissionState" AS ENUM ('NOT_QUEUED', 'SUBMITTED', 'ACTIVE_VALID', 'CATEGORY_BUMPED', 'REJECTED', 'POOL_EXHAUSTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."VerificationChannel" AS ENUM ('WHATSAPP', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."VerificationPurpose" AS ENUM ('SALON_SIGNUP_EMAIL', 'TEAM_INVITE_PHONE', 'PHONE_CHANGE', 'PASSWORD_RESET', 'CUSTOMER_PHONE', 'CUSTOMER_LINK_CONSENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- 2) Enum value additions (ALTER TYPE ... ADD VALUE IF NOT EXISTS is built-in)
-- =========================================================================

ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'AUTH_CODE';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'WAITLIST_OFFER';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_LINK';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'NO_SHOW';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'BIRTHDAY';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'WINBACK';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'REMINDER_1_DAY';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'REMINDER_3_DAY';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'REMINDER_2_HOUR';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'GOOGLE_MAPS_REVIEW';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'TEAM_INVITE_LINK';
ALTER TYPE "public"."AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'CUSTOMER_VERIFY_LINK';

ALTER TYPE "public"."MagicLinkType" ADD VALUE IF NOT EXISTS 'FEEDBACK';

ALTER TYPE "public"."NotificationEventType" ADD VALUE IF NOT EXISTS 'TEMPLATE_POOL_EXHAUSTED';

-- =========================================================================
-- 3) Column additions on existing tables
-- =========================================================================

ALTER TABLE "public"."Appointment"
  ADD COLUMN IF NOT EXISTS "salonRating" INTEGER;

ALTER TABLE "public"."Customer"
  ADD COLUMN IF NOT EXISTS "firstAppointmentAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "globalIdentityId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleReviewRequestedAt" TIMESTAMP(6);

ALTER TABLE "public"."Salon"
  ADD COLUMN IF NOT EXISTS "birthdayDiscountText" TEXT,
  ADD COLUMN IF NOT EXISTS "birthdayValidityText" TEXT,
  ADD COLUMN IF NOT EXISTS "category" "public"."SalonCategory",
  ADD COLUMN IF NOT EXISTS "communicationTone" "public"."SalonCommunicationTone" NOT NULL DEFAULT 'BALANCED',
  ADD COLUMN IF NOT EXISTS "kurulumScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "kurulumStage" TEXT,
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onboardingSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "onboardingStatus" "public"."OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "onboardingStep" "public"."OnboardingStep" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "winbackDiscountText" TEXT,
  ADD COLUMN IF NOT EXISTS "winbackValidityText" TEXT;

ALTER TABLE "public"."SalonMessageTemplate"
  ADD COLUMN IF NOT EXISTS "actualCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "expectedCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSubmittedAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "scheduledSubmitAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "submissionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "submissionState" "public"."TemplateSubmissionState" NOT NULL DEFAULT 'NOT_QUEUED',
  ADD COLUMN IF NOT EXISTS "templateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "tone" "public"."SalonCommunicationTone",
  ADD COLUMN IF NOT EXISTS "variantSlot" INTEGER;

ALTER TABLE "public"."UserIdentity"
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3);

-- StripeCheckoutAttempt.updatedAt — the live DB still carries a CURRENT_TIMESTAMP
-- default that the schema dropped. DROP DEFAULT is idempotent in PG so this
-- is safe to apply repeatedly.
ALTER TABLE "public"."StripeCheckoutAttempt"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- =========================================================================
-- 4) New tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."CustomerPhoneLink" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "phoneIdentityId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consentSource" TEXT NOT NULL,
    "optInChannels" JSONB,

    CONSTRAINT "CustomerPhoneLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."GlobalCustomerIdentity" (
    "id" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "gender" "public"."CustomerGender",
    "birthDate" DATE,
    "acceptMarketing" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalCustomerIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."PhoneIdentity" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "firstVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."VerificationLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "public"."VerificationPurpose" NOT NULL,
    "channel" "public"."VerificationChannel" NOT NULL,
    "targetIdentityId" INTEGER,
    "targetSalonId" INTEGER,
    "targetPhone" TEXT,
    "targetEmail" TEXT,
    "payload" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "deliveryStatus" TEXT,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."salon_journey_tasks" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "taskKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "points" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salon_journey_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."service_templates" (
    "id" SERIAL NOT NULL,
    "category" "public"."SalonCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "defaultDurationMin" INTEGER NOT NULL DEFAULT 30,
    "defaultPriceTRY" INTEGER,
    "serviceCategoryId" INTEGER,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_templates_pkey" PRIMARY KEY ("id")
);

-- =========================================================================
-- 5) Indexes (idempotent via IF NOT EXISTS)
-- =========================================================================

CREATE INDEX IF NOT EXISTS "idx_customer_phone_link_customer" ON "public"."CustomerPhoneLink"("customerId" ASC);
CREATE INDEX IF NOT EXISTS "idx_customer_phone_link_phone" ON "public"."CustomerPhoneLink"("phoneIdentityId" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_phone_link_salon_phone" ON "public"."CustomerPhoneLink"("salonId" ASC, "phoneIdentityId" ASC);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalCustomerIdentity_email_key" ON "public"."GlobalCustomerIdentity"("email" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "GlobalCustomerIdentity_phoneE164_key" ON "public"."GlobalCustomerIdentity"("phoneE164" ASC);
CREATE INDEX IF NOT EXISTS "idx_global_customer_phone" ON "public"."GlobalCustomerIdentity"("phoneE164" ASC);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_phone_identity_phone" ON "public"."PhoneIdentity"("phone" ASC);

CREATE INDEX IF NOT EXISTS "idx_verification_email" ON "public"."VerificationLink"("targetEmail" ASC);
CREATE INDEX IF NOT EXISTS "idx_verification_expires" ON "public"."VerificationLink"("expiresAt" ASC);
CREATE INDEX IF NOT EXISTS "idx_verification_identity" ON "public"."VerificationLink"("targetIdentityId" ASC);
CREATE INDEX IF NOT EXISTS "idx_verification_phone" ON "public"."VerificationLink"("targetPhone" ASC);
CREATE INDEX IF NOT EXISTS "idx_verification_purpose_channel" ON "public"."VerificationLink"("purpose" ASC, "channel" ASC);
CREATE INDEX IF NOT EXISTS "idx_verification_salon" ON "public"."VerificationLink"("targetSalonId" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_verification_token_hash" ON "public"."VerificationLink"("tokenHash" ASC);

CREATE INDEX IF NOT EXISTS "salon_journey_tasks_salonId_completedAt_idx" ON "public"."salon_journey_tasks"("salonId" ASC, "completedAt" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "salon_journey_tasks_salonId_taskKey_key" ON "public"."salon_journey_tasks"("salonId" ASC, "taskKey" ASC);

CREATE INDEX IF NOT EXISTS "service_templates_category_isActive_displayOrder_idx" ON "public"."service_templates"("category" ASC, "isActive" ASC, "displayOrder" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "service_templates_category_name_key" ON "public"."service_templates"("category" ASC, "name" ASC);

CREATE INDEX IF NOT EXISTS "idx_customer_global_identity" ON "public"."Customer"("globalIdentityId" ASC);

-- UserIdentity uniques: the indexes already exist (created by the
-- 20260504165000_global_identity_membership_cutover migration as PARTIAL
-- unique indexes with `WHERE phone/email IS NOT NULL`). The schema, on
-- the other hand, declares them as full uniques via @unique(map:...).
-- Reconciling the partial→full mismatch requires DROP + CREATE which
-- could lock the table during reindex; that belongs in the manual-review
-- migration listed below, not here.

CREATE INDEX IF NOT EXISTS "idx_salon_template_key_tone_state" ON "public"."SalonMessageTemplate"("salonId" ASC, "templateKey" ASC, "tone" ASC, "submissionState" ASC);
CREATE INDEX IF NOT EXISTS "idx_salon_template_scheduled" ON "public"."SalonMessageTemplate"("submissionState" ASC, "scheduledSubmitAt" ASC);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_salon_message_template_name" ON "public"."SalonMessageTemplate"("salonId" ASC, "templateName" ASC);

-- =========================================================================
-- 6) Foreign keys (idempotent via DO-block + duplicate_object exception)
-- =========================================================================

DO $$ BEGIN
  ALTER TABLE "public"."Customer"
    ADD CONSTRAINT "Customer_globalIdentityId_fkey"
    FOREIGN KEY ("globalIdentityId") REFERENCES "public"."GlobalCustomerIdentity"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."CustomerPhoneLink"
    ADD CONSTRAINT "CustomerPhoneLink_phoneIdentityId_fkey"
    FOREIGN KEY ("phoneIdentityId") REFERENCES "public"."PhoneIdentity"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."VerificationLink"
    ADD CONSTRAINT "VerificationLink_targetIdentityId_fkey"
    FOREIGN KEY ("targetIdentityId") REFERENCES "public"."UserIdentity"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."VerificationLink"
    ADD CONSTRAINT "VerificationLink_targetSalonId_fkey"
    FOREIGN KEY ("targetSalonId") REFERENCES "public"."Salon"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."salon_journey_tasks"
    ADD CONSTRAINT "salon_journey_tasks_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "public"."Salon"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."service_templates"
    ADD CONSTRAINT "service_templates_serviceCategoryId_fkey"
    FOREIGN KEY ("serviceCategoryId") REFERENCES "public"."ServiceCategory"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- TODO (manual review, separate migration):
--   The drift diff also surfaced changes that are NOT included here
--   because they could destroy data, break running code, or require an
--   exclusive table lock. Review and ship as a follow-up migration:
--
--   1) DROP statements (could mask still-running code paths):
--      - ALTER TABLE SalonMembership DROP CONSTRAINT fk_membership_legacy_user
--      - DROP INDEX idx_mobile_auth_membership
--      - DROP INDEX uq_salon_message_template
--      - DROP INDEX uq_salon_user_phone
--      - DROP INDEX idx_staff_membership
--      - DROP INDEX idx_override_membership
--
--   2) Index-shape reconciliations (require DROP + CREATE, table-level
--      reindex; consider CREATE INDEX CONCURRENTLY off-history):
--      - UserIdentity.uq_user_identity_phone: partial → full unique
--      - UserIdentity.uq_user_identity_email: partial → full unique
--
--   3) Foreign-key renames from custom legacy names to Prisma defaults
--      (cosmetic but blocks `prisma migrate dev` from being clean):
--      - Invite.fk_invite_membership → Invite_invitedMembershipId_fkey
--      - MobileAuthSession.fk_mobile_auth_identity → MobileAuthSession_identityId_fkey
--      - MobileAuthSession.fk_mobile_auth_membership → MobileAuthSession_membershipId_fkey
--      - SalonMembership.fk_membership_identity → SalonMembership_identityId_fkey
--      - SalonMembership.fk_membership_salon → SalonMembership_salonId_fkey
--      - Staff.fk_staff_membership → Staff_membershipId_fkey
--      - UserPermissionOverride.fk_override_membership → UserPermissionOverride_membershipId_fkey
-- =========================================================================

-- =========================================================================
-- Usage in production:
--
--   # 1) Apply with full validation (recommended for new envs):
--   npx prisma migrate deploy
--
--   # 2) Mark as already applied on the prod DB that already has the drift:
--   npx prisma migrate resolve --applied 20260513200000_drift_catchup
--
--   After resolve, future `prisma migrate deploy` runs will skip this row.
-- =========================================================================
