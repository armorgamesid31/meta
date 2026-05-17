-- Multi-step team-invite registration session.
--
-- Each row tracks a single user's progress through the new step-by-step
-- onboarding (ad → soyad → cinsiyet → telefon → telefon magic-link →
-- email → email magic-link → foto → şifre). The two magic-link tokens
-- live on this row so the /status polling endpoint can answer "is the
-- phone verified yet?" with a single key lookup.

CREATE TABLE "OnboardingSession" (
  "id"                TEXT PRIMARY KEY,
  "inviteId"          INTEGER NOT NULL,
  "firstName"         TEXT,
  "lastName"          TEXT,
  "gender"            TEXT,
  "phone"             TEXT,
  "email"             TEXT,
  "photoUrl"          TEXT,
  "passwordHash"      TEXT,
  "phoneToken"        TEXT,
  "phoneTokenSentAt"  TIMESTAMP(6),
  "phoneVerifiedAt"   TIMESTAMP(6),
  "emailToken"        TEXT,
  "emailTokenSentAt"  TIMESTAMP(6),
  "emailVerifiedAt"   TIMESTAMP(6),
  "activatedAt"       TIMESTAMP(6),
  "expiresAt"         TIMESTAMP(6) NOT NULL,
  "createdAt"         TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "uq_onboarding_phone_token" ON "OnboardingSession"("phoneToken");
CREATE UNIQUE INDEX "uq_onboarding_email_token" ON "OnboardingSession"("emailToken");
CREATE INDEX "idx_onboarding_invite" ON "OnboardingSession"("inviteId");
CREATE INDEX "idx_onboarding_phone_token" ON "OnboardingSession"("phoneToken");
CREATE INDEX "idx_onboarding_email_token" ON "OnboardingSession"("emailToken");
CREATE INDEX "idx_onboarding_expires" ON "OnboardingSession"("expiresAt");
