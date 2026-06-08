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
import { upsertConversationThreadSummaryInTx } from './conversationThreadSummary.js';

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
  // Structured media metadata extracted from the channel webhook. Each entry:
  //   { index, type: 'image'|'video'|'audio', mimeType, sizeBytes?,
  //     durationSec?, isVoice?, caption?, providerMediaId?, providerMediaUrl? }
  // Stored separately from rawPayload so the read path stays channel-agnostic
  // and we can index/query it (e.g. messages-with-media filter).
  mediaItems?: Prisma.InputJsonValue | null;
  // For outbound rows that were uploaded before sending: skip the lazy-fetch
  // path entirely and prefill the R2-cached metadata at insert time.
  mediaCached?: Prisma.InputJsonValue | null;
  mediaCachedAt?: Date | null;
  metaMediaIds?: Prisma.InputJsonValue | null;
  // Quote-reply: which earlier message this reply targets (DB id + provider
  // id for Meta context, plus a text snapshot for the UI's quoted block).
  repliedToMessageId?: number | null;
  repliedToProviderMessageId?: string | null;
  repliedToText?: string | null;
};

export async function upsertConversationMessageEvent(
  input: UpsertConversationMessageEventInput,
): Promise<void> {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId) {
    return;
  }

  const realtimeEvent = await prisma.$transaction(async (tx) => {
    const existingEvent = await tx.conversationMessageEvent.findUnique({
      where: {
        channel_providerMessageId: {
          channel: input.channel,
          providerMessageId,
        },
      },
      select: {
        id: true,
      },
    });

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
        // Only overwrite mediaItems / mediaCached when caller passes them.
        // Idempotent webhook redelivery shouldn't blow away a successful
        // lazy fetch that happened between the two webhooks.
        ...(input.mediaItems !== undefined ? { mediaItems: input.mediaItems } : {}),
        ...(input.mediaCached !== undefined ? { mediaCached: input.mediaCached } : {}),
        ...(input.mediaCachedAt !== undefined ? { mediaCachedAt: input.mediaCachedAt } : {}),
        ...(input.metaMediaIds !== undefined ? { metaMediaIds: input.metaMediaIds } : {}),
        ...(input.repliedToMessageId !== undefined ? { repliedToMessageId: input.repliedToMessageId } : {}),
        ...(input.repliedToProviderMessageId !== undefined ? { repliedToProviderMessageId: input.repliedToProviderMessageId } : {}),
        ...(input.repliedToText !== undefined ? { repliedToText: input.repliedToText } : {}),
        updatedAt: new Date(),
      } as any,
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
        mediaItems: input.mediaItems ?? undefined,
        mediaCached: input.mediaCached ?? undefined,
        mediaCachedAt: input.mediaCachedAt ?? undefined,
        metaMediaIds: input.metaMediaIds ?? undefined,
        repliedToMessageId: input.repliedToMessageId ?? undefined,
        repliedToProviderMessageId: input.repliedToProviderMessageId ?? undefined,
        repliedToText: input.repliedToText ?? undefined,
      },
      select: {
        id: true,
        channel: true,
        conversationKey: true,
        eventTimestamp: true,
        messageType: true,
      },
    });

    await upsertConversationThreadSummaryInTx(tx, {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      externalAccountId: input.externalAccountId || null,
      customerName: input.customerName || null,
      messageType: input.messageType,
      text: input.text || null,
      direction: input.direction,
      eventTimestamp: input.eventTimestamp,
      processingStatus: input.processingStatus || null,
      rawPayload: input.rawPayload,
      incrementCounters: !existingEvent,
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
