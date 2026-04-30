CREATE TABLE "ConversationRealtimeEvent" (
  "id" SERIAL NOT NULL,
  "salonId" INTEGER NOT NULL,
  "channel" "ChannelType" NOT NULL,
  "conversationKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "messageEventId" INTEGER,
  "eventTimestamp" TIMESTAMP(6) NOT NULL,
  "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationRealtimeEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConversationRealtimeEvent_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_conv_realtime_salon_cursor"
  ON "ConversationRealtimeEvent"("salonId", "id");

CREATE INDEX "idx_conv_realtime_salon_channel_cursor"
  ON "ConversationRealtimeEvent"("salonId", "channel", "id");

CREATE INDEX "idx_conv_realtime_salon_conv_cursor"
  ON "ConversationRealtimeEvent"("salonId", "channel", "conversationKey", "id");

CREATE INDEX "idx_conv_realtime_message_event_id"
  ON "ConversationRealtimeEvent"("messageEventId");
