-- Backfill WhatsApp channel bindings from legacy Salon.chakraPhoneNumberId
-- to move toward SalonChannelBinding as source of truth.

INSERT INTO "SalonChannelBinding" (
  "salonId",
  "channel",
  "externalAccountId",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  s.id,
  'WHATSAPP'::"ChannelType",
  TRIM(s."chakraPhoneNumberId"),
  true,
  NOW(),
  NOW()
FROM "Salon" s
WHERE s."chakraPhoneNumberId" IS NOT NULL
  AND LENGTH(TRIM(s."chakraPhoneNumberId")) > 0
ON CONFLICT ("channel", "externalAccountId")
DO UPDATE SET
  "salonId" = EXCLUDED."salonId",
  "isActive" = true,
  "updatedAt" = NOW();

-- Keep only one active WhatsApp binding per salon after backfill.
WITH ranked AS (
  SELECT
    id,
    "salonId",
    ROW_NUMBER() OVER (PARTITION BY "salonId" ORDER BY "updatedAt" DESC, id DESC) AS rn
  FROM "SalonChannelBinding"
  WHERE "channel" = 'WHATSAPP'::"ChannelType"
)
UPDATE "SalonChannelBinding" b
SET
  "isActive" = CASE WHEN r.rn = 1 THEN true ELSE false END,
  "updatedAt" = NOW()
FROM ranked r
WHERE b.id = r.id;
