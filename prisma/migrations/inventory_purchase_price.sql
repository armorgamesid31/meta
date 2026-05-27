-- Inventory: add optional purchase price (COGS) alongside the existing
-- sales price column. Allows margin reporting and per-item COGS without
-- breaking the legacy `price` field.

ALTER TABLE "InventoryItem"
ADD COLUMN IF NOT EXISTS "purchasePrice" DOUBLE PRECISION;
