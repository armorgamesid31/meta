DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LocaleCode') THEN
    CREATE TYPE "LocaleCode" AS ENUM ('tr', 'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ar', 'hi');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TranslationEntityType') THEN
    CREATE TYPE "TranslationEntityType" AS ENUM ('SALON', 'CATEGORY', 'EXPERT', 'TEMPLATE', 'UI');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TranslationStatus') THEN
    CREATE TYPE "TranslationStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED');
  END IF;
END$$;

ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "citySlug" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "districtSlug" TEXT,
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

ALTER TABLE "SalonSettings"
  ADD COLUMN IF NOT EXISTS "contentSourceLocale" "LocaleCode" DEFAULT 'tr';

CREATE TABLE IF NOT EXISTS "Category" (
  "id" SERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "defaultName" TEXT NOT NULL,
  "defaultSlug" TEXT NOT NULL,
  "defaultDescription" TEXT,
  "defaultImageUrl" TEXT,
  "displayOrder" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_category_key" ON "Category"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_category_default_slug" ON "Category"("defaultSlug");

CREATE TABLE IF NOT EXISTS "Translation" (
  "id" SERIAL PRIMARY KEY,
  "entityType" "TranslationEntityType" NOT NULL,
  "entityId" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "locale" "LocaleCode" NOT NULL,
  "sourceLocale" "LocaleCode" NOT NULL,
  "text" TEXT NOT NULL,
  "status" "TranslationStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_translation_entity_key_locale_version"
  ON "Translation"("entityType", "entityId", "key", "locale", "version");

CREATE INDEX IF NOT EXISTS "idx_translation_lookup"
  ON "Translation"("entityType", "entityId", "key", "locale", "status");

ALTER TABLE "ServiceCategory"
  ADD COLUMN IF NOT EXISTS "categoryId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceCategory_categoryId_fkey') THEN
    ALTER TABLE "ServiceCategory"
      ADD CONSTRAINT "ServiceCategory_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "idx_servicecategory_salon_category_display"
  ON "ServiceCategory"("salonId", "categoryId", "displayOrder");

CREATE INDEX IF NOT EXISTS "idx_salon_city_district_slug"
  ON "Salon"("citySlug", "districtSlug");

INSERT INTO "Category" ("key", "defaultName", "defaultSlug", "displayOrder", "isActive") VALUES
  ('FACIAL', 'Yuz ve Cilt Bakimi', 'yuz-cilt-bakimi', 1, true),
  ('MEDICAL', 'Medikal Estetik', 'medikal-estetik', 2, true),
  ('LASER', 'Lazer Epilasyon', 'lazer-epilasyon', 3, true),
  ('WAX', 'Agda', 'agda', 4, true),
  ('BODY', 'Vucut Sekillendirme ve Masaj', 'vucut-sekillendirme-masaj', 5, true),
  ('NAIL', 'El Ayak ve Tirnak', 'el-ayak-tirnak', 6, true),
  ('HAIR', 'Sac ve Kuafor', 'sac-kuafor', 7, true),
  ('CONSULTATION', 'Danismanlik ve Paketler', 'danismanlik-paketler', 8, true),
  ('OTHER', 'Diger Hizmetler', 'diger-hizmetler', 9, true)
ON CONFLICT ("key") DO NOTHING;

WITH normalized AS (
  SELECT
    sc."id",
    UPPER(TRANSLATE(COALESCE(sc."name", ''), 'çğıöşüÇĞİÖŞÜ', 'cgiosuCGIOSU')) AS n
  FROM "ServiceCategory" sc
), mapped AS (
  SELECT
    n."id",
    CASE
      WHEN n.n LIKE '%CILT%' OR n.n LIKE '%YUZ%' OR n.n LIKE '%FACIAL%' THEN 'FACIAL'
      WHEN n.n LIKE '%MEDIKAL%' OR n.n LIKE '%MEDICAL%' THEN 'MEDICAL'
      WHEN n.n LIKE '%LAZER%' OR n.n LIKE '%LASER%' OR n.n LIKE '%EPILASYON%' THEN 'LASER'
      WHEN n.n LIKE '%AGDA%' OR n.n LIKE '%WAX%' THEN 'WAX'
      WHEN n.n LIKE '%VUCUT%' OR n.n LIKE '%BODY%' OR n.n LIKE '%MASAJ%' THEN 'BODY'
      WHEN n.n LIKE '%TIRNAK%' OR n.n LIKE '%MANIKUR%' OR n.n LIKE '%PEDIKUR%' OR n.n LIKE '%NAIL%' THEN 'NAIL'
      WHEN n.n LIKE '%SAC%' OR n.n LIKE '%KUAFOR%' OR n.n LIKE '%HAIR%' THEN 'HAIR'
      WHEN n.n LIKE '%DANISMANLIK%' OR n.n LIKE '%PAKET%' OR n.n LIKE '%CONSULTATION%' THEN 'CONSULTATION'
      ELSE 'OTHER'
    END AS category_key
  FROM normalized n
)
UPDATE "ServiceCategory" sc
SET "categoryId" = c."id"
FROM mapped m
JOIN "Category" c ON c."key" = m.category_key
WHERE sc."id" = m."id"
  AND (sc."categoryId" IS NULL OR sc."categoryId" <> c."id");

INSERT INTO "Translation" ("entityType", "entityId", "key", "locale", "sourceLocale", "text", "status", "version")
SELECT
  'CATEGORY'::"TranslationEntityType",
  c."id",
  'name',
  'tr'::"LocaleCode",
  'tr'::"LocaleCode",
  c."defaultName",
  'APPROVED'::"TranslationStatus",
  1
FROM "Category" c
ON CONFLICT ("entityType", "entityId", "key", "locale", "version") DO NOTHING;

INSERT INTO "Translation" ("entityType", "entityId", "key", "locale", "sourceLocale", "text", "status", "version")
SELECT
  'CATEGORY'::"TranslationEntityType",
  c."id",
  'slug',
  'tr'::"LocaleCode",
  'tr'::"LocaleCode",
  c."defaultSlug",
  'APPROVED'::"TranslationStatus",
  1
FROM "Category" c
ON CONFLICT ("entityType", "entityId", "key", "locale", "version") DO NOTHING;
