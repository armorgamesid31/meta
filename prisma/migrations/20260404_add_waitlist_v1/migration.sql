-- CreateEnum
CREATE TYPE "WaitlistEntrySource" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "WaitlistEntryStatus" AS ENUM ('PENDING', 'OFFERED', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WaitlistOfferChannel" AS ENUM ('WHATSAPP', 'WEB_LINK');

-- CreateEnum
CREATE TYPE "WaitlistOfferStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WAITLIST_OFFER_CREATED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WAITLIST_OFFER_EXPIRED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WAITLIST_OFFER_ACCEPTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'WAITLIST_MATCH_FOUND';

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "source" "WaitlistEntrySource" NOT NULL,
    "status" "WaitlistEntryStatus" NOT NULL DEFAULT 'PENDING',
    "requestDate" DATE NOT NULL,
    "windowStartMinute" INTEGER NOT NULL,
    "windowEndMinute" INTEGER NOT NULL,
    "groups" JSONB NOT NULL,
    "preferredStaffIds" JSONB,
    "latestOfferId" INTEGER,
    "latestMatchedAt" TIMESTAMP(6),
    "closedAt" TIMESTAMP(6),
    "notes" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistOffer" (
    "id" SERIAL NOT NULL,
    "waitlistEntryId" INTEGER NOT NULL,
    "salonId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "channel" "WaitlistOfferChannel" NOT NULL,
    "status" "WaitlistOfferStatus" NOT NULL DEFAULT 'PENDING',
    "slotDate" DATE NOT NULL,
    "slotStartMinute" INTEGER NOT NULL,
    "slotEndMinute" INTEGER NOT NULL,
    "slotPayload" JSONB NOT NULL,
    "offerUrl" TEXT,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "sentAt" TIMESTAMP(6),
    "acceptedAt" TIMESTAMP(6),
    "rejectedAt" TIMESTAMP(6),
    "failedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaitlistOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_waitlist_entry_day_status_created" ON "WaitlistEntry"("salonId", "requestDate", "status", "createdAt");
CREATE INDEX "idx_waitlist_entry_customer_salon" ON "WaitlistEntry"("customerId", "salonId");
CREATE INDEX "idx_waitlist_offer_day_status_exp" ON "WaitlistOffer"("salonId", "slotDate", "status", "expiresAt");
CREATE INDEX "idx_waitlist_offer_entry_created" ON "WaitlistOffer"("waitlistEntryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "uq_waitlist_offer_token" ON "WaitlistOffer"("token");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
