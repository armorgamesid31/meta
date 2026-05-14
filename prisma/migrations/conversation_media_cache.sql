-- Add lazy-cache columns to ConversationMessageEvent for inbound + outbound
-- media (image, video, audio). See conversationMediaCache.ts for the schema
-- of each JSON column.

ALTER TABLE "ConversationMessageEvent"
  ADD COLUMN IF NOT EXISTS "mediaItems"     JSONB,
  ADD COLUMN IF NOT EXISTS "mediaCached"    JSONB,
  ADD COLUMN IF NOT EXISTS "mediaCachedAt"  TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "metaMediaIds"   JSONB;

CREATE INDEX IF NOT EXISTS "idx_message_event_media_cached_at"
  ON "ConversationMessageEvent" ("mediaCachedAt")
  WHERE "mediaCachedAt" IS NOT NULL;
