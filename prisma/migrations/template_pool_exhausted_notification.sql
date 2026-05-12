-- Add TEMPLATE_POOL_EXHAUSTED event type so the submission worker can fire
-- a salon-side AppNotification when all 10 variation slots for a (template,
-- tone) are exhausted without 3 valid approvals.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'TEMPLATE_POOL_EXHAUSTED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'NotificationEventType')
  ) THEN
    ALTER TYPE "NotificationEventType" ADD VALUE 'TEMPLATE_POOL_EXHAUSTED';
  END IF;
END $$;
