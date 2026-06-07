-- Cross-tenant platform staff (Kedy admin / technical support).
-- Adds UserIdentity.platformRole. NULL = ordinary salon user (today's behaviour,
-- unchanged for every existing row). A non-null value lets the account sign into
-- ANY active salon without a SalonMembership (see src/services/platformAccess.ts
-- and src/middleware/auth.ts). Every salon entry is recorded in AccessAuditLog.
--
-- Additive + nullable: no backfill, no rewrite of existing rows, safe to apply
-- before the reading code ships. Reversible with:
--   ALTER TABLE "UserIdentity" DROP COLUMN "platformRole";
ALTER TABLE "UserIdentity" ADD COLUMN IF NOT EXISTS "platformRole" TEXT;
