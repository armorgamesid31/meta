import {
  ChannelType,
  InboundMessageStatus,
  MessageEventDirection,
  OutboundMessageSource,
  Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { publishConversationStreamEvent } from './conversationEventsBus.js';
import { createRealtimeEventInTx } from './conversationRealtimeEvents.js';

type UpsertConversationMessageEventInput = {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  providerMessageId: string;
  externalAccountId?: string | null;
  customerName?: string | null;
  messageType: string;
  text?: string | null;
  direction: MessageEventDirection;
  eventTimestamp: Date;
  processingStatus?: InboundMessageStatus | null;
  outboundSource?: OutboundMessageSource | null;
  outboundSenderUserId?: number | null;
  outboundSenderEmail?: string | null;
  rawPayload: Prisma.InputJsonValue;
};

export async function upsertConversationMessageEvent(
  input: UpsertConversationMessageEventInput,
): Promise<void> {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId) {
    return;
  }

  const realtimeEvent = await prisma.$transaction(async (tx) => {
    const saved = await tx.conversationMessageEvent.upsert({
      where: {
        channel_providerMessageId: {
          channel: input.channel,
          providerMessageId,
        },
      },
      update: {
        salonId: input.salonId,
        conversationKey: input.conversationKey,
        externalAccountId: input.externalAccountId || null,
        customerName: input.customerName || null,
        messageType: input.messageType,
        text: input.text || null,
        direction: input.direction,
        eventTimestamp: input.eventTimestamp,
        processingStatus: input.processingStatus || null,
        outboundSource: input.outboundSource || null,
        outboundSenderUserId: input.outboundSenderUserId || null,
        outboundSenderEmail: input.outboundSenderEmail || null,
        rawPayload: input.rawPayload,
        updatedAt: new Date(),
      },
      create: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: input.conversationKey,
        providerMessageId,
        externalAccountId: input.externalAccountId || null,
        customerName: input.customerName || null,
        messageType: input.messageType,
        text: input.text || null,
        direction: input.direction,
        eventTimestamp: input.eventTimestamp,
        processingStatus: input.processingStatus || null,
        outboundSource: input.outboundSource || null,
        outboundSenderUserId: input.outboundSenderUserId || null,
        outboundSenderEmail: input.outboundSenderEmail || null,
        rawPayload: input.rawPayload,
      },
      select: {
        id: true,
        channel: true,
        conversationKey: true,
        eventTimestamp: true,
        messageType: true,
      },
    });

    return createRealtimeEventInTx(tx, {
      salonId: input.salonId,
      channel: saved.channel,
      conversationKey: saved.conversationKey,
      eventType: saved.messageType || input.messageType,
      messageEventId: saved.id,
      eventTimestamp: saved.eventTimestamp,
    });
  });

  publishConversationStreamEvent({
    cursor: realtimeEvent.cursor,
    salonId: realtimeEvent.salonId,
    channel: realtimeEvent.channel,
    conversationKey: realtimeEvent.conversationKey,
    eventType: realtimeEvent.eventType,
    messageEventId: realtimeEvent.messageEventId,
    eventTimestamp: realtimeEvent.eventTimestamp,
  });
}
