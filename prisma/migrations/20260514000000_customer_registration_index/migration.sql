-- Wave 2A follow-up: schema.prisma added
--   Customer.@@index([salonId, registrationStatus], map: "idx_customer_salon_registration_status")
-- but the corresponding DDL was never migrated. This catches it up.
--
-- Idempotent (IF NOT EXISTS) so it is safe to apply on environments
-- where someone may have created the index manually.

CREATE INDEX IF NOT EXISTS "idx_customer_salon_registration_status"
  ON "public"."Customer"("salonId" ASC, "registrationStatus" ASC);
