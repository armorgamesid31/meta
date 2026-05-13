-- Add plaintext activation code to StripeCheckoutAttempt for read-once
-- delivery to the marketing checkout success page. The column stays NULL
-- for all rows except COMPLETED ones where webhook provisioning succeeded.
ALTER TABLE "StripeCheckoutAttempt"
  ADD COLUMN IF NOT EXISTS "activationCode" TEXT;
