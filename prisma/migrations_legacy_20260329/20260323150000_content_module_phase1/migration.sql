DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentSurface') THEN
    CREATE TYPE "ContentSurface" AS ENUM (
      'marketing_site',
      'salon_website',
      'booking_page',
      'mobile_app',
      'campaigns',
      'legal',
      'message_templates'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentValueStatus') THEN
    CREATE TYPE "ContentValueStatus" AS ENUM ('DRAFT', 'PUBLISHED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "ContentItem" (
  "id" SERIAL PRIMARY KEY,
  "surface" "ContentSurface" NOT NULL,
  "page" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "salonId" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentItem_salonId_fkey') THEN
    ALTER TABLE "ContentItem"
      ADD CONSTRAINT "ContentItem_salonId_fkey"
      FOREIGN KEY ("salonId") REFERENCES "Salon"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "idx_content_item_surface_page_salon"
  ON "ContentItem"("surface", "page", "salonId");

CREATE INDEX IF NOT EXISTS "idx_content_item_surface_page_section"
  ON "ContentItem"("surface", "page", "section");

-- Enforce global uniqueness for rows where salonId is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_content_item_global_unique"
  ON "ContentItem"("surface", "page", "section", "key")
  WHERE "salonId" IS NULL;

-- Enforce tenant uniqueness for rows where salonId is NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_content_item_salon_unique"
  ON "ContentItem"("surface", "page", "section", "key", "salonId")
  WHERE "salonId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ContentLocaleValue" (
  "id" SERIAL PRIMARY KEY,
  "itemId" INTEGER NOT NULL,
  "locale" "LocaleCode" NOT NULL,
  "draftValue" TEXT NOT NULL,
  "publishedValue" TEXT,
  "status" "ContentValueStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" TIMESTAMP(6),
  "publishedBy" INTEGER,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentLocaleValue_itemId_fkey') THEN
    ALTER TABLE "ContentLocaleValue"
      ADD CONSTRAINT "ContentLocaleValue_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "ContentItem"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentLocaleValue_publishedBy_fkey') THEN
    ALTER TABLE "ContentLocaleValue"
      ADD CONSTRAINT "ContentLocaleValue_publishedBy_fkey"
      FOREIGN KEY ("publishedBy") REFERENCES "SalonUser"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_content_locale_value_item_locale"
  ON "ContentLocaleValue"("itemId", "locale");

CREATE INDEX IF NOT EXISTS "idx_content_locale_value_locale_status_version"
  ON "ContentLocaleValue"("locale", "status", "version");

CREATE TABLE IF NOT EXISTS "ServiceTranslation" (
  "id" SERIAL PRIMARY KEY,
  "serviceId" INTEGER NOT NULL,
  "locale" "LocaleCode" NOT NULL,
  "sourceLocale" "LocaleCode" NOT NULL DEFAULT 'tr',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "TranslationStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceTranslation_serviceId_fkey') THEN
    ALTER TABLE "ServiceTranslation"
      ADD CONSTRAINT "ServiceTranslation_serviceId_fkey"
      FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_translation_service_locale_version"
  ON "ServiceTranslation"("serviceId", "locale", "version");

CREATE INDEX IF NOT EXISTS "idx_service_translation_lookup"
  ON "ServiceTranslation"("serviceId", "locale", "status");

CREATE TABLE IF NOT EXISTS "ServiceGroupTranslation" (
  "id" SERIAL PRIMARY KEY,
  "serviceGroupId" INTEGER NOT NULL,
  "locale" "LocaleCode" NOT NULL,
  "sourceLocale" "LocaleCode" NOT NULL DEFAULT 'tr',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "TranslationStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ServiceGroupTranslation_serviceGroupId_fkey') THEN
    ALTER TABLE "ServiceGroupTranslation"
      ADD CONSTRAINT "ServiceGroupTranslation_serviceGroupId_fkey"
      FOREIGN KEY ("serviceGroupId") REFERENCES "ServiceGroup"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_group_translation_group_locale_version"
  ON "ServiceGroupTranslation"("serviceGroupId", "locale", "version");

CREATE INDEX IF NOT EXISTS "idx_service_group_translation_lookup"
  ON "ServiceGroupTranslation"("serviceGroupId", "locale", "status");

-- Global seed keys (TR/EN) for kedyweb + booking + salon website base.
WITH seed_items AS (
  SELECT *
  FROM (VALUES
    ('marketing_site'::"ContentSurface", 'home', 'hero', 'title'),
    ('marketing_site'::"ContentSurface", 'home', 'hero', 'description'),
    ('marketing_site'::"ContentSurface", 'navigation', 'header', 'subscribeLabel'),
    ('legal'::"ContentSurface", 'privacy-policy', 'hero', 'title'),
    ('booking_page'::"ContentSurface", 'booking_dashboard', 'common', 'confirmAppointment'),
    ('booking_page'::"ContentSurface", 'booking_dashboard', 'common', 'loading'),
    ('salon_website'::"ContentSurface", 'homepage', 'hero', 'tagline')
  ) AS t(surface, page, section, key)
), inserted_items AS (
  INSERT INTO "ContentItem" ("surface", "page", "section", "key", "salonId", "metadata")
  SELECT s.surface, s.page, s.section, s.key, NULL, '{}'::jsonb
  FROM seed_items s
  WHERE NOT EXISTS (
    SELECT 1
    FROM "ContentItem" ci
    WHERE ci."surface" = s.surface
      AND ci."page" = s.page
      AND ci."section" = s.section
      AND ci."key" = s.key
      AND ci."salonId" IS NULL
  )
  RETURNING "id", "surface", "page", "section", "key"
), all_seed_items AS (
  SELECT "id", "surface", "page", "section", "key" FROM inserted_items
  UNION ALL
  SELECT ci."id", ci."surface", ci."page", ci."section", ci."key"
  FROM "ContentItem" ci
  JOIN seed_items s
    ON s.surface = ci."surface"
   AND s.page = ci."page"
   AND s.section = ci."section"
   AND s.key = ci."key"
  WHERE ci."salonId" IS NULL
), seed_values AS (
  SELECT *
  FROM (VALUES
    ('marketing_site'::"ContentSurface", 'home', 'hero', 'title', 'tr'::"LocaleCode", 'Instagram ve WhatsApp mesajlarini randevuya donusturun.'),
    ('marketing_site'::"ContentSurface", 'home', 'hero', 'title', 'en'::"LocaleCode", 'Turn Instagram and WhatsApp conversations into bookings.'),
    ('marketing_site'::"ContentSurface", 'home', 'hero', 'description', 'tr'::"LocaleCode", 'Kedy, salon ekipleri icin yapay zeka destekli iletisim ve operasyon katmani sunar.'),
    ('marketing_site'::"ContentSurface", 'home', 'hero', 'description', 'en'::"LocaleCode", 'Kedy provides an AI-powered communication and operations layer for salon teams.'),
    ('marketing_site'::"ContentSurface", 'navigation', 'header', 'subscribeLabel', 'tr'::"LocaleCode", 'Hizmete Abone Ol'),
    ('marketing_site'::"ContentSurface", 'navigation', 'header', 'subscribeLabel', 'en'::"LocaleCode", 'Subscribe'),
    ('legal'::"ContentSurface", 'privacy-policy', 'hero', 'title', 'tr'::"LocaleCode", 'Gizlilik Politikasi'),
    ('legal'::"ContentSurface", 'privacy-policy', 'hero', 'title', 'en'::"LocaleCode", 'Privacy Policy'),
    ('booking_page'::"ContentSurface", 'booking_dashboard', 'common', 'confirmAppointment', 'tr'::"LocaleCode", 'Randevuyu Onayla'),
    ('booking_page'::"ContentSurface", 'booking_dashboard', 'common', 'confirmAppointment', 'en'::"LocaleCode", 'Confirm Appointment'),
    ('booking_page'::"ContentSurface", 'booking_dashboard', 'common', 'loading', 'tr'::"LocaleCode", 'Yukleniyor...'),
    ('booking_page'::"ContentSurface", 'booking_dashboard', 'common', 'loading', 'en'::"LocaleCode", 'Loading...'),
    ('salon_website'::"ContentSurface", 'homepage', 'hero', 'tagline', 'tr'::"LocaleCode", 'Profesyonel bakim ve modern salon deneyimi.'),
    ('salon_website'::"ContentSurface", 'homepage', 'hero', 'tagline', 'en'::"LocaleCode", 'Professional care and a modern salon experience.')
  ) AS v(surface, page, section, key, locale, value)
)
INSERT INTO "ContentLocaleValue" (
  "itemId",
  "locale",
  "draftValue",
  "publishedValue",
  "status",
  "version",
  "publishedAt"
)
SELECT
  i."id",
  sv.locale,
  sv.value,
  sv.value,
  'PUBLISHED'::"ContentValueStatus",
  1,
  NOW()
FROM all_seed_items i
JOIN seed_values sv
  ON sv.surface = i."surface"
 AND sv.page = i."page"
 AND sv.section = i."section"
 AND sv.key = i."key"
WHERE NOT EXISTS (
  SELECT 1
  FROM "ContentLocaleValue" clv
  WHERE clv."itemId" = i."id"
    AND clv."locale" = sv.locale
);

-- Backfill existing salon website fields into tenant content overrides (TR locale).
INSERT INTO "ContentItem" ("surface", "page", "section", "key", "salonId", "metadata")
SELECT
  'salon_website'::"ContentSurface",
  'homepage',
  src.section,
  src.key,
  s."id",
  jsonb_build_object('seedSource', src.seedSource)
FROM "Salon" s
JOIN (
  VALUES
    ('hero', 'tagline', 'salon.tagline'),
    ('about', 'description', 'salon.about')
) AS src(section, key, seedSource)
  ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM "ContentItem" ci
  WHERE ci."surface" = 'salon_website'::"ContentSurface"
    AND ci."page" = 'homepage'
    AND ci."section" = src.section
    AND ci."key" = src.key
    AND ci."salonId" = s."id"
);

INSERT INTO "ContentLocaleValue" (
  "itemId",
  "locale",
  "draftValue",
  "publishedValue",
  "status",
  "version",
  "publishedAt"
)
SELECT
  ci."id",
  'tr'::"LocaleCode",
  CASE
    WHEN ci."section" = 'hero' AND ci."key" = 'tagline' THEN COALESCE(s."tagline", '')
    WHEN ci."section" = 'about' AND ci."key" = 'description' THEN COALESCE(s."about", '')
    ELSE ''
  END,
  CASE
    WHEN ci."section" = 'hero' AND ci."key" = 'tagline' THEN COALESCE(s."tagline", '')
    WHEN ci."section" = 'about' AND ci."key" = 'description' THEN COALESCE(s."about", '')
    ELSE ''
  END,
  'PUBLISHED'::"ContentValueStatus",
  1,
  NOW()
FROM "ContentItem" ci
JOIN "Salon" s ON s."id" = ci."salonId"
WHERE ci."surface" = 'salon_website'::"ContentSurface"
  AND ci."page" = 'homepage'
  AND (
    (ci."section" = 'hero' AND ci."key" = 'tagline' AND s."tagline" IS NOT NULL)
    OR (ci."section" = 'about' AND ci."key" = 'description' AND s."about" IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "ContentLocaleValue" clv
    WHERE clv."itemId" = ci."id"
      AND clv."locale" = 'tr'::"LocaleCode"
  );
