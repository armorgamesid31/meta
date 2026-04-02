# Meta Instagram App Review Runbook

Last updated: 2026-04-02 (UTC)

## 1. Purpose

This runbook documents the production-ready Instagram connection flow for Meta Direct, including setup, validation, troubleshooting, and App Review submission evidence.

## 2. Preconditions

1. App mode and type:
- App is in `Live` mode.
- App type is `Business`.

2. Required environment variables on backend:
- `META_INSTAGRAM_APP_ID`
- `META_INSTAGRAM_APP_SECRET`
- `META_REDIRECT_URI`
- `META_STATE_SECRET`
- `META_GRAPH_VERSION`
- `META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN`

3. Redirect URI exact match:
- `META_REDIRECT_URI` must match Meta Dashboard OAuth redirect URI exactly, including scheme, host, path, and trailing slash behavior.

4. Instagram permissions enabled in app:
- `instagram_business_basic`
- `instagram_business_manage_messages`

5. Webhook configuration:
- Callback URL points to backend webhook endpoint.
- Verify token matches `META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
- Instagram messaging events are subscribed.

6. Public policy URLs prepared for review:
- Privacy policy URL
- Data deletion instructions URL
- Deauthorization callback URL

## 3. Production Connection Flow

1. User opens the app and goes to `Meta Direct`.
2. User clicks `Start Instagram Login Connection`.
3. OAuth popup opens using `https://www.instagram.com/oauth/authorize`.
4. After consent, Meta redirects to:
- `GET /api/app/meta-direct/callback?code=...&state=...`
5. Backend exchanges code for token and validates token against Instagram Graph.
6. Backend stores Instagram connection state and binding.
7. Status endpoint confirms readiness:
- `GET /api/app/meta-direct/status`

Expected connected result:
- `instagram.status = CONNECTED`
- `diagnostics.tokenValid = true`
- `bindingReady = true`

## 4. Webhook Validation Steps

1. Confirm webhook handshake:
- Trigger verify challenge from Meta Dashboard.
- Backend must return challenge successfully.

2. Send a real Instagram DM to connected account.

3. Validate status and logs:
- `lastWebhookAt` should be updated in `/api/app/meta-direct/status`.
- Webhook logs should show inbound event reception.

4. If webhook is subscribed but no message observed:
- `status` may remain `DEGRADED`.
- `diagnostics.missingRequirements` should guide missing pieces.

## 5. Failure Matrix

1. Error: `Invalid redirect_uri`
- Cause: Redirect URI mismatch.
- Action: Ensure exact URI parity between app env and Meta OAuth settings.

2. Error: `token_not_verified`
- Cause: Token exchange succeeded but validation probe failed.
- Action: Reconnect with fresh OAuth code and verify required permissions.

3. Error: `webhook_not_observed`
- Cause: No webhook event ingested yet.
- Action: Verify subscription setup and send a real DM to trigger event.

4. Error: `webhook_subscription_unconfirmed`
- Cause: Subscription attempt is missing or failing.
- Action: Confirm event subscriptions in Meta Dashboard and retest.

## 6. One-Time Environment Reset and Test Salon Preparation

1. Reset all Instagram connection setup data:

```bash
node scripts/reset-instagram-connections.mjs --dry-run
node scripts/reset-instagram-connections.mjs --apply
```

2. Optional single salon reset:

```bash
node scripts/reset-instagram-connections.mjs --apply --salon-id=5
```

3. Create a fresh review test salon through real registration flow:

```bash
node scripts/create-meta-review-test-salon.mjs --base-url=https://app.berkai.shop
```

The script outputs:
- `salonId`
- `email`
- `password`
- `accessToken`
- `refreshToken`

## 7. Reviewer Test Script

1. Login to app with reviewer test credentials.
2. Open `Meta Direct`.
3. Click `Start Instagram Login Connection`.
4. Complete OAuth consent with Instagram business account.
5. Return to app and verify:
- `Connected` status visible.
- `Run Probe` succeeds.
6. Send test DM from external account.
7. Verify webhook evidence:
- `lastWebhookAt` populated.
- Conversation/inbox receives the message.

## 8. Submission Checklist

1. Permissions requested match implemented feature behavior.
2. Privacy policy URL is public and accurate.
3. Data deletion URL is public and accurate.
4. Deauthorization callback is configured and documented.
5. Screencast includes:
- Login to app
- Connect Instagram flow
- Successful connected status
- Incoming DM event processing evidence
6. Reviewer notes include:
- Test account credentials
- Exact click path in app
- Expected visible success markers
- Troubleshooting fallback steps

## 9. Operational Notes

1. Keep `META_INSTAGRAM_APP_SECRET` rotated by policy.
2. Keep `META_GRAPH_VERSION` current and retest flow after upgrades.
3. Re-run probe after any Meta configuration change.
4. If status becomes `DEGRADED`, prioritize webhook subscription and event observation checks.
