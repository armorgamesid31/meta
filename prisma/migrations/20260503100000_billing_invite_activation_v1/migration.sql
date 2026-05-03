DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InviteStatus') THEN
    CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SalonLifecycleStatus') THEN
    CREATE TYPE "SalonLifecycleStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
  END IF;
END
$$;

ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "status" "SalonLifecycleStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "SalonUser" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "SalonUser" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "SalonUser" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "SalonUser" ADD COLUMN IF NOT EXISTS "activationCompletedAt" TIMESTAMP(6);

CREATE TABLE IF NOT EXISTS "SalonSubscription" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "planKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currentPeriodEnd" TIMESTAMP(6),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Invite" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "invitedUserId" INTEGER NOT NULL REFERENCES "SalonUser"("id") ON DELETE CASCADE,
  "inviteCodeHash" TEXT NOT NULL,
  "inviteTokenHash" TEXT NOT NULL,
  "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(6) NOT NULL,
  "acceptedAt" TIMESTAMP(6),
  "revokedAt" TIMESTAMP(6),
  "createdBy" INTEGER REFERENCES "SalonUser"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
  "id" SERIAL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "processedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_salon_user_phone" ON "SalonUser"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "SalonSubscription_stripeCustomerId_key" ON "SalonSubscription"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "SalonSubscription_stripeSubscriptionId_key" ON "SalonSubscription"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "idx_salon_subscription_salon_status" ON "SalonSubscription"("salonId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_inviteCodeHash_key" ON "Invite"("inviteCodeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_inviteTokenHash_key" ON "Invite"("inviteTokenHash");
CREATE INDEX IF NOT EXISTS "idx_invite_salon_status" ON "Invite"("salonId", "status");
CREATE INDEX IF NOT EXISTS "idx_invite_user_status" ON "Invite"("invitedUserId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");
