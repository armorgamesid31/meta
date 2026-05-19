-- Track which lifecycle reminder emails have been sent for each salon
-- so the cron doesn't double-send. Keyed by milestone code
-- ('setup_d7', 'setup_d11', ..., 'grace_d20', 'payment_required_d0') ->
-- ISO timestamp of the send.

ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "lifecycleReminderState" JSONB;
