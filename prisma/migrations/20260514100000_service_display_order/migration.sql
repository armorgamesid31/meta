-- Adds per-category ordering to Service so the admin UI can render
-- services within a category in a stable, drag-droppable order.
--
-- Idempotent: safe to re-apply. Existing rows get displayOrder=0; the
-- reorder endpoint (POST /api/admin/mobile/services/reorder) is what
-- assigns real positions.

ALTER TABLE "public"."Service"
  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_service_salon_category_display"
  ON "public"."Service"("salonId" ASC, "categoryId" ASC, "displayOrder" ASC);
