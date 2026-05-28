-- SlotLock: gerçek slot rezervasyonu (PR7 availability-engine-rework, 2026-05-28).
-- 120 saniyelik TTL ile bir display slot kilitler. Müsaitlik motoru bu kayıtları
-- BOOKED randevular gibi sayar; başka müşteri aynı slotu boş göremez.
-- Booking commit kilidi doğrular + siler; aksi takdirde TTL dolunca expire eder.

CREATE TABLE "SlotLock" (
  "id"        TEXT        NOT NULL,
  "salonId"   INTEGER     NOT NULL,
  -- JSON dizi: [{ "staffId": number, "startTime": ISO string, "endTime": ISO string }]
  -- Multi-person display slot, tek lock altında birden fazla entry tutar.
  "entries"   JSONB       NOT NULL,
  "expiresAt" TIMESTAMP(6) NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SlotLock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SlotLock_salonId_expiresAt_idx" ON "SlotLock"("salonId", "expiresAt");
