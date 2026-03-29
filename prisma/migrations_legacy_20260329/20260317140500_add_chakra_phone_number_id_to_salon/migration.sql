ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "chakraPhoneNumberId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_salon_chakra_phone_number_id"
  ON "Salon"("chakraPhoneNumberId");

UPDATE "Salon" s
SET "chakraPhoneNumberId" = NULLIF(TRIM((a."faqAnswers"->>'whatsappPhoneNumberId')), '')
FROM "SalonAiAgentSettings" a
WHERE a."salonId" = s."id"
  AND (s."chakraPhoneNumberId" IS NULL OR s."chakraPhoneNumberId" = '')
  AND NULLIF(TRIM((a."faqAnswers"->>'whatsappPhoneNumberId')), '') IS NOT NULL;
