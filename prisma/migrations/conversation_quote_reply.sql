-- Quote-reply: when a salon staff replies to a specific older message
-- (instead of just the latest), we store both the in-DB pointer (id) and
-- the provider message id so the outbound Meta API call can attach the
-- proper context payload.
--
--   repliedToMessageId          → our ConversationMessageEvent.id
--   repliedToProviderMessageId  → the original provider's id (used for
--                                  WhatsApp `context.message_id` and the
--                                  Instagram reply ref pattern).
--   repliedToText               → snapshot of the original message text
--                                  (or media-type label) at reply time,
--                                  for the quoted-block UI even if the
--                                  source message is later edited/deleted.

ALTER TABLE "ConversationMessageEvent"
  ADD COLUMN IF NOT EXISTS "repliedToMessageId"         INTEGER,
  ADD COLUMN IF NOT EXISTS "repliedToProviderMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "repliedToText"              TEXT;

CREATE INDEX IF NOT EXISTS "idx_message_event_replied_to"
  ON "ConversationMessageEvent" ("repliedToMessageId")
  WHERE "repliedToMessageId" IS NOT NULL;
