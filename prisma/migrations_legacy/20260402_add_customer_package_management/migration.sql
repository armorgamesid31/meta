-- Enums
CREATE TYPE "PackageScopeType" AS ENUM ('SINGLE_SERVICE', 'POOL');
CREATE TYPE "PackageSourceType" AS ENUM ('TEMPLATE', 'CUSTOM');
CREATE TYPE "CustomerPackageStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PackageActionType" AS ENUM (
  'ASSIGNED',
  'AUTO_CONSUME',
  'AUTO_RESTORE',
  'MANUAL_ADJUST',
  'SKIPPED_NO_ELIGIBLE_PACKAGE',
  'SKIPPED_EXPIRED'
);

-- Package template tables
CREATE TABLE "PackageTemplate" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "scopeType" "PackageScopeType" NOT NULL DEFAULT 'SINGLE_SERVICE',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "price" DOUBLE PRECISION,
  "validityDays" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackageTemplateService" (
  "id" SERIAL NOT NULL,
  "packageTemplateId" INTEGER NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "initialQuota" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageTemplateService_pkey" PRIMARY KEY ("id")
);

-- Customer package tables
CREATE TABLE "CustomerPackage" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "packageTemplateId" INTEGER,
  "sourceType" "PackageSourceType" NOT NULL,
  "scopeType" "PackageScopeType" NOT NULL DEFAULT 'SINGLE_SERVICE',
  "status" "CustomerPackageStatus" NOT NULL DEFAULT 'ACTIVE',
  "name" TEXT NOT NULL,
  "startsAt" TIMESTAMP(6),
  "expiresAt" TIMESTAMP(6),
  "price" DOUBLE PRECISION,
  "notes" TEXT,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerPackageServiceBalance" (
  "id" SERIAL NOT NULL,
  "customerPackageId" INTEGER NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "initialQuota" INTEGER NOT NULL,
  "remainingQuota" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerPackageServiceBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_customer_pkg_service_nonnegative" CHECK ("remainingQuota" >= 0 AND "initialQuota" >= 0)
);

-- Ledger and consumption
CREATE TABLE "PackageLedger" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "customerPackageId" INTEGER,
  "serviceId" INTEGER,
  "appointmentId" INTEGER,
  "actionType" "PackageActionType" NOT NULL,
  "delta" INTEGER NOT NULL,
  "balanceAfter" INTEGER,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PackageLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentPackageConsumption" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "appointmentId" INTEGER NOT NULL,
  "customerId" INTEGER NOT NULL,
  "customerPackageId" INTEGER NOT NULL,
  "serviceId" INTEGER NOT NULL,
  "consumed" INTEGER NOT NULL DEFAULT 1,
  "restoredAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentPackageConsumption_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "uq_pkg_template_salon_name" ON "PackageTemplate"("salonId", "name");
CREATE UNIQUE INDEX "uq_pkg_template_service" ON "PackageTemplateService"("packageTemplateId", "serviceId");
CREATE UNIQUE INDEX "uq_customer_pkg_balance" ON "CustomerPackageServiceBalance"("customerPackageId", "serviceId");
CREATE UNIQUE INDEX "uq_appointment_pkg_consumption" ON "AppointmentPackageConsumption"("appointmentId", "serviceId");

-- Indexes
CREATE INDEX "idx_pkg_template_salon_active" ON "PackageTemplate"("salonId", "isActive");
CREATE INDEX "idx_pkg_template_service_service" ON "PackageTemplateService"("serviceId");
CREATE INDEX "idx_customer_pkg_salon_customer_status" ON "CustomerPackage"("salonId", "customerId", "status");
CREATE INDEX "idx_customer_pkg_salon_expires" ON "CustomerPackage"("salonId", "expiresAt");
CREATE INDEX "idx_customer_pkg_balance_service" ON "CustomerPackageServiceBalance"("serviceId");
CREATE INDEX "idx_pkg_ledger_salon_customer_created" ON "PackageLedger"("salonId", "customerId", "createdAt");
CREATE INDEX "idx_pkg_ledger_customer_pkg_created" ON "PackageLedger"("customerPackageId", "createdAt");
CREATE INDEX "idx_pkg_ledger_appointment" ON "PackageLedger"("appointmentId");
CREATE INDEX "idx_appointment_pkg_consumption_salon_customer" ON "AppointmentPackageConsumption"("salonId", "customerId");

-- Foreign keys
ALTER TABLE "PackageTemplate"
  ADD CONSTRAINT "PackageTemplate_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "PackageTemplateService"
  ADD CONSTRAINT "PackageTemplateService_packageTemplateId_fkey"
  FOREIGN KEY ("packageTemplateId") REFERENCES "PackageTemplate"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PackageTemplateService"
  ADD CONSTRAINT "PackageTemplateService_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CustomerPackage"
  ADD CONSTRAINT "CustomerPackage_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CustomerPackage"
  ADD CONSTRAINT "CustomerPackage_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CustomerPackage"
  ADD CONSTRAINT "CustomerPackage_packageTemplateId_fkey"
  FOREIGN KEY ("packageTemplateId") REFERENCES "PackageTemplate"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CustomerPackageServiceBalance"
  ADD CONSTRAINT "CustomerPackageServiceBalance_customerPackageId_fkey"
  FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "CustomerPackageServiceBalance"
  ADD CONSTRAINT "CustomerPackageServiceBalance_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "PackageLedger"
  ADD CONSTRAINT "PackageLedger_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PackageLedger"
  ADD CONSTRAINT "PackageLedger_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "PackageLedger"
  ADD CONSTRAINT "PackageLedger_customerPackageId_fkey"
  FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "PackageLedger"
  ADD CONSTRAINT "PackageLedger_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "AppointmentPackageConsumption"
  ADD CONSTRAINT "AppointmentPackageConsumption_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AppointmentPackageConsumption"
  ADD CONSTRAINT "AppointmentPackageConsumption_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AppointmentPackageConsumption"
  ADD CONSTRAINT "AppointmentPackageConsumption_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AppointmentPackageConsumption"
  ADD CONSTRAINT "AppointmentPackageConsumption_customerPackageId_fkey"
  FOREIGN KEY ("customerPackageId") REFERENCES "CustomerPackage"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "AppointmentPackageConsumption"
  ADD CONSTRAINT "AppointmentPackageConsumption_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
