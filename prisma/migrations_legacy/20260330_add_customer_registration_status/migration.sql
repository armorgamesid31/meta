CREATE TYPE "CustomerRegistrationStatus" AS ENUM ('PENDING', 'VERIFIED');

ALTER TABLE "Customer"
  ADD COLUMN "registrationStatus" "CustomerRegistrationStatus" NOT NULL DEFAULT 'VERIFIED';
