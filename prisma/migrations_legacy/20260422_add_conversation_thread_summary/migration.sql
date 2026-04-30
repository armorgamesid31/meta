CREATE TABLE "ConversationThreadSummary" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "channel" "ChannelType" NOT NULL,
  "conversationKey" TEXT NOT NULL,
  "customerName" TEXT,
  "profileUsername" TEXT,
  "profilePicUrl" TEXT,
  "lastMessageType" TEXT NOT NULL,
  "lastMessageText" TEXT,
  "lastDirection" "MessageEventDirection" NOT NULL,
  "lastEventTimestamp" TIMESTAMP(6) NOT NULL,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "hasHandoverRequest" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationThreadSummary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConversationThreadSummary_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "uq_conv_thread_summary_salon_channel_key"
  ON "ConversationThreadSummary"("salonId", "channel", "conversationKey");

CREATE INDEX "idx_conv_thread_summary_salon_channel_last_ts"
  ON "ConversationThreadSummary"("salonId", "channel", "lastEventTimestamp");

CREATE INDEX "idx_conv_thread_summary_salon_last_ts"
  ON "ConversationThreadSummary"("salonId", "lastEventTimestamp");
