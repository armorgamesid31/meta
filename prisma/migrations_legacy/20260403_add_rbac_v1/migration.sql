-- Alter SalonUser for operational access management
ALTER TABLE "SalonUser"
  ADD COLUMN IF NOT EXISTS "displayName" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(6);

-- Permission catalog
CREATE TABLE IF NOT EXISTS "PermissionDefinition" (
  "id" SERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "description" TEXT,
  "isCritical" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_permission_definition_key" ON "PermissionDefinition"("key");

-- Role matrix per salon
CREATE TABLE IF NOT EXISTS "SalonRolePermission" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "permissionId" INTEGER NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT true,
  "updatedByUserId" INTEGER,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_salon_role_permission_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_salon_role_permission_permission" FOREIGN KEY ("permissionId") REFERENCES "PermissionDefinition"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_salon_role_permission_updated_by" FOREIGN KEY ("updatedByUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_salon_role_permission" ON "SalonRolePermission"("salonId", "role", "permissionId");
CREATE INDEX IF NOT EXISTS "idx_salon_role_permission_salon_role" ON "SalonRolePermission"("salonId", "role");

-- Per-user overrides
CREATE TABLE IF NOT EXISTS "UserPermissionOverride" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "permissionId" INTEGER NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "reason" TEXT,
  "expiresAt" TIMESTAMP(6),
  "updatedByUserId" INTEGER,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_user_permission_override_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_user_permission_override_user" FOREIGN KEY ("userId") REFERENCES "SalonUser"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_user_permission_override_permission" FOREIGN KEY ("permissionId") REFERENCES "PermissionDefinition"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_user_permission_override_updated_by" FOREIGN KEY ("updatedByUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_permission_override" ON "UserPermissionOverride"("salonId", "userId", "permissionId");
CREATE INDEX IF NOT EXISTS "idx_user_permission_override_salon_user" ON "UserPermissionOverride"("salonId", "userId");

-- Access governance audit trail
CREATE TABLE IF NOT EXISTS "AccessAuditLog" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "actorUserId" INTEGER,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_access_audit_salon" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_access_audit_actor" FOREIGN KEY ("actorUserId") REFERENCES "SalonUser"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_access_audit_salon_created" ON "AccessAuditLog"("salonId", "createdAt");

-- Optional staff linkage uniqueness (one account per staff)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_staff_userId" ON "Staff"("userId") WHERE "userId" IS NOT NULL;
