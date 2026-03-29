CREATE TABLE IF NOT EXISTS "MobileAuthSession" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "salonId" INTEGER NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(6) NOT NULL,
  "revokedAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_mobile_auth_refresh_token_hash"
  ON "MobileAuthSession"("refreshTokenHash");

CREATE INDEX IF NOT EXISTS "idx_mobile_auth_user_salon"
  ON "MobileAuthSession"("userId", "salonId");

CREATE INDEX IF NOT EXISTS "idx_mobile_auth_salon_expires"
  ON "MobileAuthSession"("salonId", "expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MobileAuthSession_userId_fkey') THEN
    ALTER TABLE "MobileAuthSession"
      ADD CONSTRAINT "MobileAuthSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "SalonUser"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MobileAuthSession_salonId_fkey') THEN
    ALTER TABLE "MobileAuthSession"
      ADD CONSTRAINT "MobileAuthSession_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;
