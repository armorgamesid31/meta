-- Instagram account verification by code-DM. Additive only — safe on live prod.
CREATE TABLE IF NOT EXISTS "InstagramVerificationCode" (
  "id"             TEXT PRIMARY KEY,
  "code"           TEXT NOT NULL,
  "salonId"        INTEGER NOT NULL,
  "phoneE164"      TEXT,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "boundIgsid"     TEXT,
  "boundUsername"  TEXT,
  "targetUsername" TEXT,
  "expiresAt"      TIMESTAMP(6) NOT NULL,
  "usedAt"         TIMESTAMP(6),
  "createdAt"      TIMESTAMP(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "InstagramVerificationCode_code_key" ON "InstagramVerificationCode" ("code");
CREATE INDEX IF NOT EXISTS "idx_ig_verify_status" ON "InstagramVerificationCode" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "idx_ig_verify_salon_phone" ON "InstagramVerificationCode" ("salonId", "phoneE164");
