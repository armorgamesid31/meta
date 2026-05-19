-- Lead capture flow (marketing site → /baslayalim form → email link → activation).
--
-- A "Lead" is a salon owner who filled the marketing form but hasn't yet
-- created an account. Once they click the activation link in the
-- delivery email, we run the normal /api/auth/register-salon flow
-- (which fires startSetupPeriod and seeds the 14-day setup window).
--
-- We deliberately keep Lead as a separate table from Salon — they're
-- different lifecycle stages: a Lead can sit for weeks before
-- activating, can expire, can be marked spam, can have multiple
-- duplicate entries from the same phone. Once activated, the row
-- points to the resulting Salon via activatedSalonId.

CREATE TYPE "LeadStatus" AS ENUM (
  'NEW',         -- created, not yet sent invite
  'INVITED',     -- activation email sent
  'ACTIVATED',   -- salon created from this lead
  'EXPIRED',     -- activation TTL passed
  'BLOCKED'      -- admin/spam-blocked
);

CREATE TABLE "Lead" (
  "id"                     SERIAL PRIMARY KEY,
  "status"                 "LeadStatus" NOT NULL DEFAULT 'NEW',

  -- Contact + business info collected by the form.
  "contactName"            TEXT NOT NULL,
  "phone"                  TEXT NOT NULL,
  "phoneNormalized"        TEXT NOT NULL,
  "email"                  TEXT NOT NULL,
  "emailNormalized"        TEXT NOT NULL,
  "salonName"              TEXT NOT NULL,
  "salonCategory"          "SalonCategory",

  -- Attribution: utm_*, referrer, IP, user agent.
  "utmSource"              TEXT,
  "utmMedium"              TEXT,
  "utmCampaign"            TEXT,
  "utmContent"             TEXT,
  "utmTerm"                TEXT,
  "referrer"               TEXT,
  "landingPath"            TEXT,
  "ipAddress"              TEXT,
  "userAgent"              TEXT,

  -- KVKK consent. acceptMarketing = optional checkbox.
  "kvkkConsentAt"          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptMarketing"        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Activation token. The raw token is sent to the user via email; we
  -- store only the SHA-256 hash so a DB leak doesn't enable account
  -- takeover. Same pattern as VerificationLink.
  "activationTokenHash"    TEXT NOT NULL UNIQUE,
  "activationLinkSentAt"   TIMESTAMP(6),
  "activationLinkSendCount" INTEGER NOT NULL DEFAULT 0,
  "activationLastError"    TEXT,
  "expiresAt"              TIMESTAMP(6) NOT NULL,

  -- Where it ended up.
  "activatedAt"            TIMESTAMP(6),
  "activatedSalonId"       INTEGER,

  -- n8n webhook delivery (so support can see if the bridge fired).
  "webhookSentAt"          TIMESTAMP(6),
  "webhookLastError"       TEXT,

  -- Free-text for internal notes / spam reason.
  "internalNotes"          TEXT,

  "createdAt"              TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fk_lead_activated_salon"
    FOREIGN KEY ("activatedSalonId") REFERENCES "Salon"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_lead_email_normalized"  ON "Lead" ("emailNormalized");
CREATE INDEX "idx_lead_phone_normalized"  ON "Lead" ("phoneNormalized");
CREATE INDEX "idx_lead_status_created"    ON "Lead" ("status", "createdAt");
CREATE INDEX "idx_lead_activated_salon"   ON "Lead" ("activatedSalonId") WHERE "activatedSalonId" IS NOT NULL;
