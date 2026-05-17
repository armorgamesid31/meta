-- 6-digit email OTP storage, used by the invite activation flow so a
-- new teammate proves their email in addition to their phone. We don't
-- reuse CustomerPhoneVerification because that table is keyed by phone,
-- has a NOT NULL phone column, and would muddy the per-salon analytics
-- that read it.

CREATE TABLE "EmailOtpVerification" (
  "id"           TEXT PRIMARY KEY,
  "salonId"      INTEGER,
  "email"        TEXT NOT NULL,
  "codeHash"     TEXT NOT NULL,
  "purpose"      TEXT NOT NULL DEFAULT 'INVITE_EMAIL',
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts"  INTEGER NOT NULL DEFAULT 5,
  "sendCount"    INTEGER NOT NULL DEFAULT 1,
  "expiresAt"    TIMESTAMP(6) NOT NULL,
  "verifiedAt"   TIMESTAMP(6),
  "lastSentAt"   TIMESTAMP(6),
  "createdAt"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "idx_email_otp_email_status" ON "EmailOtpVerification"("email", "status");
CREATE INDEX "idx_email_otp_expires" ON "EmailOtpVerification"("expiresAt");
