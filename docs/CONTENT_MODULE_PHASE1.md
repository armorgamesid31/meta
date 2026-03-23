# Content Module Phase-1

This document describes the current backend usage and API contracts for phase-1 content management.

## Scope

- Runtime read API: `GET /api/content/runtime`
- Admin APIs (authenticated):
  - `GET /api/admin/content/items`
  - `POST /api/admin/content/items/draft`
  - `POST /api/admin/content/items/publish`
  - `POST /api/admin/content/items/publish-bulk`

Mounted in: `src/server.ts`
- `app.use('/api/content', contentRoutes)`
- `app.use('/api/admin/content', adminContentRoutes)`
- `app.use('/api/internal/service-translations', internalServiceTranslationsRoutes)`

## Data Model (Phase-1)

- `ContentItem`: logical key definition (`surface`, `page`, `section`, `key`, optional `salonId` scope)
- `ContentLocaleValue`: localized draft/published value per item+locale
- Enums:
  - `ContentSurface`: `marketing_site | salon_website | booking_page | mobile_app | campaigns | legal | message_templates`
  - `ContentValueStatus`: `DRAFT | PUBLISHED`
  - `LocaleCode`: `tr, en, es, fr, de, pt, ru, zh, ar, hi`

Schema references: `prisma/schema.prisma`

Dynamic service i18n references:
- `ServiceTranslation` (service-level translations)
- `ServiceGroupTranslation` (group-level translations, extension-ready)

## Runtime API Contract

## GET `/api/content/runtime`

Public endpoint for runtime content resolution.

Query params:
- `surface` (required): must match `ContentSurface`
- `page` (required)
- `locale` (optional, normalized; default `tr`)
- `fallbackLocale` (optional, normalized; default `tr`)
- `salonId` (optional positive integer)
- `tenantSlug` (optional; fallback resolver)

Header fallback:
- `x-tenant-slug` can be used to resolve salon when `salonId` is not provided.

Response `200` shape:
- `surface`, `page`, `requestedLocale`, `fallbackLocale`, `salonId`
- `totalKeys`
- `values: Record<string, string>` (key format: `section.key`)
- `meta[key] = { locale, version, source: 'salon' | 'global', itemId }`

Validation errors:
- `400` when `surface` missing/invalid
- `400` when `page` missing

Server error:
- `500`

### Runtime precedence and fallback rules

Resolution logic is implemented in `src/services/content.ts`:

- Locale priority list: `[requestedLocale, fallbackLocale, DEFAULT_LOCALE('tr')]` (unique)
- Source priority per key:
  - Salon override (`salonId = current salon`) wins over global (`salonId = null`)
- Locale priority inside a source:
  - earlier locale in priority list wins
- Only `publishedValue` rows are eligible

Cache header:
- `Cache-Control: public, max-age={ttl}, stale-while-revalidate={ttl*3}`
- `ttl` comes from `CONTENT_RUNTIME_CACHE_SECONDS` (default `60`)

Implementation references:
- `src/routes/content.ts`
- `src/services/content.ts`

## Dynamic Service Translation APIs

## POST `/api/internal/service-translations/batch`

Internal-only batch upsert endpoint for service translations (n8n-compatible).

Auth:
- `x-internal-api-key` required when `INTERNAL_API_KEY` is configured.

Body:
- either raw array or `{ items: [...] }`
- row fields:
  - `serviceId` (required)
  - `locale` (required)
  - `name` (required)
  - optional: `sourceLocale`, `description`, `status`, `version`

Behavior:
- upserts by `serviceId + locale + version`
- intended phase-1 operational mode is version `1` upsert per locale

Implementation references:
- `src/routes/internalServiceTranslations.ts`
- `src/services/serviceTranslations.ts`

Runtime consumption:
- `GET /api/salon/services`
- `GET /api/salon/services/public`
- locale fallback uses translated name/description when available, then source fields

## Admin API Contracts

All admin content routes are protected by `authenticateToken` (`router.use(authenticateToken)`).

Authentication requirements:
- `Authorization: Bearer <jwt>`
- Missing token -> `401`
- Invalid token -> `403`
- Token user must exist in `SalonUser`

Implementation references:
- `src/middleware/auth.ts`
- `src/routes/adminContent.ts`

## GET `/api/admin/content/items`

List/query items with locale values.

Query params (optional filters):
- `surface`, `locale`, `status`, `page`, `section`, `key`, `q`
- Pagination: `take` (max 300, default 100), `skip`
- Scope filter: `salonId`
  - `global`: only global items
  - `<number>`: specific salon
  - `all`: all scopes (allowlisted global content admin only)
  - omitted/default: global + current user salon

Response `200`:
- `total`, `take`, `skip`, `filters`, `items[]`
- each item includes:
  - core fields + `localeValues[]`
  - `editable: boolean`
  - `readOnlyReason: string | null`

Scope guards:
- Non-global admins cannot query `all`
- Non-global admins cannot query other salon id

## POST `/api/admin/content/items/draft`

Upsert draft content value.

Body:
- required: `draftValue` (string)
- required either:
  - `itemId`, or
  - (`surface`, `page`, `section`, `key`) for create-by-coordinates
- optional: `locale` (default/normalized `tr`), `salonId`, `metadata`

Behavior:
- If `itemId` provided: updates existing item locale draft
- If coordinates provided: creates item if missing, then upserts locale draft
- `status` set to `DRAFT`

Permission guards:
- Cannot write outside allowed scope
- Global scope write (`salonId: null` / `global`) requires allowlisted admin email (`CONTENT_ADMIN_EMAILS`)

Read-only guard:
- `surface = message_templates` is blocked in phase-1 (`403`)

Errors:
- `400` invalid payload
- `401` unauthorized
- `403` scope/read-only violations
- `404` when `itemId` not found

## POST `/api/admin/content/items/publish`

Publish single locale value.

Body:
- `itemId` (required positive integer)
- `locale` (optional, normalized; default `tr`)

Behavior:
- Copies `draftValue` -> `publishedValue`
- Sets `status = PUBLISHED`
- Increments `version` by `1`
- Sets `publishedAt` and `publishedBy`

Guards:
- Scope permission check
- `message_templates` blocked in phase-1

Errors:
- `400`, `401`, `403`, `404`, `500`

## POST `/api/admin/content/items/publish-bulk`

Bulk publish locale values.

Body:
- `entries: Array<{ itemId, locale }>` (non-empty)

Behavior:
- Parses/normalizes entries
- Filters publishable rows by existence, scope, and read-only rules
- Returns:
  - `published: [{ itemId, locale, version }]`
  - `skipped: [{ itemId, locale, reason }]`

## Phase-1 Constraints Summary

- `message_templates` surface is read-only
- Runtime serves only published values
- Draft and publish are explicit separate steps
- Global write scope is restricted via `CONTENT_ADMIN_EMAILS`

## Frontend Usage (Current)

Admin panel page uses these endpoints directly:
- `src/pages/salon/SalonContent.tsx`

- list: `GET /api/admin/content/items`
- save draft: `POST /api/admin/content/items/draft`
- publish single: `POST /api/admin/content/items/publish`
- publish bulk: `POST /api/admin/content/items/publish-bulk`

## Language Extension

Phase-1 locale normalization uses `src/constants/locales.ts`.

To add a new language:
1. Add locale code to `SUPPORTED_LOCALES` in `src/constants/locales.ts`
2. Ensure Prisma enum `LocaleCode` includes the same code (`prisma/schema.prisma`)
3. Run Prisma migration/client generation
4. Add seed/runtime keys for new locale in content rows
5. Frontend falls back automatically (`requested -> fallback -> tr`) when key is missing

## n8n Integration Points

Primary integration path:
- `POST /api/internal/service-translations/batch`

Suggested n8n flow:
1. Detect changed source service text
2. Generate target locale translations
3. Batch upsert via internal endpoint using `x-internal-api-key`
4. Mark status (`APPROVED` recommended for runtime visibility)

For static CMS content:
- phase-1 admin endpoints can be called from internal tools
- public runtime endpoint is read-only (`GET /api/content/runtime`)

## Out-of-Scope (Phase-1)

- Rich text editor / visual builder
- Media upload pipeline
- Full revision history tables and rollback UI
- Salon self-service global content permissions model
- Message template editing UI (`message_templates` is read-only)
- Full mobile app UI-wide runtime content consumption rollout
