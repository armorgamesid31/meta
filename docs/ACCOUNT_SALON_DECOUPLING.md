# Account / Salon Decoupling

The signup architecture was rebuilt around a single decision: a
`UserIdentity` should be able to exist without a `Salon`. The old
flow conflated the two — every account-create path also created a
salon (and vice versa). That made the marketing funnel awkward
(`/baslayalim` → email code → activation), made staff invites
require pre-creating a user shell, and locked the API into
salon-scoped auth tokens.

This doc explains the moving pieces post-cutover.

## Lifecycle

```
   /kayit (web panel) or in-app register
              │
              ▼
     onboardingService.startOnboarding({})       (no code/token)
              │
              ▼
   firstName → lastName → phone (WA magic-link)
              → email (mail magic-link) → photo → password
              │
              ▼
     activateOnboarding({ sessionId, password })
              │
              ▼
     UserIdentity row + createIdentityTokens()
              │
              ▼
        AuthGuard → /app/welcome
              │
       ┌──────┴──────────┐
       ▼                 ▼
   POST /api/salons   POST /api/auth/invites/redeem
   (open own salon)   (join existing as STAFF/OWNER)
       │                 │
       ▼                 ▼
   createAuthTokens (full salon-scoped) → /app/schedule
```

## Tokens

| Token kind | Issued by | Carries | Accepted by |
| --- | --- | --- | --- |
| Salon-scoped (full) | `createAuthTokens` | `identityId`, `membershipId`, `salonId`, `legacyUserId`, `role` | `authenticateToken` (rest of the API) |
| Identity-only | `createIdentityTokens` | `identityId` only | `authenticateIdentity` (registration handoffs, `/auth/me`, `/api/salons`, `/auth/invites/redeem`) |

`POST /api/salons` and `POST /api/auth/invites/redeem` accept an
identity-only token and respond with a fresh full token — the
client should drop the identity-only one and adopt the new pair
(`AuthContext.adoptTokens`).

## Endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/onboarding/start` | none | Start session. Empty body → SELF_REGISTER. `{code}` or `{token}` → INVITE. |
| `POST /api/auth/onboarding/:id/patch` | none | Save partial form fields (name, gender, etc.). |
| `POST /api/auth/onboarding/:id/send-phone-link` | none | WA magic-link via Kedy-central plugin. |
| `POST /api/auth/onboarding/:id/send-email-link` | none | SMTP2GO magic-link. |
| `POST /api/auth/onboarding/:id/activate` | none | Final step. Returns identity-only tokens for SELF_REGISTER, salon-scoped tokens for legacy invite. |
| `POST /api/salons` | `authenticateIdentity` | Open a salon as OWNER. Hands back full tokens + Lead row + n8n webhook. Reviewer accounts (`REVIEWER_IDENTITY_EMAILS` env) skip lifecycle and go straight to `ACTIVE_PAID`. |
| `POST /api/auth/invites/redeem` | `authenticateIdentity` | Bind the caller to an existing invite's membership. Returns full tokens. |
| `GET /api/auth/me` | `authenticateIdentity` | Minimal bootstrap (identity + memberships). Frontend fallback when `/api/mobile/bootstrap` rejects an identity-only token. |
| `POST /auth/login` | none | Same as before, but now returns identity-only tokens when memberships is empty (instead of 403). |
| `POST /api/leads/*` | none | **410 Gone.** Legacy. Marketing-site form retired. |
| `POST /api/auth/register-salon` | none | **Deprecated.** Kept functional with a `Deprecation` header for old mobile builds; new clients use `/api/salons`. |
| `POST /api/auth/invites/activate` | none | **Deprecated.** Same treatment — use `/invites/redeem` after onboarding. |

## Data model touch-points

- `UserIdentity` — unchanged. Can now exist with zero memberships.
- `SalonMembership` — unique `(salonId, identityId)`. `redeemInviteForIdentity` re-points an invite's pre-created membership at the caller's identity.
- `Invite.invitedUserId` — still required (legacy `SalonUser` shim). Future work: nullable + drop `SalonUser` mirror once nothing reads from it.
- `MobileAuthSession` — `userId`, `salonId` made nullable so identity-only sessions can be stored.
- `OnboardingSession` — `inviteId` made nullable, new `flow` discriminator (`'INVITE'` | `'SELF_REGISTER'`).
- `Salon` — new `lifecycleReminderState` JSONB (per-milestone send dedup).
- `Lead` / `ReferralInvite` / `ReferralReward` — unchanged. Lead is created server-side when `/api/salons` succeeds (carries marketing analytics + fires `LEAD_CREATED_WEBHOOK_URL`).

## Deep links

The marketing site serves `/.well-known/apple-app-site-association`
and `/.well-known/assetlinks.json` for `kedyapp.com`. Paths claimed
by the app (Universal Links / App Links):

| Path | Routes to |
| --- | --- |
| `/davet/{code}` | `/app/salon/join?code=...` |
| `/r/{ref}` | `/app/salon/create?ref=...` |
| `/baslayalim[/{code}]` | `/kayit` (legacy code forwarded as query) |
| `/v/{token}` | `/auth/invite-code?token=...` |
| `/salon/{slug}` | (claimed, no in-app route yet) |
| `/checkout/*` | (claimed for Stripe success returns) |

Apple Team ID + Android release-signing SHA-256 are still
placeholders in those files — fill them in before submitting to
the stores.

## Lifecycle reminder cron

`jobs/index.ts` ticks `processLifecycleReminders()` every 6 hours.
It scans `SETUP_PERIOD` / `GRACE_PERIOD` / `PAYMENT_REQUIRED`
salons, picks the latest milestone the salon has crossed but
hasn't received an email for, and sends a templated reminder via
SMTP2GO. Dedup state lives in `salon.lifecycleReminderState`
(JSONB keyed by milestone code).

| Milestone | Trigger | What it says |
| --- | --- | --- |
| `setup_d7` | day ≥ 7 in SETUP | Mid-setup nudge. |
| `setup_d11` | day ≥ 11 in SETUP | 3 days left for +30 day bonus. |
| `setup_d13` | day ≥ 13 in SETUP | Last day for bonus. |
| `grace_d17` | grace ≤ 4 days left | Add payment method. |
| `grace_d20` | grace ≤ 1 day left | Account locks tomorrow. |
| `payment_required_d0` | status flipped to `PAYMENT_REQUIRED` | Locked, here's how to unlock. |

`ACTIVE_PAID` / `SUSPENDED` / `CANCELLED` salons are out of scope —
the cron never touches them, so reviewer accounts (pinned to
`ACTIVE_PAID` at create time) are silent by construction.

## Env vars added

| Name | What it does |
| --- | --- |
| `LEAD_CREATED_WEBHOOK_URL` | n8n webhook fired when `/api/salons` succeeds (Lead row created server-side). |
| `PUBLIC_APP_URL` | Used as the base for setup-center deep-link CTAs in lifecycle reminder emails. |
| `REVIEWER_IDENTITY_EMAILS` | Comma-separated email allowlist whose `/api/salons` calls pin the salon to `ACTIVE_PAID`. |
| `NEXT_PUBLIC_APPLE_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` / `NEXT_PUBLIC_WEB_PANEL_URL` | Marketing site `/baslayalim` download badges + web fallback. |
