-- Scheduled deletion with a 30-day grace period for accounts and
-- salons. Set deletionScheduledAt to the target hard-delete time;
-- the daily cron in jobs/scheduledDeletions sweeps rows whose
-- deletionScheduledAt has passed. Setting it back to NULL cancels
-- the deletion (user changed their mind during grace).

ALTER TABLE "UserIdentity" ADD COLUMN IF NOT EXISTS "deletionScheduledAt" TIMESTAMP(6);
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "deletionScheduledAt" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "idx_user_identity_deletion_scheduled"
  ON "UserIdentity" ("deletionScheduledAt")
  WHERE "deletionScheduledAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_salon_deletion_scheduled"
  ON "Salon" ("deletionScheduledAt")
  WHERE "deletionScheduledAt" IS NOT NULL;
