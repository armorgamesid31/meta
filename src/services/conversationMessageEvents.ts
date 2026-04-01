import {
  ChannelType,
  InboundMessageStatus,
  MessageEventDirection,
  OutboundMessageSource,
  Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { publishConversationStreamEvent } from './conversationEventsBus.js';

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

  await prisma.conversationMessageEvent.upsert({
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
  });

  publishConversationStreamEvent({
    salonId: input.salonId,
    channel: input.channel,
    conversationKey: input.conversationKey,
    providerMessageId,
    messageType: input.messageType,
    direction: input.direction,
    eventTimestamp: input.eventTimestamp.toISOString(),
  });
}
