-- Campaign Operational V1

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignDeliveryMode') THEN
    CREATE TYPE "CampaignDeliveryMode" AS ENUM ('AUTO', 'MANUAL');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignApplicationStatus') THEN
    CREATE TYPE "CampaignApplicationStatus" AS ENUM ('APPLIED', 'RELEASED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignEnrollmentStatus') THEN
    CREATE TYPE "CampaignEnrollmentStatus" AS ENUM ('ENROLLED', 'OPTED_OUT');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignShareLinkStatus') THEN
    CREATE TYPE "CampaignShareLinkStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignAttributionStatus') THEN
    CREATE TYPE "CampaignAttributionStatus" AS ENUM ('PENDING', 'REGISTERED', 'QUALIFIED', 'REWARDED', 'CANCELLED');
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationEventType') THEN
    ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CAMPAIGN_AUTO_TRIGGER';
    ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'CAMPAIGN_MANUAL_SEND';
  END IF;
END $$;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "listPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "discountTotal" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "finalPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "campaignSnapshot" JSONB;

ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "deliveryMode" "CampaignDeliveryMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "maxGlobalUsage" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxPerCustomer" INTEGER,
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(6);

CREATE TABLE IF NOT EXISTS "AppointmentCampaignApplication" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "appointmentId" INTEGER NOT NULL,
  "customerId" INTEGER,
  "campaignId" INTEGER NOT NULL,
  "serviceId" INTEGER,
  "status" "CampaignApplicationStatus" NOT NULL DEFAULT 'APPLIED',
  "listPrice" DOUBLE PRECISION NOT NULL,
  "discountAmount" DOUBLE PRECISION NOT NULL,
  "finalPrice" DOUBLE PRECISION NOT NULL,
  "metadata" JSONB,
  "appliedAt" TIMESTAMP(6) DEFAULT NOW(),
  "releasedAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) DEFAULT NOW(),
  CONSTRAINT "fk_campaign_app_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_app_appointment" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_app_customer" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_app_campaign" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_app_service" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS "CustomerCampaignWallet" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "campaignId" INTEGER NOT NULL,
  "balanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "consumedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(6),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) DEFAULT NOW(),
  CONSTRAINT "fk_campaign_wallet_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_wallet_customer" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_wallet_campaign" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS "CustomerCampaignEnrollment" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "campaignId" INTEGER NOT NULL,
  "status" "CampaignEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
  "source" TEXT,
  "metadata" JSONB,
  "enrolledAt" TIMESTAMP(6) DEFAULT NOW(),
  "createdAt" TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) DEFAULT NOW(),
  CONSTRAINT "fk_campaign_enrollment_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_enrollment_customer" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_enrollment_campaign" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS "CampaignShareLink" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "campaignId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "token" TEXT NOT NULL,
  "status" "CampaignShareLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "lastSharedAt" TIMESTAMP(6),
  "expiresAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) DEFAULT NOW(),
  CONSTRAINT "fk_campaign_share_link_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_share_link_campaign" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_share_link_customer" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS "CampaignAttribution" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "campaignId" INTEGER NOT NULL,
  "shareLinkId" INTEGER NOT NULL,
  "referrerCustomerId" INTEGER NOT NULL,
  "referredCustomerId" INTEGER,
  "status" "CampaignAttributionStatus" NOT NULL DEFAULT 'PENDING',
  "firstAppointmentId" INTEGER,
  "completedAt" TIMESTAMP(6),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) DEFAULT NOW(),
  CONSTRAINT "fk_campaign_attr_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_attr_campaign" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_attr_share_link" FOREIGN KEY ("shareLinkId") REFERENCES "CampaignShareLink"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_attr_referrer_customer" FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_attr_referred_customer" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fk_campaign_attr_first_appointment" FOREIGN KEY ("firstAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_wallet_salon_customer_campaign"
  ON "CustomerCampaignWallet" ("salonId", "customerId", "campaignId");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_enrollment_salon_customer_campaign"
  ON "CustomerCampaignEnrollment" ("salonId", "customerId", "campaignId");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_share_link_token"
  ON "CampaignShareLink" ("token");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_share_link_salon_campaign_customer"
  ON "CampaignShareLink" ("salonId", "campaignId", "customerId");

CREATE INDEX IF NOT EXISTS "idx_campaign_salon_priority_active"
  ON "Campaign" ("salonId", "priority", "isActive");

CREATE INDEX IF NOT EXISTS "idx_campaign_app_salon_appointment"
  ON "AppointmentCampaignApplication" ("salonId", "appointmentId");

CREATE INDEX IF NOT EXISTS "idx_campaign_app_salon_customer_campaign"
  ON "AppointmentCampaignApplication" ("salonId", "customerId", "campaignId");

CREATE INDEX IF NOT EXISTS "idx_campaign_app_campaign_status"
  ON "AppointmentCampaignApplication" ("campaignId", "status");

CREATE INDEX IF NOT EXISTS "idx_campaign_wallet_salon_customer"
  ON "CustomerCampaignWallet" ("salonId", "customerId");

CREATE INDEX IF NOT EXISTS "idx_campaign_enrollment_salon_status"
  ON "CustomerCampaignEnrollment" ("salonId", "status");

CREATE INDEX IF NOT EXISTS "idx_campaign_share_link_salon_status"
  ON "CampaignShareLink" ("salonId", "status");

CREATE INDEX IF NOT EXISTS "idx_campaign_attr_salon_campaign_status"
  ON "CampaignAttribution" ("salonId", "campaignId", "status");

CREATE INDEX IF NOT EXISTS "idx_campaign_attr_share_link"
  ON "CampaignAttribution" ("shareLinkId");
