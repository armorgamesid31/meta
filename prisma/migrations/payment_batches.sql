-- Migration: Split payment + refund altyapısı
-- ============================================================
-- Adım 1: AppointmentLineStatus enum'a 'REFUNDED' değeri ekle.
--         IF NOT EXISTS Postgres 9.6+'da çalışır; mevcut prod versiyonu
--         bu satırı atlamak isterse yorum satırına alıp manuel ekleyin.
ALTER TYPE "AppointmentLineStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';

-- Adım 2: PaymentBatch — bir müşterinin tek seferde yaptığı tahsilat veya iade.
--   parentBatchId NULL → pozitif tahsilat batch'i
--   parentBatchId DOLU → refund batch'i (Payment.amount NEGATIF olur)
CREATE TABLE IF NOT EXISTS "PaymentBatch" (
  "id"            SERIAL PRIMARY KEY,
  "salonId"       INTEGER NOT NULL,
  "customerId"    INTEGER,
  "totalAmount"   DOUBLE PRECISION NOT NULL,
  "recordedAt"    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"         TEXT,
  "parentBatchId" INTEGER,
  "createdAt"     TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentBatch_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "PaymentBatch_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "PaymentBatch_parentBatchId_fkey"
    FOREIGN KEY ("parentBatchId") REFERENCES "PaymentBatch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_payment_batch_salon_recorded"
  ON "PaymentBatch" ("salonId", "recordedAt");
CREATE INDEX IF NOT EXISTS "idx_payment_batch_customer"
  ON "PaymentBatch" ("customerId");
CREATE INDEX IF NOT EXISTS "idx_payment_batch_parent"
  ON "PaymentBatch" ("parentBatchId");

-- Adım 3: Payment — PaymentBatch'in içindeki ödeme kalemi (yöntem + tutar).
--   Tek-yöntem tahsilatta batch'in 1 Payment'ı olur; split'te 2+.
--   Refund batch'lerinde amount NEGATIF.
CREATE TABLE IF NOT EXISTS "Payment" (
  "id"         SERIAL PRIMARY KEY,
  "batchId"    INTEGER NOT NULL,
  "method"     "PaymentMethod" NOT NULL,
  "amount"     DOUBLE PRECISION NOT NULL,
  "recordedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_payment_batch"
  ON "Payment" ("batchId");
CREATE INDEX IF NOT EXISTS "idx_payment_method"
  ON "Payment" ("method");

-- Adım 4: AppointmentPayment — PaymentBatch ↔ Appointment M2M bağlantı.
--   Bir tahsilat birden fazla randevuya karşılık gelir
--   (4 hizmet birlikte tahsil edildi senaryosu).
CREATE TABLE IF NOT EXISTS "AppointmentPayment" (
  "id"            SERIAL PRIMARY KEY,
  "batchId"       INTEGER NOT NULL,
  "appointmentId" INTEGER NOT NULL,
  CONSTRAINT "AppointmentPayment_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "PaymentBatch"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "AppointmentPayment_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_appointment_payment_batch_appt"
  ON "AppointmentPayment" ("batchId", "appointmentId");
CREATE INDEX IF NOT EXISTS "idx_appointment_payment_appointment"
  ON "AppointmentPayment" ("appointmentId");
