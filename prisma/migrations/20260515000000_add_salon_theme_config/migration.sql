-- Per-salon theme config (preset + brand color + resolved tone scale).
-- All nullable; salons that have not configured a theme fall back to the
-- Classic preset default at read time (backend derives on the public payload).
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "themePreset" TEXT;
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "brandColor" TEXT;
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "themeUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "themeResolved" JSONB;
