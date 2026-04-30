DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ServiceCategory'
  ) THEN
    ALTER TABLE "ServiceCategory" ADD COLUMN IF NOT EXISTS "commonQuestions" JSONB;
  END IF;
END $$;
