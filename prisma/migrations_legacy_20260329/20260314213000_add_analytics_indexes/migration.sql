CREATE INDEX IF NOT EXISTS "idx_appointment_salon_start"
  ON "Appointment" ("salonId", "startTime");

CREATE INDEX IF NOT EXISTS "idx_appointment_salon_status_start"
  ON "Appointment" ("salonId", "status", "startTime");

CREATE INDEX IF NOT EXISTS "idx_customer_salon_created"
  ON "Customer" ("salonId", "createdAt");
