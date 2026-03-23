# DB Change Report - Content Module Phase 1

## 1) Scope and Repository

This report covers **all database-side changes created so far** for Phase 1 multilingual content work.

- Repository: `salon-asistan-backend-test`
- Other repos (`kedyweb`, `v0-salon-booking-frontend`, `Salonmanagementsaasapp`): **no DB schema changes were made**.
- Date: `2026-03-23`

## 2) Files Changed

1. `prisma/schema.prisma` (Prisma model + enum definitions)
2. `prisma/migrations/20260323150000_content_module_phase1/migration.sql` (DDL + seed + backfill)

## 3) High-Level Summary

Added a new internal content storage structure for static/semi-static multilingual content and dedicated translation tables for dynamic service entities.

### Added enums
- `ContentSurface`
  - `marketing_site`
  - `salon_website`
  - `booking_page`
  - `mobile_app`
  - `campaigns`
  - `legal`
  - `message_templates`
- `ContentValueStatus`
  - `DRAFT`
  - `PUBLISHED`

### Added tables
- `ContentItem`
- `ContentLocaleValue`
- `ServiceTranslation`
- `ServiceGroupTranslation`

### Existing table relation additions in Prisma schema
- `Salon.contentItems -> ContentItem[]`
- `SalonUser.publishedContentValues -> ContentLocaleValue[]`
- `Service.translations -> ServiceTranslation[]`
- `ServiceGroup.translations -> ServiceGroupTranslation[]`

Note: These are relation declarations in Prisma model layer; no new columns were added to these existing tables for these relation fields.

## 4) Detailed DDL Changes

## 4.1 `ContentItem`

Purpose: store logical content key definitions and scope (`global` or `salon override`).

Columns:
- `id SERIAL PRIMARY KEY`
- `surface ContentSurface NOT NULL`
- `page TEXT NOT NULL`
- `section TEXT NOT NULL`
- `key TEXT NOT NULL`
- `salonId INTEGER NULL` (optional tenant override)
- `metadata JSONB NULL`
- `createdAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`
- `updatedAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`

Foreign key:
- `ContentItem_salonId_fkey`: `salonId -> Salon(id)`
  - `ON DELETE CASCADE`
  - `ON UPDATE NO ACTION`

Indexes:
- `idx_content_item_surface_page_salon(surface, page, salonId)`
- `idx_content_item_surface_page_section(surface, page, section)`

Uniqueness strategy (important):
- Global uniqueness (when `salonId IS NULL`):
  - `uq_content_item_global_unique(surface, page, section, key)` partial index
- Tenant uniqueness (when `salonId IS NOT NULL`):
  - `uq_content_item_salon_unique(surface, page, section, key, salonId)` partial index

This avoids duplicate keys both for global and tenant-specific content.

## 4.2 `ContentLocaleValue`

Purpose: hold localized values and draft/publish state per content item.

Columns:
- `id SERIAL PRIMARY KEY`
- `itemId INTEGER NOT NULL`
- `locale LocaleCode NOT NULL`
- `draftValue TEXT NOT NULL`
- `publishedValue TEXT NULL`
- `status ContentValueStatus NOT NULL DEFAULT 'DRAFT'`
- `version INTEGER NOT NULL DEFAULT 1`
- `publishedAt TIMESTAMP(6) NULL`
- `publishedBy INTEGER NULL`
- `createdAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`
- `updatedAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`

Foreign keys:
- `ContentLocaleValue_itemId_fkey`: `itemId -> ContentItem(id)`
  - `ON DELETE CASCADE`
- `ContentLocaleValue_publishedBy_fkey`: `publishedBy -> SalonUser(id)`
  - `ON DELETE SET NULL`

Indexes / uniqueness:
- `uq_content_locale_value_item_locale(itemId, locale)`
- `idx_content_locale_value_locale_status_version(locale, status, version)`

## 4.3 `ServiceTranslation`

Purpose: dedicated multilingual storage for dynamic service records (separate from static CMS tables).

Columns:
- `id SERIAL PRIMARY KEY`
- `serviceId INTEGER NOT NULL`
- `locale LocaleCode NOT NULL`
- `sourceLocale LocaleCode NOT NULL DEFAULT 'tr'`
- `name TEXT NOT NULL`
- `description TEXT NULL`
- `status TranslationStatus NOT NULL DEFAULT 'DRAFT'`
- `version INTEGER NOT NULL DEFAULT 1`
- `createdAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`
- `updatedAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`

Foreign key:
- `ServiceTranslation_serviceId_fkey`: `serviceId -> Service(id)`
  - `ON DELETE CASCADE`

Indexes / uniqueness:
- `uq_service_translation_service_locale_version(serviceId, locale, version)`
- `idx_service_translation_lookup(serviceId, locale, status)`

## 4.4 `ServiceGroupTranslation`

Purpose: dedicated multilingual storage for service group records.

Columns:
- `id SERIAL PRIMARY KEY`
- `serviceGroupId INTEGER NOT NULL`
- `locale LocaleCode NOT NULL`
- `sourceLocale LocaleCode NOT NULL DEFAULT 'tr'`
- `name TEXT NOT NULL`
- `description TEXT NULL`
- `status TranslationStatus NOT NULL DEFAULT 'DRAFT'`
- `version INTEGER NOT NULL DEFAULT 1`
- `createdAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`
- `updatedAt TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP`

Foreign key:
- `ServiceGroupTranslation_serviceGroupId_fkey`: `serviceGroupId -> ServiceGroup(id)`
  - `ON DELETE CASCADE`

Indexes / uniqueness:
- `uq_service_group_translation_group_locale_version(serviceGroupId, locale, version)`
- `idx_service_group_translation_lookup(serviceGroupId, locale, status)`

## 5) Seed and Backfill in Migration

The migration includes both initial seed and backfill operations.

## 5.1 Global seed (`ContentItem` + `ContentLocaleValue`)

Inserted (if missing) global keys for:
- `marketing_site`
  - `home.hero.title`
  - `home.hero.description`
  - `navigation.header.subscribeLabel`
- `legal`
  - `privacy-policy.hero.title`
- `booking_page`
  - `booking_dashboard.common.confirmAppointment`
  - `booking_dashboard.common.loading`
- `salon_website`
  - `homepage.hero.tagline`

For each above key, TR and EN locale values are inserted as `publishedValue` + `draftValue` with:
- `status = PUBLISHED`
- `version = 1`
- `publishedAt = NOW()`

All inserts are guarded with `NOT EXISTS` checks (idempotent behavior intended).

## 5.2 Tenant override backfill from existing `Salon` fields

For every salon, creates `ContentItem` override rows for:
- `homepage.hero.tagline` (seed source: `salon.tagline`)
- `homepage.about.description` (seed source: `salon.about`)

Then inserts TR locale `ContentLocaleValue` rows when source values exist:
- `draftValue = COALESCE(salon.tagline or salon.about, '')`
- `publishedValue` same as draft
- `status = PUBLISHED`, `version = 1`

This preserves existing salon homepage text in the new content layer as initial override data.

## 6) Operational Safety Notes

- The migration uses `IF NOT EXISTS` style guards extensively for tables/indexes/constraints and enum creation wrapped in `DO $$` checks.
- Unique partial indexes enforce key integrity separately for global vs tenant scope.
- Existing business tables (`Salon`, `Service`, `ServiceGroup`, etc.) are not structurally altered with new scalar columns.

## 7) Current Execution Status

As of this report creation:
- Migration file and Prisma schema updates were created in codebase.
- **Migration apply status is not confirmed in this report** (no apply/run evidence recorded here).

If needed, confirm with:
```sql
SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name = '20260323150000_content_module_phase1';
```

## 8) Rollback Guide (Manual)

If a full rollback is required, execute in this order (after confirming no dependent code is using these tables):

```sql
-- 1) Drop child tables first
DROP TABLE IF EXISTS "ContentLocaleValue";
DROP TABLE IF EXISTS "ServiceTranslation";
DROP TABLE IF EXISTS "ServiceGroupTranslation";

-- 2) Drop parent content table
DROP TABLE IF EXISTS "ContentItem";

-- 3) Drop enums created for content module
DROP TYPE IF EXISTS "ContentValueStatus";
DROP TYPE IF EXISTS "ContentSurface";
```

Notes:
- If partial rollback is preferred, remove seed/backfill rows by scoped `DELETE` statements (surface/page/section/key based) instead of dropping tables.
- `TranslationStatus` and `LocaleCode` enums are pre-existing and should **not** be dropped.

## 9) Verification Queries (Post-Migration)

Use these quick checks after migration:

```sql
-- Tables exist
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'ContentItem',
    'ContentLocaleValue',
    'ServiceTranslation',
    'ServiceGroupTranslation'
  );

-- Partial unique indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'uq_content_item_global_unique',
    'uq_content_item_salon_unique'
  );

-- Seed overview
SELECT ci."surface", ci."page", ci."section", ci."key", clv."locale", clv."status"
FROM "ContentItem" ci
JOIN "ContentLocaleValue" clv ON clv."itemId" = ci."id"
WHERE ci."salonId" IS NULL
ORDER BY ci."surface", ci."page", ci."section", ci."key", clv."locale";

-- Backfill sample count
SELECT COUNT(*) AS salon_override_items
FROM "ContentItem"
WHERE "surface" = 'salon_website'::"ContentSurface"
  AND "page" = 'homepage'
  AND "salonId" IS NOT NULL;
```

## 10) Risk Checklist

- Seed/backfill can increase row count significantly if salon count is high.
- Partial unique index rules are strict; repeated key naming mistakes will fail fast.
- If runtime logic is added without fallback handling, missing locale could surface as empty text (application-layer fallback required).
