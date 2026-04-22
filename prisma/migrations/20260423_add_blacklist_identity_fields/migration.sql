ALTER TABLE "BlacklistEntry"
  ADD COLUMN IF NOT EXISTS "channel" "ChannelType",
  ADD COLUMN IF NOT EXISTS "subjectNormalized" TEXT;

CREATE INDEX IF NOT EXISTS "idx_blacklist_identity_active"
  ON "BlacklistEntry"("salonId", "channel", "subjectNormalized", "isActive");
