ALTER TABLE "WaitlistEntry"
  ADD COLUMN "allowNearbyMatches" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nearbyToleranceMinutes" INTEGER NOT NULL DEFAULT 60;
