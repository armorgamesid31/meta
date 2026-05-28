-- Snapshot which ServiceVariant a line was booked with. NULL = the
-- booking used Service.price / Service.duration (no variant in play).
-- We key by variant id rather than re-deriving from (serviceId, gender)
-- at read time so a later edit/delete of the variant row doesn't
-- silently rewrite history — the line keeps pointing at the same row,
-- and if that row is later deleted the FK SETs NULL and the line falls
-- back to Service.price/duration for display.

ALTER TABLE "AppointmentLine"
  ADD COLUMN "serviceVariantId" INTEGER;

ALTER TABLE "AppointmentLine"
  ADD CONSTRAINT "AppointmentLine_serviceVariantId_fkey"
  FOREIGN KEY ("serviceVariantId") REFERENCES "ServiceVariant"("id")
  ON UPDATE NO ACTION ON DELETE SET NULL;

CREATE INDEX "idx_appointment_line_service_variant"
  ON "AppointmentLine" ("serviceVariantId");
