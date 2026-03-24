-- CreateEnum
CREATE TYPE "ConversationAutomationMode" AS ENUM ('AUTO', 'HUMAN_PENDING', 'HUMAN_ACTIVE', 'MANUAL_ALWAYS', 'AUTO_RESUME_PENDING');

-- CreateTable
CREATE TABLE "ConversationState" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "canonicalUserId" TEXT,
    "customerId" INTEGER,
    "mode" "ConversationAutomationMode" NOT NULL DEFAULT 'AUTO',
    "humanPendingSince" TIMESTAMP(6),
    "humanActiveUntil" TIMESTAMP(6),
    "lastHumanMessageAt" TIMESTAMP(6),
    "lastCustomerMessageAt" TIMESTAMP(6),
    "manualAlways" BOOLEAN NOT NULL DEFAULT false,
    "profileName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_conversation_state_salon_channel_key" ON "ConversationState"("salonId", "channel", "conversationKey");

-- CreateIndex
CREATE INDEX "idx_conversation_state_salon_mode_updated" ON "ConversationState"("salonId", "mode", "updatedAt");

-- CreateIndex
CREATE INDEX "idx_conversation_state_canonical" ON "ConversationState"("canonicalUserId");

-- AddForeignKey
ALTER TABLE "ConversationState" ADD CONSTRAINT "ConversationState_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
