CREATE TABLE IF NOT EXISTS "UserIdentity" (
  "id" SERIAL PRIMARY KEY,
  "phone" TEXT,
  "email" TEXT,
  "passwordHash" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "displayName" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_identity_phone" ON "UserIdentity"("phone") WHERE "phone" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_identity_email" ON "UserIdentity"("email") WHERE "email" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "SalonMembership" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "identityId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "secondaryRoles" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "passwordResetRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastLoginAt" TIMESTAMP(6),
  "legacySalonUserId" INTEGER,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_membership_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_membership_identity" FOREIGN KEY ("identityId") REFERENCES "UserIdentity"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_membership_legacy_user" FOREIGN KEY ("legacySalonUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_membership_salon_identity" ON "SalonMembership"("salonId", "identityId");
CREATE INDEX IF NOT EXISTS "idx_membership_identity_active" ON "SalonMembership"("identityId", "isActive");
CREATE INDEX IF NOT EXISTS "idx_membership_salon_role" ON "SalonMembership"("salonId", "role");

ALTER TABLE "MobileAuthSession" ADD COLUMN IF NOT EXISTS "identityId" INTEGER;
ALTER TABLE "MobileAuthSession" ADD COLUMN IF NOT EXISTS "membershipId" INTEGER;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "invitedMembershipId" INTEGER;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "invitedIdentityPhone" TEXT;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "invitedIdentityEmail" TEXT;
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "membershipId" INTEGER;
ALTER TABLE "UserPermissionOverride" ADD COLUMN IF NOT EXISTS "membershipId" INTEGER;
ALTER TABLE "AccessAuditLog" ADD COLUMN IF NOT EXISTS "actorMembershipId" INTEGER;
ALTER TABLE "AccessAuditLog" ADD COLUMN IF NOT EXISTS "actorIdentityId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mobile_auth_identity') THEN
    ALTER TABLE "MobileAuthSession" ADD CONSTRAINT "fk_mobile_auth_identity" FOREIGN KEY ("identityId") REFERENCES "UserIdentity"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mobile_auth_membership') THEN
    ALTER TABLE "MobileAuthSession" ADD CONSTRAINT "fk_mobile_auth_membership" FOREIGN KEY ("membershipId") REFERENCES "SalonMembership"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invite_membership') THEN
    ALTER TABLE "Invite" ADD CONSTRAINT "fk_invite_membership" FOREIGN KEY ("invitedMembershipId") REFERENCES "SalonMembership"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_staff_membership') THEN
    ALTER TABLE "Staff" ADD CONSTRAINT "fk_staff_membership" FOREIGN KEY ("membershipId") REFERENCES "SalonMembership"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_override_membership') THEN
    ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "fk_override_membership" FOREIGN KEY ("membershipId") REFERENCES "SalonMembership"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill identities (phone first)
INSERT INTO "UserIdentity" ("phone", "email", "passwordHash", "firstName", "lastName", "displayName", "isActive", "createdAt", "updatedAt")
SELECT DISTINCT ON (COALESCE(NULLIF("phone", ''), CONCAT('email:', LOWER("email"))))
  NULLIF("phone", ''),
  LOWER("email"),
  "passwordHash",
  "firstName",
  "lastName",
  "displayName",
  COALESCE("isActive", TRUE),
  COALESCE("createdAt", CURRENT_TIMESTAMP),
  COALESCE("updatedAt", CURRENT_TIMESTAMP)
FROM "SalonUser"
ORDER BY COALESCE(NULLIF("phone", ''), CONCAT('email:', LOWER("email"))), COALESCE("updatedAt", "createdAt") DESC, "id" DESC
ON CONFLICT DO NOTHING;

-- Backfill memberships
INSERT INTO "SalonMembership" ("salonId", "identityId", "role", "secondaryRoles", "isActive", "passwordResetRequired", "lastLoginAt", "legacySalonUserId", "createdAt", "updatedAt")
SELECT
  su."salonId",
  ui."id" AS "identityId",
  su."role",
  su."secondaryRoles",
  COALESCE(su."isActive", TRUE),
  COALESCE(su."passwordResetRequired", FALSE),
  su."lastLoginAt",
  su."id" AS "legacySalonUserId",
  su."createdAt",
  su."updatedAt"
FROM "SalonUser" su
JOIN "UserIdentity" ui
  ON (NULLIF(su."phone", '') IS NOT NULL AND ui."phone" = NULLIF(su."phone", ''))
  OR (NULLIF(su."phone", '') IS NULL AND ui."email" = LOWER(su."email"))
ON CONFLICT ("salonId", "identityId") DO UPDATE
SET
  "role" = EXCLUDED."role",
  "secondaryRoles" = EXCLUDED."secondaryRoles",
  "isActive" = EXCLUDED."isActive",
  "passwordResetRequired" = EXCLUDED."passwordResetRequired",
  "lastLoginAt" = EXCLUDED."lastLoginAt",
  "legacySalonUserId" = EXCLUDED."legacySalonUserId";

-- Backfill session references
UPDATE "MobileAuthSession" mas
SET
  "identityId" = sm."identityId",
  "membershipId" = sm."id"
FROM "SalonMembership" sm
WHERE sm."legacySalonUserId" = mas."userId"
  AND sm."salonId" = mas."salonId"
  AND (mas."identityId" IS NULL OR mas."membershipId" IS NULL);

-- Backfill invite membership refs
UPDATE "Invite" i
SET
  "invitedMembershipId" = sm."id",
  "invitedIdentityPhone" = ui."phone",
  "invitedIdentityEmail" = ui."email"
FROM "SalonMembership" sm
JOIN "UserIdentity" ui ON ui."id" = sm."identityId"
WHERE sm."legacySalonUserId" = i."invitedUserId"
  AND i."invitedMembershipId" IS NULL;

-- Backfill staff and overrides
UPDATE "Staff" s
SET "membershipId" = sm."id"
FROM "SalonMembership" sm
WHERE sm."legacySalonUserId" = s."userId"
  AND s."membershipId" IS NULL;

UPDATE "UserPermissionOverride" upo
SET "membershipId" = sm."id"
FROM "SalonMembership" sm
WHERE sm."legacySalonUserId" = upo."userId"
  AND upo."membershipId" IS NULL;

UPDATE "AccessAuditLog" aal
SET
  "actorMembershipId" = sm."id",
  "actorIdentityId" = sm."identityId"
FROM "SalonMembership" sm
WHERE sm."legacySalonUserId" = aal."actorUserId"
  AND (aal."actorMembershipId" IS NULL OR aal."actorIdentityId" IS NULL);

CREATE INDEX IF NOT EXISTS "idx_mobile_auth_membership" ON "MobileAuthSession"("membershipId", "salonId");
CREATE INDEX IF NOT EXISTS "idx_staff_membership" ON "Staff"("membershipId");
CREATE INDEX IF NOT EXISTS "idx_override_membership" ON "UserPermissionOverride"("salonId", "membershipId");
