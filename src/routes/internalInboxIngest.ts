import {
  ChannelType,
  ConversationAutomationMode,
  InboundMessageStatus,
  OutboundMessageSource,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { upsertConversationMessageEvent } from '../services/conversationMessageEvents.js';

const router = Router();

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asNullableString(value);
    if (normalized) return normalized;
  }
  return null;
}

function mergeInstagramProfile(input: {
  row: Record<string, any>;
  rawSource: unknown;
}): { name: string | null; normalizedRawPayload: Prisma.InputJsonValue } {
  const rawObj = asObject(input.rawSource);
  const instagramProfile = asObject(rawObj.instagramProfile);
  const channelProfile = asObject(rawObj.channelProfile);

  const profileName = firstNonEmptyString([
    input.row.customerName,
    input.row.profileName,
    input.row.profile_name,
    input.row.rawProfileName,
    instagramProfile.name,
    channelProfile.name,
  ]);

  const username = firstNonEmptyString([
    input.row.profileUsername,
    input.row.profile_username,
    instagramProfile.username,
    channelProfile.username,
  ]);

  const profilePic = firstNonEmptyString([
    input.row.profilePictureUrl,
    input.row.profile_picture_url,
    input.row.profilePicUrl,
    instagramProfile.profile_pic,
    instagramProfile.profilePic,
    instagramProfile.profilePictureUrl,
    channelProfile.profile_pic,
    channelProfile.profilePic,
    channelProfile.profilePictureUrl,
  ]);

  const profileId = firstNonEmptyString([
    instagramProfile.id,
    channelProfile.id,
  ]);

  const hasProfileData = Boolean(profileName || username || profilePic || profileId);
  if (!hasProfileData) {
    return {
      name: profileName,
      normalizedRawPayload: (Object.keys(rawObj).length ? rawObj : input.row) as Prisma.InputJsonValue,
    };
  }

  const nextRaw = Object.keys(rawObj).length ? { ...rawObj } : { ...input.row };
  nextRaw.instagramProfile = {
    ...asObject(nextRaw.instagramProfile),
    ...(profileId ? { id: profileId } : {}),
    ...(profileName ? { name: profileName } : {}),
    ...(username ? { username } : {}),
    ...(profilePic ? { profile_pic: profilePic } : {}),
  };

  if (!Object.keys(asObject(nextRaw.channelProfile)).length) {
    nextRaw.channelProfile = {
      ...(profileId ? { id: profileId } : {}),
      ...(profileName ? { name: profileName } : {}),
      ...(username ? { username } : {}),
      ...(profilePic ? { profile_pic: profilePic } : {}),
    };
  }

  return {
    name: profileName,
    normalizedRawPayload: nextRaw as Prisma.InputJsonValue,
  };
}

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) {
    return true;
  }
  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

function asChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') {
    return normalized as ChannelType;
  }
  return null;
}

function toEventDate(payload: any): Date {
  if (payload?.eventTimestamp && typeof payload.eventTimestamp === 'string') {
    const parsed = new Date(payload.eventTimestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const rawTs = Number(payload?.timestamp);
  if (Number.isFinite(rawTs) && rawTs > 0) {
    const ms = rawTs > 1e12 ? rawTs : rawTs * 1000;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function buildMessageSignature(input: {
  conversationKey: string;
  messageType: string;
  text: string | null;
  eventDate: Date;
}) {
  const raw = [
    input.conversationKey.trim(),
    input.messageType.trim(),
    (input.text || '').trim(),
    input.eventDate.toISOString(),
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

async function resolveSalonId(channel: ChannelType, externalAccountId: string | null, externalBusinessId: string | null) {
  const candidates = [externalAccountId, externalBusinessId].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );

  if (!candidates.length) return null;

  const binding = await prisma.salonChannelBinding.findFirst({
    where: {
      channel,
      isActive: true,
      externalAccountId: { in: candidates },
    },
    orderBy: {
      salonId: 'asc',
    },
    select: { salonId: true },
  });

  return binding?.salonId || null;
}

function isOutboundEcho(row: any): boolean {
  if (row?.isEcho === true) return true;
  const direction = typeof row?.direction === 'string' ? row.direction.trim().toLowerCase() : '';
  return direction === 'outbound' || direction === 'echo';
}

const HUMAN_ACTIVE_MINUTES = Number(process.env.CONVERSATION_HUMAN_ACTIVE_MINUTES || 240);

router.post('/ingest', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const payload = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : [req.body];
  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({ message: 'Body must be an object, array, or { items: [...] }' });
  }

  const results: Array<{ index: number; ok: boolean; result: string; id?: number | null }> = [];

  for (let i = 0; i < payload.length; i += 1) {
    const row = payload[i] || {};
    const channel = asChannel(row.channel);
    let providerMessageId = typeof row.providerMessageId === 'string' ? row.providerMessageId.trim() : '';
    const conversationKey = typeof row.conversationKey === 'string' ? row.conversationKey.trim() : '';
    const externalAccountId = typeof row.externalAccountId === 'string' ? row.externalAccountId.trim() : null;
    const externalBusinessId = typeof row.externalBusinessId === 'string' ? row.externalBusinessId.trim() : null;
    const rawSource = row.raw ?? row.body ?? row;
    const instagramMerge =
      channel === 'INSTAGRAM'
        ? mergeInstagramProfile({ row, rawSource })
        : null;
    const customerName =
      channel === 'INSTAGRAM'
        ? firstNonEmptyString([row.customerName, row.profileName, row.profile_name, instagramMerge?.name])
        : asNullableString(row.customerName);
    const messageType = typeof row.messageType === 'string' && row.messageType.trim() ? row.messageType.trim() : 'unknown';
    const text = typeof row.text === 'string' && row.text.trim() ? row.text.trim() : null;
    const canonicalUserId = typeof row.canonicalUserId === 'string' && row.canonicalUserId.trim() ? row.canonicalUserId.trim() : null;
    const customerId = Number.isInteger(Number(row.customerId)) ? Number(row.customerId) : null;
    const profileName =
      firstNonEmptyString([row.profileName, row.profile_name, customerName, instagramMerge?.name]) || null;
    const rawPayload =
      channel === 'INSTAGRAM'
        ? instagramMerge?.normalizedRawPayload || (rawSource as Prisma.InputJsonValue)
        : (rawSource as Prisma.InputJsonValue);
    const isEcho = isOutboundEcho(row);
    const intendedMessageType = isEcho ? `echo_${messageType}` : messageType;
    const eventDate = toEventDate(row);

    if (!channel || !providerMessageId || !conversationKey) {
      results.push({ index: i, ok: false, result: 'invalid_payload' });
      continue;
    }

    const salonId = await resolveSalonId(channel, externalAccountId, externalBusinessId);
    if (!salonId) {
      results.push({ index: i, ok: false, result: 'salon_not_found' });
      continue;
    }

    const existingProviderRow = await prisma.inboundMessageQueue.findUnique({
      where: {
        channel_providerMessageId: {
          channel,
          providerMessageId,
        },
      },
      select: {
        conversationKey: true,
        messageType: true,
        text: true,
        eventTimestamp: true,
      },
    });

    if (existingProviderRow) {
      const existingTs = existingProviderRow.eventTimestamp.getTime();
      const incomingTs = eventDate.getTime();
      const withinRetryWindow = Math.abs(existingTs - incomingTs) <= 120000;
      const sameConversation = existingProviderRow.conversationKey === conversationKey;
      const sameText = (existingProviderRow.text || null) === (text || null);
      const likelyRetryOrEcho = sameConversation && sameText && withinRetryWindow;

      // Some providers/workflows can reuse non-unique providerMessageId.
      // Keep history by deriving a deterministic synthetic id per message signature.
      if (!likelyRetryOrEcho) {
        const signature = buildMessageSignature({
          conversationKey,
          messageType: intendedMessageType,
          text,
          eventDate,
        });
        providerMessageId = `${providerMessageId}__${signature}`;
      }
    }

    try {
      const outboundTrace = isEcho
        ? await prisma.outboundMessageTrace.findUnique({
            where: {
              channel_providerMessageId: {
                channel,
                providerMessageId,
              },
            },
            select: {
              source: true,
              canonicalUserId: true,
              customerId: true,
              text: true,
            },
          })
        : null;

      const echoSource: 'ai_echo' | 'human_app_echo' | 'human_external_echo' | null = !isEcho
        ? null
        : outboundTrace?.source === OutboundMessageSource.AI_AGENT
          ? 'ai_echo'
          : outboundTrace?.source === OutboundMessageSource.HUMAN_APP
            ? 'human_app_echo'
            : 'human_external_echo';

      const inboundStatus = isEcho ? InboundMessageStatus.DONE : InboundMessageStatus.PENDING;
      const finalText = text || outboundTrace?.text || null;
      const finalCanonicalUserId = canonicalUserId || outboundTrace?.canonicalUserId || null;
      const finalCustomerId = customerId || outboundTrace?.customerId || null;

      const item = await prisma.inboundMessageQueue.upsert({
        where: {
          channel_providerMessageId: {
            channel,
            providerMessageId,
          },
        },
        update: {
          salonId,
          conversationKey,
          externalAccountId: externalAccountId || externalBusinessId || '',
          customerName,
          messageType: intendedMessageType,
          text: finalText,
          eventTimestamp: eventDate,
          rawPayload,
          status: inboundStatus,
          processedAt: isEcho ? new Date() : null,
          updatedAt: new Date(),
        },
        create: {
          salonId,
          channel,
          conversationKey,
          providerMessageId,
          externalAccountId: externalAccountId || externalBusinessId || '',
          customerName,
          messageType: intendedMessageType,
          text: finalText,
          eventTimestamp: eventDate,
          rawPayload,
          status: inboundStatus,
          processedAt: isEcho ? new Date() : null,
        },
        select: { id: true },
      });

      await upsertConversationMessageEvent({
        salonId,
        channel,
        conversationKey,
        providerMessageId,
        externalAccountId: externalAccountId || externalBusinessId || '',
        customerName,
        messageType: intendedMessageType,
        text: finalText,
        direction: isEcho ? 'OUTBOUND' : 'INBOUND',
        eventTimestamp: eventDate,
        processingStatus: inboundStatus,
        outboundSource: isEcho ? outboundTrace?.source || null : null,
        rawPayload,
      });

      const existingState = await prisma.conversationState.findUnique({
        where: {
          salonId_channel_conversationKey: {
            salonId,
            channel,
            conversationKey,
          },
        },
        select: {
          id: true,
          mode: true,
          manualAlways: true,
        },
      });

      const baseStateUpdate: any = {
        ...(finalCanonicalUserId ? { canonicalUserId: finalCanonicalUserId } : {}),
        ...(finalCustomerId ? { customerId: finalCustomerId } : {}),
        ...(profileName ? { profileName } : {}),
      };

      if (!isEcho) {
        baseStateUpdate.lastCustomerMessageAt = eventDate;
      }

      if (isEcho && (echoSource === 'human_app_echo' || echoSource === 'human_external_echo')) {
        if (!existingState?.manualAlways) {
          baseStateUpdate.mode = ConversationAutomationMode.HUMAN_ACTIVE;
          baseStateUpdate.manualAlways = false;
          baseStateUpdate.humanPendingSince = null;
          baseStateUpdate.lastHumanMessageAt = eventDate;
          baseStateUpdate.humanActiveUntil = new Date(eventDate.getTime() + HUMAN_ACTIVE_MINUTES * 60 * 1000);
          baseStateUpdate.notes = echoSource;
        }
      }

      await prisma.conversationState.upsert({
        where: {
          salonId_channel_conversationKey: {
            salonId,
            channel,
            conversationKey,
          },
        },
        update: baseStateUpdate,
        create: {
          salonId,
          channel,
          conversationKey,
          canonicalUserId: finalCanonicalUserId || null,
          customerId: finalCustomerId || null,
          profileName: profileName || null,
          mode:
            isEcho && echoSource !== 'ai_echo'
              ? ConversationAutomationMode.HUMAN_ACTIVE
              : ConversationAutomationMode.AUTO,
          lastCustomerMessageAt: isEcho ? null : eventDate,
          lastHumanMessageAt: isEcho && echoSource !== 'ai_echo' ? eventDate : null,
          humanActiveUntil:
            isEcho && echoSource !== 'ai_echo'
              ? new Date(eventDate.getTime() + HUMAN_ACTIVE_MINUTES * 60 * 1000)
              : null,
          notes: isEcho ? echoSource : null,
        },
      });

      results.push({
        index: i,
        ok: true,
        result: isEcho ? (echoSource || 'echo') : 'upserted',
        id: item.id,
      });
    } catch (error) {
      console.error('Internal inbox ingest upsert error:', error);
      results.push({ index: i, ok: false, result: 'db_error' });
    }
  }

  const successCount = results.filter((item) => item.ok).length;
  return res.status(200).json({
    ok: successCount > 0,
    successCount,
    total: results.length,
    results,
  });
});

export default router;
