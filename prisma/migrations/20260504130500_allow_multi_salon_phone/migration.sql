ALTER TABLE "SalonUser" DROP CONSTRAINT IF EXISTS "uq_salon_user_phone";
CREATE INDEX IF NOT EXISTS "idx_salon_user_phone" ON "SalonUser"("phone");
