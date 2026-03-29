ALTER TABLE "SalonAiAgentSettings"
ADD COLUMN IF NOT EXISTS "aiDisclosure" TEXT NOT NULL DEFAULT 'onQuestion';
