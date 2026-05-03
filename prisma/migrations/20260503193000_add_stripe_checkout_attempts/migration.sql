CREATE TABLE IF NOT EXISTS "StripeCheckoutAttempt" (
  "id" SERIAL PRIMARY KEY,
  "stripeCheckoutSessionId" TEXT NOT NULL,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "planKey" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "ownerEmail" TEXT NOT NULL,
  "ownerPhone" TEXT NOT NULL,
  "salonNameDraft" TEXT,
  "referralCode" TEXT,
  "status" TEXT NOT NULL,
  "paymentStatus" TEXT,
  "amountTotal" INTEGER,
  "currency" TEXT,
  "expiresAt" TIMESTAMP(6),
  "completedAt" TIMESTAMP(6),
  "failedAt" TIMESTAMP(6),
  "abandonedAt" TIMESTAMP(6),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCheckoutAttempt_stripeCheckoutSessionId_key"
  ON "StripeCheckoutAttempt"("stripeCheckoutSessionId");

CREATE INDEX IF NOT EXISTS "idx_stripe_checkout_attempt_status_created"
  ON "StripeCheckoutAttempt"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_stripe_checkout_attempt_owner_email_created"
  ON "StripeCheckoutAttempt"("ownerEmail", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_stripe_checkout_attempt_subscription"
  ON "StripeCheckoutAttempt"("stripeSubscriptionId");
