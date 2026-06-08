-- Cross-channel / cross-salon identity unification layer.
-- Additive only (CREATE TABLE / ADD COLUMN nullable) — safe on live prod.
-- Applied out-of-band via psql / prisma db execute (shadow-DB drift makes
-- `prisma migrate dev` fail here — see kedy-data-model migration notes).

-- Platform-wide (channel, subject) -> GlobalCustomerIdentity index.
CREATE TABLE IF NOT EXISTS "GlobalIdentityChannel" (
  "id"                    TEXT PRIMARY KEY,
  "globalIdentityId"      TEXT NOT NULL,
  "channel"               "ChannelType" NOT NULL,
  "subjectType"           "IdentitySubjectType" NOT NULL,
  "subjectNormalized"     TEXT NOT NULL,
  "subjectRaw"            TEXT,
  "profileUsername"       TEXT,
  "profilePicUrl"         TEXT,
  "profilePicRefreshedAt" TIMESTAMP(6),
  "verifiedAt"            TIMESTAMP(6),
  "createdAt"             TIMESTAMP(6) NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMP(6) NOT NULL DEFAULT now(),
  CONSTRAINT "GlobalIdentityChannel_globalIdentityId_fkey"
    FOREIGN KEY ("globalIdentityId") REFERENCES "GlobalCustomerIdentity"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_global_identity_channel_subject"
  ON "GlobalIdentityChannel" ("channel", "subjectNormalized");
CREATE INDEX IF NOT EXISTS "idx_global_identity_channel_identity"
  ON "GlobalIdentityChannel" ("globalIdentityId");

-- Pending IG username claim (typed at registration, not yet bound to an IGSID).
ALTER TABLE "GlobalCustomerIdentity"
  ADD COLUMN IF NOT EXISTS "pendingInstagramUsername" TEXT;
CREATE INDEX IF NOT EXISTS "idx_global_identity_pending_ig_username"
  ON "GlobalCustomerIdentity" ("pendingInstagramUsername");
