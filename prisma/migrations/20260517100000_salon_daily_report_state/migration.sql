-- Per-salon state machine for the day-end report flow.
--
-- The report should only fire AFTER every appointment for the day has
-- reached a finalized status (COMPLETED / CANCELLED / NO_SHOW). When
-- there are still BOOKED entries past workEndHour the sweep instead
-- nudges the staff to close them out, retrying every 30 minutes up to
-- 3 times. Once everything is closed the report goes out, and the
-- state row is marked so we never re-send it the same day.

CREATE TABLE "SalonDailyReportState" (
  "id"             SERIAL PRIMARY KEY,
  "salonId"        INTEGER NOT NULL,
  "reportDate"     TEXT NOT NULL,
  "reportSentAt"   TIMESTAMP(6),
  "lastReminderAt" TIMESTAMP(6),
  "reminderCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "uq_salon_daily_report_state_salon_date"
  ON "SalonDailyReportState"("salonId", "reportDate");

CREATE INDEX "idx_salon_daily_report_state_salon_date"
  ON "SalonDailyReportState"("salonId", "reportDate");
