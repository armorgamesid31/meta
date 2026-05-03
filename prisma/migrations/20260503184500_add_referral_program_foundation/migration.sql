-- add_referral_program_foundation
DO $$ BEGIN
  CREATE TYPE "ReferralInviteStatus" AS ENUM ('QUALIFIED','REWARDED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING','APPLIED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ReferralCode" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ReferralInvite" (
  "id" SERIAL PRIMARY KEY,
  "referralCodeId" INTEGER NOT NULL,
  "referrerSalonId" INTEGER NOT NULL,
  "referredSalonId" INTEGER NOT NULL,
  "status" "ReferralInviteStatus" NOT NULL DEFAULT 'QUALIFIED',
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ReferralReward" (
  "id" SERIAL PRIMARY KEY,
  "referralInviteId" INTEGER NOT NULL,
  "salonId" INTEGER NOT NULL,
  "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
  "rewardType" TEXT NOT NULL DEFAULT 'FREE_MONTH',
  "notes" TEXT,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReferralCode_code_key" ON "ReferralCode"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_referral_invite_referred_salon" ON "ReferralInvite"("referredSalonId");
CREATE INDEX IF NOT EXISTS "idx_referral_code_salon_active" ON "ReferralCode"("salonId","isActive");
CREATE INDEX IF NOT EXISTS "idx_referral_invite_referrer_status" ON "ReferralInvite"("referrerSalonId","status");
CREATE INDEX IF NOT EXISTS "idx_referral_reward_salon_status" ON "ReferralReward"("salonId","status");

DO $$ BEGIN
  ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_referrerSalonId_fkey" FOREIGN KEY ("referrerSalonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralInvite" ADD CONSTRAINT "ReferralInvite_referredSalonId_fkey" FOREIGN KEY ("referredSalonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_referralInviteId_fkey" FOREIGN KEY ("referralInviteId") REFERENCES "ReferralInvite"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
