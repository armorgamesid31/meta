-- Decouple UserIdentity creation from invite/salon creation.
--
-- Before: an OnboardingSession always pointed at an Invite, and an
-- auth session always had a Salon + SalonUser attached. New flow lets
-- a person register first (no invite, no salon yet), receive an
-- identity-only token, and pick a path afterwards: "open my own
-- salon" via POST /api/salons, or "redeem an invite" via
-- POST /api/auth/invites/redeem.

-- OnboardingSession can now exist without an invite.
ALTER TABLE "OnboardingSession" ALTER COLUMN "inviteId" DROP NOT NULL;
ALTER TABLE "OnboardingSession" ADD COLUMN IF NOT EXISTS "flow" TEXT;
UPDATE "OnboardingSession" SET "flow" = 'INVITE' WHERE "flow" IS NULL;

-- MobileAuthSession can now belong to a UserIdentity that has no salon
-- yet. The legacy SalonUser link (userId) and Salon link (salonId)
-- become nullable. Existing rows are unaffected (they keep their
-- non-null values); only new identity-only sessions will have NULLs.
ALTER TABLE "MobileAuthSession" ALTER COLUMN "salonId" DROP NOT NULL;
ALTER TABLE "MobileAuthSession" ALTER COLUMN "userId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_mobile_auth_identity_expires" ON "MobileAuthSession" ("identityId", "expiresAt");
