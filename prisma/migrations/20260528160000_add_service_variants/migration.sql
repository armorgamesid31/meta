-- Per-gender Service overrides (price + duration). When a row exists
-- for a (serviceId, gender) pair, the booking flow MUST use its
-- price/duration instead of the base values on Service. Missing rows
-- = service has no variant for that gender = fall back to base. Old
-- services start with zero variants so nothing breaks on this side.
--
-- The unique constraint guarantees a service can have at most one
-- variant per gender (no duplicate "female" rows). isActive is here
-- so the salon can soft-disable a variant without losing its values
-- for later re-enable; the booking flow treats isActive=false as
-- "fall back to base" just like a missing row.
--
-- displayOrder lets the UI render gender variants in a stable order
-- (male first, female second, or whatever the salon picks) — purely
-- presentational, doesn't change booking semantics.

CREATE TABLE "ServiceVariant" (
  "id"           SERIAL PRIMARY KEY,
  "serviceId"    INTEGER NOT NULL,
  "gender"       "CustomerGender" NOT NULL,
  "price"        DOUBLE PRECISION NOT NULL,
  "duration"     INTEGER NOT NULL,
  "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "ServiceVariant_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
    ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE UNIQUE INDEX "service_variant_unique_per_gender"
  ON "ServiceVariant" ("serviceId", "gender");

CREATE INDEX "idx_service_variant_service_active"
  ON "ServiceVariant" ("serviceId", "isActive");
