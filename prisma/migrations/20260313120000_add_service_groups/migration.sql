-- Add service grouping support for salon-defined bundles
ALTER TABLE "Service"
ADD COLUMN "serviceGroupId" INTEGER;

CREATE TABLE "ServiceGroup" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "displayOrder" INTEGER,
  "capacity" INTEGER DEFAULT 1,
  "sequentialRequired" BOOLEAN DEFAULT false,
  "preparationMinutes" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_service_group_salon_display_order" ON "ServiceGroup"("salonId", "displayOrder");
CREATE UNIQUE INDEX "uq_service_group_name_per_salon" ON "ServiceGroup"("salonId", "name");

ALTER TABLE "ServiceGroup"
ADD CONSTRAINT "ServiceGroup_salonId_fkey"
FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "Service"
ADD CONSTRAINT "Service_serviceGroupId_fkey"
FOREIGN KEY ("serviceGroupId") REFERENCES "ServiceGroup"("id")
ON DELETE SET NULL ON UPDATE NO ACTION;
