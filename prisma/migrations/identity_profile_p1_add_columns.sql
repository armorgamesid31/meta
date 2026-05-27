-- Staff profile → UserIdentity migration, Phase 1 (additive).
--
-- Goal: profile fields (photo, gender, and the canonical display
-- name) should live on the account identity, not on the per-salon
-- Staff row. The same user owning multiple salons currently sees a
-- different profile per salon because each Staff record carries its
-- own firstName/lastName/profileImageUrl/gender. After this
-- migration those values live on UserIdentity and every Staff row
-- linked to a SalonMembership reads from the shared identity.
--
-- Orphan staff (Staff rows with no membershipId, e.g. admin-added
-- walk-in staff without an account) intentionally keep their
-- profile on the Staff row. They have no Identity to migrate to,
-- and the resolver in Phase 3 will fall back to Staff fields for
-- orphans.
--
-- This migration is ADDITIVE only — it adds columns and backfills
-- them. The old Staff columns are NOT dropped here; Phase 6 (a
-- separate migration after the new write/read paths have been
-- stable in production for a week) handles the drop. This means
-- this migration is fully reversible: drop the new columns to
-- roll back.

BEGIN;

-- 1. Add the new columns to UserIdentity. `gender` reuses the
--    existing `CustomerGender` enum so the value space matches
--    Staff.gender (male / female / other) — Prisma already has the
--    type generated and downstream code doesn't need a parallel
--    enum.
ALTER TABLE "UserIdentity"
  ADD COLUMN IF NOT EXISTS "profileImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gender" "CustomerGender";

-- 2. Backfill from Staff for every membership-linked Staff row.
--    When a user owns multiple salons (one Identity → multiple
--    Memberships → multiple Staff rows) we pick the Staff row that
--    was updated most recently as the authoritative source — that
--    matches the user's mental model of "the last edit wins".
WITH picked AS (
  SELECT DISTINCT ON (m."identityId")
    m."identityId"          AS identity_id,
    s."firstName"           AS first_name,
    s."lastName"            AS last_name,
    s."name"                AS display_name,
    s."profileImageUrl"     AS profile_image_url,
    s."gender"              AS gender
  FROM "Staff" s
  JOIN "SalonMembership" m ON s."membershipId" = m.id
  ORDER BY m."identityId", s."updatedAt" DESC NULLS LAST, s."id" DESC
)
UPDATE "UserIdentity" ui
SET
  "firstName"       = COALESCE(NULLIF(ui."firstName", ''),  picked.first_name),
  "lastName"        = COALESCE(NULLIF(ui."lastName", ''),   picked.last_name),
  "displayName"     = COALESCE(NULLIF(ui."displayName", ''),picked.display_name),
  "profileImageUrl" = COALESCE(ui."profileImageUrl",        picked.profile_image_url),
  "gender"          = COALESCE(ui."gender",                 picked.gender)
FROM picked
WHERE ui.id = picked.identity_id;

COMMIT;
