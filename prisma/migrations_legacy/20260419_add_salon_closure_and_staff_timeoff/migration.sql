CREATE TABLE IF NOT EXISTS "SalonClosure" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "startAt" TIMESTAMP(6) NOT NULL,
  "endAt" TIMESTAMP(6) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_salon_closure_salon_range"
  ON "SalonClosure"("salonId", "startAt", "endAt");

ALTER TABLE "SalonClosure"
  ADD CONSTRAINT "SalonClosure_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE IF NOT EXISTS "StaffTimeOff" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "staffId" INTEGER NOT NULL,
  "startAt" TIMESTAMP(6) NOT NULL,
  "endAt" TIMESTAMP(6) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_staff_timeoff_salon_staff_range"
  ON "StaffTimeOff"("salonId", "staffId", "startAt", "endAt");

ALTER TABLE "StaffTimeOff"
  ADD CONSTRAINT "StaffTimeOff_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "StaffTimeOff"
  ADD CONSTRAINT "StaffTimeOff_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
