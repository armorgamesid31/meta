-- Add BIRTHDAY + WINBACK to AppointmentMessageEventType.
-- Used by kedy_dogum_gunu_kutlamasi and kedy_geri_donus templates.

BEGIN;

DO $$ BEGIN
  ALTER TYPE "AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'BIRTHDAY';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "AppointmentMessageEventType" ADD VALUE IF NOT EXISTS 'WINBACK';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
