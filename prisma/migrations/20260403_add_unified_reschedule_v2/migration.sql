-- Unified Reschedule V2: preference persistence and appointment lineage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AppointmentPreferenceMode') THEN
    CREATE TYPE "AppointmentPreferenceMode" AS ENUM ('ANY', 'SPECIFIC');
  END IF;
END $$;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "preferenceMode" "AppointmentPreferenceMode" DEFAULT 'ANY',
  ADD COLUMN IF NOT EXISTS "preferredStaffId" INTEGER,
  ADD COLUMN IF NOT EXISTS "rescheduledFromAppointmentId" INTEGER,
  ADD COLUMN IF NOT EXISTS "rescheduleBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_appointment_salon_reschedule_batch"
  ON "Appointment"("salonId", "rescheduleBatchId");

CREATE INDEX IF NOT EXISTS "idx_appointment_rescheduled_from"
  ON "Appointment"("rescheduledFromAppointmentId");

-- Backfill preference fields from legacy notes markers.
UPDATE "Appointment"
SET
  "preferenceMode" = CASE
    WHEN "notes" ~* '\\[BOOK_PREF:SPECIFIC:[0-9]+\\]' THEN 'SPECIFIC'::"AppointmentPreferenceMode"
    ELSE 'ANY'::"AppointmentPreferenceMode"
  END,
  "preferredStaffId" = CASE
    WHEN "notes" ~* '\\[BOOK_PREF:SPECIFIC:[0-9]+\\]'
      THEN NULLIF(regexp_replace("notes", '.*\\[BOOK_PREF:SPECIFIC:([0-9]+)\\].*', '\\1', 'i'), '')::INTEGER
    ELSE NULL
  END
WHERE
  "preferenceMode" IS NULL
  OR "preferredStaffId" IS NULL;
