-- CreateEnum
CREATE TYPE "CustomerPhoneVerificationPurpose" AS ENUM ('BOOKING_REGISTER');

-- CreateEnum
CREATE TYPE "CustomerPhoneVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CustomerPhoneVerification" (
    "id" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "purpose" "CustomerPhoneVerificationPurpose" NOT NULL,
    "deliveryChannel" "ChannelType" NOT NULL DEFAULT 'WHATSAPP',
    "countryIso" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "CustomerPhoneVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "codeHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(6) NOT NULL,
    "lastSentAt" TIMESTAMP(6),
    "lastAttemptAt" TIMESTAMP(6),
    "verifiedAt" TIMESTAMP(6),
    "consumedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPhoneVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_customer_phone_verification_phone_status" ON "CustomerPhoneVerification"("salonId", "phone", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "idx_customer_phone_verification_customer_salon" ON "CustomerPhoneVerification"("customerId", "salonId");

-- AddForeignKey
ALTER TABLE "CustomerPhoneVerification" ADD CONSTRAINT "CustomerPhoneVerification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomerPhoneVerification" ADD CONSTRAINT "CustomerPhoneVerification_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
