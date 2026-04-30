DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'SalonSettings'
  ) THEN
    ALTER TABLE "SalonSettings" ADD COLUMN IF NOT EXISTS "commonQuestions" JSONB;
  END IF;
END $$;
