-- Campaign domain standardization: enum type, lifecycle, execution logs

DO $$ BEGIN
  CREATE TYPE "CampaignType" AS ENUM ('BIRTHDAY', 'WINBACK', 'WELCOME_FIRST_VISIT', 'LOYALTY', 'MULTI_SERVICE_DISCOUNT', 'OFF_PEAK', 'REFERRAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CampaignLifecycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "lifecycleStatus" "CampaignLifecycleStatus" NOT NULL DEFAULT 'DRAFT';

ALTER TABLE "Campaign"
  ALTER COLUMN "type" TYPE "CampaignType"
  USING (
    CASE UPPER("type")
      WHEN 'OFF_PEAK_FILL' THEN 'OFF_PEAK'
      WHEN 'BIRTHDAY' THEN 'BIRTHDAY'
      WHEN 'WINBACK' THEN 'WINBACK'
      WHEN 'WELCOME_FIRST_VISIT' THEN 'WELCOME_FIRST_VISIT'
      WHEN 'LOYALTY' THEN 'LOYALTY'
      WHEN 'MULTI_SERVICE_DISCOUNT' THEN 'MULTI_SERVICE_DISCOUNT'
      WHEN 'OFF_PEAK' THEN 'OFF_PEAK'
      WHEN 'REFERRAL' THEN 'REFERRAL'
      ELSE 'WELCOME_FIRST_VISIT'
    END
  )::"CampaignType";

UPDATE "Campaign"
SET "lifecycleStatus" = CASE
  WHEN "isActive" = true THEN 'ACTIVE'::"CampaignLifecycleStatus"
  ELSE 'DRAFT'::"CampaignLifecycleStatus"
END
WHERE "lifecycleStatus" = 'DRAFT'::"CampaignLifecycleStatus";

CREATE TABLE IF NOT EXISTS "CampaignSendExecution" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "campaignId" INTEGER NOT NULL,
  "executionKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "audienceSize" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_send_execution_key" ON "CampaignSendExecution"("executionKey");
CREATE INDEX IF NOT EXISTS "idx_campaign_send_exec_salon_campaign_created" ON "CampaignSendExecution"("salonId", "campaignId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "CampaignSendExecution"
    ADD CONSTRAINT "CampaignSendExecution_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignSendExecution"
    ADD CONSTRAINT "CampaignSendExecution_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
