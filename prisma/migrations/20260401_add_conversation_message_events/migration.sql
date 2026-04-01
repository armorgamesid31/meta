-- CreateEnum
CREATE TYPE "MessageEventDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateTable
CREATE TABLE "ConversationMessageEvent" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "customerName" TEXT,
    "messageType" TEXT NOT NULL,
    "text" TEXT,
    "direction" "MessageEventDirection" NOT NULL,
    "eventTimestamp" TIMESTAMP(6) NOT NULL,
    "processingStatus" "InboundMessageStatus" DEFAULT 'DONE',
    "outboundSource" "OutboundMessageSource",
    "outboundSenderUserId" INTEGER,
    "outboundSenderEmail" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_event_channel_provider" ON "ConversationMessageEvent"("channel", "providerMessageId");

-- CreateIndex
CREATE INDEX "idx_message_event_salon_conv_ts" ON "ConversationMessageEvent"("salonId", "channel", "conversationKey", "eventTimestamp");

-- CreateIndex
CREATE INDEX "idx_message_event_salon_channel_ts" ON "ConversationMessageEvent"("salonId", "channel", "eventTimestamp");

-- CreateIndex
CREATE INDEX "idx_message_event_salon_conv_status" ON "ConversationMessageEvent"("salonId", "channel", "conversationKey", "processingStatus");

-- AddForeignKey
ALTER TABLE "ConversationMessageEvent" ADD CONSTRAINT "ConversationMessageEvent_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Backfill persistent message history from existing queue rows
INSERT INTO "ConversationMessageEvent" (
    "salonId",
    "channel",
    "conversationKey",
    "providerMessageId",
    "externalAccountId",
    "customerName",
    "messageType",
    "text",
    "direction",
    "eventTimestamp",
    "processingStatus",
    "outboundSource",
    "outboundSenderUserId",
    "outboundSenderEmail",
    "rawPayload",
    "createdAt",
    "updatedAt"
)
SELECT
    i."salonId",
    i."channel",
    i."conversationKey",
    i."providerMessageId",
    i."externalAccountId",
    i."customerName",
    i."messageType",
    i."text",
    CASE
      WHEN lower(i."messageType") = 'handover_request' THEN 'SYSTEM'::"MessageEventDirection"
      WHEN lower(i."messageType") LIKE 'echo_%' OR lower(i."messageType") LIKE '%outbound%' THEN 'OUTBOUND'::"MessageEventDirection"
      ELSE 'INBOUND'::"MessageEventDirection"
    END,
    i."eventTimestamp",
    i."status",
    CASE
      WHEN upper(coalesce(i."rawPayload"->>'source', '')) IN ('AI_AGENT', 'HUMAN_APP')
      THEN (upper(i."rawPayload"->>'source'))::"OutboundMessageSource"
      ELSE NULL
    END,
    CASE
      WHEN coalesce(i."rawPayload"->'sentBy'->>'userId', '') ~ '^[0-9]+$'
      THEN (i."rawPayload"->'sentBy'->>'userId')::INTEGER
      ELSE NULL
    END,
    NULLIF(i."rawPayload"->'sentBy'->>'email', ''),
    i."rawPayload",
    i."createdAt",
    i."updatedAt"
FROM "InboundMessageQueue" i
ON CONFLICT ("channel", "providerMessageId")
DO UPDATE SET
    "salonId" = EXCLUDED."salonId",
    "conversationKey" = EXCLUDED."conversationKey",
    "externalAccountId" = EXCLUDED."externalAccountId",
    "customerName" = EXCLUDED."customerName",
    "messageType" = EXCLUDED."messageType",
    "text" = EXCLUDED."text",
    "direction" = EXCLUDED."direction",
    "eventTimestamp" = EXCLUDED."eventTimestamp",
    "processingStatus" = EXCLUDED."processingStatus",
    "outboundSource" = EXCLUDED."outboundSource",
    "outboundSenderUserId" = EXCLUDED."outboundSenderUserId",
    "outboundSenderEmail" = EXCLUDED."outboundSenderEmail",
    "rawPayload" = EXCLUDED."rawPayload",
    "updatedAt" = EXCLUDED."updatedAt";
