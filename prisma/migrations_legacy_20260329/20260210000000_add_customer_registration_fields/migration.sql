-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('male', 'female', 'other');

-- DropIndex
DROP INDEX IF EXISTS "Customer_phone_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "gender" "CustomerGender",
ADD COLUMN "birthDate" DATE,
ADD COLUMN "acceptMarketing" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_salonId_key" ON "Customer"("phone", "salonId");
