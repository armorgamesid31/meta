-- Per-user conversation read state.
--
-- Until now `ConversationThreadSummary.unreadCount` held a single
-- salon-wide unread count: every staff member saw the same number
-- regardless of who had actually looked at the thread. That meant
-- multi-device sync was effectively broken (open on phone, web still
-- shows unread) and multi-staff teams kept seeing "fresh" badges for
-- conversations a colleague had already handled.
--
-- This table tracks the high-water mark per (salon, user, channel,
-- conversation). The conversations list query joins against it to
-- compute a per-user unreadCount. A mark-read endpoint upserts the
-- row with the latest event timestamp the user has seen.

CREATE TABLE "ConversationReadState" (
  "id"                     SERIAL PRIMARY KEY,
  "salonId"                INTEGER NOT NULL,
  "userId"                 INTEGER NOT NULL,
  "channel"                "ChannelType" NOT NULL,
  "conversationKey"        TEXT NOT NULL,
  "lastReadEventTimestamp" TIMESTAMP(6) NOT NULL,
  "updatedAt"              TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "uq_conv_read_state_salon_user_channel_key"
  ON "ConversationReadState"("salonId", "userId", "channel", "conversationKey");

CREATE INDEX "idx_conv_read_state_salon_user"
  ON "ConversationReadState"("salonId", "userId");

CREATE INDEX "idx_conv_read_state_salon_channel_key"
  ON "ConversationReadState"("salonId", "channel", "conversationKey");
