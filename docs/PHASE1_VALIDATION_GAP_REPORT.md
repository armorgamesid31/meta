# Phase 1 Validation & Gap Report (4 Repo)

Date: 2026-03-23

## Scope
- No feature expansion.
- Validation only for existing Phase 1 implementation.

## 1) Runtime Content API End-to-End
- Backend started with `.env` DB resolution (`unset DATABASE_URL`).
- `GET /api/content/runtime` returned published values and metadata.
- Cache header confirmed:
  - `Cache-Control: public, max-age=60, stale-while-revalidate=180`
- Verified precedence:
  - without salon context: `qa.scopeProbe = GLOBAL_SCOPE_TR`
  - with `salonId=2`: `qa.scopeProbe = SALON_SCOPE_TR`
- Verified locale fallback:
  - request `locale=de&fallbackLocale=en` returned `qa.localeProbe = LOCALE_FALLBACK_EN` with `meta.locale=en`.

Status: **Complete**

## 2) Draft -> Publish Flow (Admin -> Runtime)
- Admin API flow validated with authenticated user (`owner@palmbeauty.com` allowlisted):
  - `POST /api/admin/content/items/draft` created/updated draft
  - runtime did **not** expose draft-only key before publish
  - `POST /api/admin/content/items/publish` made key visible via runtime
  - publish version increment observed
- Admin UI wiring check:
  - `SalonContent.tsx` uses these same endpoints (`/draft`, `/publish`, `/publish-bulk`) with existing auth token.

Status: **Complete** (API + UI wiring)

## 3) Runtime Unavailable Fallback
- `kedyweb` runtime helper test with dead API base (`http://127.0.0.1:9`):
  - returned empty runtime bundle, local fallback text used.
- `v0-salon-booking-frontend` runtime helper test with dead API base:
  - returned `{}`, local fallback text used.

Status: **Complete**

## 4) Completion Classification
- Fully complete:
  - Backend runtime content API behavior
  - Draft/publish state transition behavior
  - Tenant/global + locale fallback priority behavior
  - Frontend runtime-unavailable fallback behavior (kedyweb + booking helper paths)
- Partially complete:
  - Frontend production build validation for `kedyweb` and `v0-salon-booking-frontend` is blocked by existing prerender failures (see below), so full release-level smoke could not complete.
- Blocked by pre-existing issues:
  - `kedyweb` build fails on prerender `/tr/contact` with `TypeError: Cannot read properties of null (reading 'useContext')`, plus repeated React key warnings.
  - `v0-salon-booking-frontend` build fails on prerender `/_global-error` with same `useContext` null error, plus repeated React key warnings.

## 5) Build-Issue Attribution
- Not caused by backend content API integration:
  - errors are prerender/layout/head-context type failures, not runtime content API request errors.
  - booking failure route is `/_global-error`, outside Phase 1 content-override touchpoints.
- Likely pre-existing frontend structural issue:
  - repeated React key warnings and `useContext` null pattern in both frontends indicate shared render-tree issue independent of content API.

Confidence: **High**, but not absolute (no clean historical baseline build artifact in this workspace snapshot).
