-- referral_first_payment_reward
-- KURAL 3: referral reward fires on the REFERRED salon's FIRST PAID invoice
-- (not at signup). Adds payment-tracking + apply-tracking columns and a
-- (invite, salon) unique on rewards so a referral can never pay out twice.
-- Additive + idempotent (safe to re-run).

ALTER TABLE "ReferralInvite"
  ADD COLUMN IF NOT EXISTS "firstPaymentAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "firstPaymentAppliedAt" TIMESTAMP(6);

ALTER TABLE "ReferralReward"
  ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "stripeCouponId" TEXT;

-- One reward per (invite, beneficiary salon). If pre-existing data somehow
-- holds duplicates this index creation would fail; the referral feature is
-- young and attachReferredSalon always created exactly one reward per invite,
-- so duplicates are not expected. CREATE UNIQUE INDEX IF NOT EXISTS is a
-- no-op on re-run.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_referral_reward_invite_salon"
  ON "ReferralReward"("referralInviteId","salonId");
