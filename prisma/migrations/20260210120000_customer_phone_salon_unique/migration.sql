-- DropIndex
DROP INDEX IF EXISTS "Customer_phone_key";

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_salonId_key" ON "Customer"("phone", "salonId");
