-- 1) AppointmentLine enum + table
DO $$ BEGIN
  CREATE TYPE "AppointmentLineStatus" AS ENUM ('BOOKED', 'CANCELLED', 'NO_SHOW', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "AppointmentLine" (
  "id" SERIAL PRIMARY KEY,
  "appointmentId" INTEGER NOT NULL,
  "salonId" INTEGER NOT NULL,
  "customerId" INTEGER,
  "serviceId" INTEGER NOT NULL,
  "specialistId" INTEGER,
  "startTime" TIMESTAMP(6),
  "endTime" TIMESTAMP(6),
  "durationMinutes" INTEGER,
  "listPrice" DOUBLE PRECISION,
  "finalPrice" DOUBLE PRECISION,
  "status" "AppointmentLineStatus" DEFAULT 'BOOKED',
  "paymentMethod" "PaymentMethod",
  "paymentRecordedAt" TIMESTAMP(6),
  "regionInfo" JSONB,
  "groupInfo" JSONB,
  "notes" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_appointment_line_appointment_order" ON "AppointmentLine"("appointmentId", "orderIndex");
CREATE INDEX IF NOT EXISTS "idx_appointment_line_salon_status" ON "AppointmentLine"("salonId", "status");

ALTER TABLE "AppointmentLine"
  ADD CONSTRAINT "AppointmentLine_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "AppointmentLine"
  ADD CONSTRAINT "AppointmentLine_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "AppointmentLine"
  ADD CONSTRAINT "AppointmentLine_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "AppointmentLine"
  ADD CONSTRAINT "AppointmentLine_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "AppointmentLine"
  ADD CONSTRAINT "AppointmentLine_specialistId_fkey"
  FOREIGN KEY ("specialistId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Keep future inserts in sync (legacy create paths stay compatible)
CREATE OR REPLACE FUNCTION create_default_appointment_line_after_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "AppointmentLine" (
    "appointmentId",
    "salonId",
    "customerId",
    "serviceId",
    "specialistId",
    "startTime",
    "endTime",
    "durationMinutes",
    "listPrice",
    "finalPrice",
    "status",
    "paymentMethod",
    "paymentRecordedAt",
    "notes",
    "orderIndex",
    "createdAt",
    "updatedAt"
  )
  SELECT
    NEW."id",
    NEW."salonId",
    NEW."customerId",
    NEW."serviceId",
    NEW."staffId",
    NEW."startTime",
    NEW."endTime",
    GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (NEW."endTime" - NEW."startTime")) / 60))::INTEGER,
    NEW."listPrice",
    NEW."finalPrice",
    CASE
      WHEN NEW."status" = 'BOOKED' THEN 'BOOKED'::"AppointmentLineStatus"
      WHEN NEW."status" = 'CANCELLED' THEN 'CANCELLED'::"AppointmentLineStatus"
      WHEN NEW."status" = 'NO_SHOW' THEN 'NO_SHOW'::"AppointmentLineStatus"
      WHEN NEW."status" = 'COMPLETED' THEN 'COMPLETED'::"AppointmentLineStatus"
      ELSE 'BOOKED'::"AppointmentLineStatus"
    END,
    NEW."paymentMethod",
    NEW."paymentRecordedAt",
    NEW."notes",
    0,
    COALESCE(NEW."createdAt", CURRENT_TIMESTAMP),
    COALESCE(NEW."updatedAt", CURRENT_TIMESTAMP)
  WHERE NOT EXISTS (
    SELECT 1 FROM "AppointmentLine" l WHERE l."appointmentId" = NEW."id"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_default_appointment_line_after_insert ON "Appointment";
CREATE TRIGGER trg_create_default_appointment_line_after_insert
AFTER INSERT ON "Appointment"
FOR EACH ROW
EXECUTE FUNCTION create_default_appointment_line_after_insert();

-- 2) Backfill existing appointments with one line each (idempotent)
INSERT INTO "AppointmentLine" (
  "appointmentId",
  "salonId",
  "customerId",
  "serviceId",
  "specialistId",
  "startTime",
  "endTime",
  "durationMinutes",
  "listPrice",
  "finalPrice",
  "status",
  "paymentMethod",
  "paymentRecordedAt",
  "notes",
  "orderIndex",
  "createdAt",
  "updatedAt"
)
SELECT
  a."id",
  a."salonId",
  a."customerId",
  a."serviceId",
  a."staffId",
  a."startTime",
  a."endTime",
  GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")) / 60))::INTEGER,
  a."listPrice",
  a."finalPrice",
  CASE
    WHEN a."status" = 'BOOKED' THEN 'BOOKED'::"AppointmentLineStatus"
    WHEN a."status" = 'CANCELLED' THEN 'CANCELLED'::"AppointmentLineStatus"
    WHEN a."status" = 'NO_SHOW' THEN 'NO_SHOW'::"AppointmentLineStatus"
    WHEN a."status" = 'COMPLETED' THEN 'COMPLETED'::"AppointmentLineStatus"
    ELSE 'BOOKED'::"AppointmentLineStatus"
  END,
  a."paymentMethod",
  a."paymentRecordedAt",
  a."notes",
  0,
  COALESCE(a."createdAt", CURRENT_TIMESTAMP),
  COALESCE(a."updatedAt", CURRENT_TIMESTAMP)
FROM "Appointment" a
WHERE NOT EXISTS (
  SELECT 1 FROM "AppointmentLine" l WHERE l."appointmentId" = a."id"
);

-- 3) Extend package consumption with appointmentLineId
ALTER TABLE "AppointmentPackageConsumption"
  ADD COLUMN IF NOT EXISTS "appointmentLineId" INTEGER;

ALTER TABLE "PackageLedger"
  ADD COLUMN IF NOT EXISTS "appointmentLineId" INTEGER;

-- Best-effort line assignment for existing consumptions
UPDATE "AppointmentPackageConsumption" c
SET "appointmentLineId" = l."id"
FROM "AppointmentLine" l
WHERE c."appointmentLineId" IS NULL
  AND l."appointmentId" = c."appointmentId"
  AND l."serviceId" = c."serviceId"
  AND l."orderIndex" = (
    SELECT MIN(l2."orderIndex")
    FROM "AppointmentLine" l2
    WHERE l2."appointmentId" = c."appointmentId"
      AND l2."serviceId" = c."serviceId"
  );

ALTER TABLE "AppointmentPackageConsumption"
  DROP CONSTRAINT IF EXISTS "uq_appointment_pkg_consumption";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_appointment_pkg_consumption_line"
ON "AppointmentPackageConsumption"("appointmentId", "appointmentLineId", "serviceId");

ALTER TABLE "AppointmentPackageConsumption"
  ADD CONSTRAINT "AppointmentPackageConsumption_appointmentLineId_fkey"
  FOREIGN KEY ("appointmentLineId") REFERENCES "AppointmentLine"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "idx_pkg_ledger_appointment_line" ON "PackageLedger"("appointmentLineId");

ALTER TABLE "PackageLedger"
  ADD CONSTRAINT "PackageLedger_appointmentLineId_fkey"
  FOREIGN KEY ("appointmentLineId") REFERENCES "AppointmentLine"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
