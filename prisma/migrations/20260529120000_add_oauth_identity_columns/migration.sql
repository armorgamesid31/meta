-- OAuth (Google/Apple) sign-in support on UserIdentity.
--
-- passwordHash becomes nullable so identities that authenticate only
-- via Google or Apple don't need a placeholder hash. googleSub and
-- appleSub store the provider's stable user id (the `sub` claim);
-- both are unique so a provider account is bound to at most one
-- identity. Existing rows are unaffected — passwordHash stays set,
-- googleSub/appleSub default to NULL.

ALTER TABLE "UserIdentity" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "UserIdentity" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "UserIdentity" ADD COLUMN "appleSub" TEXT;
CREATE UNIQUE INDEX "uq_user_identity_google_sub" ON "UserIdentity"("googleSub");
CREATE UNIQUE INDEX "uq_user_identity_apple_sub" ON "UserIdentity"("appleSub");
