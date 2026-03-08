ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "address" TEXT;

ALTER TABLE "SalonSettings"
  ADD COLUMN IF NOT EXISTS "workingDays" JSONB;

CREATE TABLE IF NOT EXISTS "InventoryItem" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'adet',
  "currentStock" INTEGER NOT NULL DEFAULT 0,
  "minStock" INTEGER NOT NULL DEFAULT 0,
  "price" DOUBLE PRECISION,
  "supplier" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "InventoryMovement" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "inventoryItemId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" TEXT,
  "createdByUserId" INTEGER,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT,
  "config" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "startsAt" TIMESTAMP(6),
  "endsAt" TIMESTAMP(6),
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AutomationRule" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "config" JSONB,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AnalyticsPreset" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "filters" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "BlacklistEntry" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "customerId" INTEGER,
  "phone" TEXT,
  "fullName" TEXT,
  "reason" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "createdById" INTEGER
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryItem_salonId_fkey') THEN
    ALTER TABLE "InventoryItem"
      ADD CONSTRAINT "InventoryItem_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryMovement_inventoryItemId_fkey') THEN
    ALTER TABLE "InventoryMovement"
      ADD CONSTRAINT "InventoryMovement_inventoryItemId_fkey"
      FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_salonId_fkey') THEN
    ALTER TABLE "Campaign"
      ADD CONSTRAINT "Campaign_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutomationRule_salonId_fkey') THEN
    ALTER TABLE "AutomationRule"
      ADD CONSTRAINT "AutomationRule_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnalyticsPreset_salonId_fkey') THEN
    ALTER TABLE "AnalyticsPreset"
      ADD CONSTRAINT "AnalyticsPreset_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BlacklistEntry_salonId_fkey') THEN
    ALTER TABLE "BlacklistEntry"
      ADD CONSTRAINT "BlacklistEntry_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "idx_inventory_item_salon_active"
  ON "InventoryItem"("salonId", "isActive");

CREATE INDEX IF NOT EXISTS "idx_inventory_movement_salon_item_created"
  ON "InventoryMovement"("salonId", "inventoryItemId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_campaign_salon_type_active"
  ON "Campaign"("salonId", "type", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_automation_rule_salon_key"
  ON "AutomationRule"("salonId", "key");

CREATE INDEX IF NOT EXISTS "idx_automation_rule_salon_enabled"
  ON "AutomationRule"("salonId", "isEnabled");

CREATE INDEX IF NOT EXISTS "idx_analytics_preset_salon"
  ON "AnalyticsPreset"("salonId");

CREATE INDEX IF NOT EXISTS "idx_blacklist_salon_active"
  ON "BlacklistEntry"("salonId", "isActive");
