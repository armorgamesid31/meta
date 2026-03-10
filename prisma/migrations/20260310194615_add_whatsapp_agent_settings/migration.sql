CREATE TABLE IF NOT EXISTS "SalonAiAgentSettings" (
  "id" SERIAL PRIMARY KEY,
  "salonId" INTEGER NOT NULL,
  "tone" TEXT NOT NULL DEFAULT 'balanced',
  "answerLength" TEXT NOT NULL DEFAULT 'medium',
  "emojiUsage" TEXT NOT NULL DEFAULT 'low',
  "bookingGuidance" TEXT NOT NULL DEFAULT 'medium',
  "handoverThreshold" TEXT NOT NULL DEFAULT 'balanced',
  "faqAnswers" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SalonAiAgentSettings_salonId_key" ON "SalonAiAgentSettings"("salonId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'SalonAiAgentSettings_salonId_fkey'
      AND table_name = 'SalonAiAgentSettings'
  ) THEN
    ALTER TABLE "SalonAiAgentSettings"
      ADD CONSTRAINT "SalonAiAgentSettings_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
