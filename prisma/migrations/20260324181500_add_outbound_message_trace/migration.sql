-- CreateEnum
CREATE TYPE "OutboundMessageSource" AS ENUM ('AI_AGENT', 'HUMAN_APP');

-- CreateTable
CREATE TABLE "OutboundMessageTrace" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "canonicalUserId" TEXT,
    "customerId" INTEGER,
    "source" "OutboundMessageSource" NOT NULL,
    "text" TEXT,
    "sentAt" TIMESTAMP(6) NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessageTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_outbound_trace_channel_provider_message" ON "OutboundMessageTrace"("channel", "providerMessageId");

-- CreateIndex
CREATE INDEX "idx_outbound_trace_salon_conv_sent" ON "OutboundMessageTrace"("salonId", "channel", "conversationKey", "sentAt");

-- CreateIndex
CREATE INDEX "idx_outbound_trace_source_sent" ON "OutboundMessageTrace"("source", "sentAt");

-- AddForeignKey
ALTER TABLE "OutboundMessageTrace" ADD CONSTRAINT "OutboundMessageTrace_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
