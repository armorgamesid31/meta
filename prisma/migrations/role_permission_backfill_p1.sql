-- Role permission matrix drift backfill.
--
-- DEFAULT_ROLE_PERMISSIONS in services/accessControl.ts says
-- MANAGER (and the other roles) should have a specific list of
-- permission keys. ensureSalonAccessSeed() only writes those rows
-- on a salon's first seed — so any permission added to the
-- catalog later (access.users.manage, access.roles.manage,
-- timeoff.manage, etc.) is silently missing from existing salons'
-- role matrices.
--
-- Concrete symptom: an OWNER who is also a MANAGER in another
-- salon (via secondaryRoles) doesn't see the "Ekip Üyeleri" tab
-- there because MANAGER's row for access.users.manage was never
-- inserted on the original seed.
--
-- This migration backfills, idempotently, every (salonId, role,
-- permissionId) row that the current DEFAULT_ROLE_PERMISSIONS
-- table implies should exist. We don't grant OWNER explicitly
-- because the access-control code already short-circuits OWNER
-- to "all catalog permissions", but we still seed it for
-- consistency with the rest of the matrix and to keep the role
-- editor UI honest.
--
-- Idempotent via ON CONFLICT DO NOTHING — re-running is safe.

BEGIN;

-- The DEFAULT_ROLE_PERMISSIONS map, expressed as a values list.
-- Keep this in lock-step with services/accessControl.ts
-- whenever new permission keys are added or role defaults shift.
WITH desired_grants(role, key) AS (
  VALUES
    -- OWNER and MANAGER get every permission in the catalog.
    -- We expand the catalog with a join below for those two.
    ('OWNER', NULL::text),
    ('MANAGER', NULL::text)
), expanded AS (
  -- OWNER + MANAGER: every catalog key.
  SELECT dg.role, pd.key
  FROM desired_grants dg
  CROSS JOIN "PermissionDefinition" pd
  WHERE dg.role IN ('OWNER', 'MANAGER')

  UNION ALL

  -- RECEPTION
  SELECT 'RECEPTION', key FROM (VALUES
    ('appointments.view'),
    ('appointments.manage'),
    ('customers.view'),
    ('customers.manage'),
    ('campaigns.view'),
    ('packages.manage'),
    ('blacklist.manage'),
    ('conversations.manage'),
    ('instagram_inbox.manage'),
    ('imports.manage'),
    ('timeoff.manage'),
    ('salon.faq.manage'),
    ('referrals.view'),
    ('notifications.inbox.view'),
    ('notifications.preferences.manage')
  ) AS k(key)

  UNION ALL

  -- STAFF
  SELECT 'STAFF', key FROM (VALUES
    ('appointments.view'),
    ('appointments.manage'),
    ('customers.view'),
    ('customers.manage'),
    ('campaigns.view'),
    ('blacklist.manage'),
    ('conversations.manage'),
    ('notifications.inbox.view'),
    ('notifications.preferences.manage')
  ) AS k(key)

  UNION ALL

  -- FINANCE
  SELECT 'FINANCE', key FROM (VALUES
    ('analytics.view'),
    ('inventory.manage'),
    ('campaigns.manage'),
    ('campaigns.view'),
    ('notifications.inbox.view'),
    ('notifications.preferences.manage')
  ) AS k(key)
),
resolved AS (
  SELECT
    s.id          AS "salonId",
    e.role        AS role,
    pd.id         AS "permissionId"
  FROM "Salon" s
  CROSS JOIN expanded e
  JOIN "PermissionDefinition" pd ON pd.key = e.key
  -- Skip salons that have never been seeded at all. The first
  -- login through ensureSalonAccessSeed will do the right thing
  -- for fresh tenants; this migration only fixes drift on salons
  -- that ARE seeded but missing newer keys.
  WHERE EXISTS (
    SELECT 1 FROM "SalonRolePermission" srp WHERE srp."salonId" = s.id
  )
)
INSERT INTO "SalonRolePermission" ("salonId", role, "permissionId", granted)
SELECT "salonId", role, "permissionId", true
FROM resolved
ON CONFLICT ("salonId", role, "permissionId") DO NOTHING;

COMMIT;
