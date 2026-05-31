-- AppointmentCampaignApplication: idempotency için unique constraint.
-- Aynı (salonId, appointmentId, campaignId, serviceId) tekrar INSERT
-- edilirse silent atlanır (ON CONFLICT DO NOTHING). Double-submit
-- veya retry'da kampanya iki kez sayılmasın, wallet iki kez düşmesin.
--
-- serviceId nullable olduğu için COALESCE ile sıfıra düşürüp full key
-- elde ederiz; PostgreSQL native unique-with-nullable kullanmıyor.

-- Önce mevcut duplicate'leri APPLIED'tan RELEASED'a çek; tek bir
-- APPLIED kayıt kalsın. Sıralama: id DESC → en son INSERT'i sakla.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "salonId", "appointmentId", "campaignId", COALESCE("serviceId", 0)
      ORDER BY id DESC
    ) AS rn
  FROM "AppointmentCampaignApplication"
  WHERE "status" = 'APPLIED'
)
UPDATE "AppointmentCampaignApplication" a
SET    "status" = 'RELEASED', "releasedAt" = NOW(), "updatedAt" = NOW()
FROM   ranked r
WHERE  a.id = r.id AND r.rn > 1;

-- Sonra unique index. APPLIED + RELEASED birlikte bulunabilir (geçmiş
-- audit izi için); ama aynı status × triple en fazla bir kez.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_app_salon_appt_campaign_service"
  ON "AppointmentCampaignApplication" (
    "salonId",
    "appointmentId",
    "campaignId",
    COALESCE("serviceId", 0),
    "status"
  );
