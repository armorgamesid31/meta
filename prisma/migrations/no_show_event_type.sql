-- Add NO_SHOW to AppointmentMessageEventType enum.
-- Used by kedy_no_show_hatirlatma template (sent when customer misses appt).

BEGIN;

DO $$ BEGIN
  ALTER TYPE "AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'NO_SHOW';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
