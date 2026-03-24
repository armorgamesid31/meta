import { ChannelType, InboundMessageStatus, OutboundMessageSource } from '@prisma/client';
import axios from 'axios';
import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v23.0').trim();
const CHAKRA_WHATSAPP_SEND_URL = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) return true;
  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

function asChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') return normalized as ChannelType;
  return null;
}

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function normalizeConversationCandidates(channel: ChannelType, value: string): string[] {
  const key = value.trim();
  const prefixed = `${channel}:${key}`;
  const raw = key.startsWith(`${channel}:`) ? key.slice(channel.length + 1) : key;
  const set = new Set<string>();
  if (key) set.add(key);
  if (raw) set.add(raw);
  if (prefixed) set.add(prefixed);
  return Array.from(set).filter(Boolean);
}

function extractRawConversationKey(channel: ChannelType, value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith(`${channel}:`)) {
    return trimmed.slice(channel.length + 1);
  }
  return trimmed;
}

async function resolveLatestInboundMeta(
  salonId: number,
  channel: ChannelType,
  conversationKey: string,
) {
  const candidates = normalizeConversationCandidates(channel, conversationKey);
  return prisma.inboundMessageQueue.findFirst({
    where: {
      salonId,
      channel,
      conversationKey: { in: candidates },
    },
    orderBy: { eventTimestamp: 'desc' },
    select: {
      conversationKey: true,
      externalAccountId: true,
      customerName: true,
    },
  });
}

async function sendInstagramMessage(params: {
  salonId: number;
  conversationKey: string;
  text: string;
  externalAccountId?: string | null;
}) {
  const settings = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId: params.salonId },
    select: { faqAnswers: true },
  });
  const faqAnswers = asObject(settings?.faqAnswers);
  const metaDirect = asObject(faqAnswers.metaDirect);
  const instagram = asObject(metaDirect.instagram);
  const accessToken = typeof instagram.accessToken === 'string' ? instagram.accessToken.trim() : '';
  const senderInstagramId =
    (typeof params.externalAccountId === 'string' && params.externalAccountId.trim()) ||
    (typeof instagram.externalAccountId === 'string' && instagram.externalAccountId.trim()) ||
    '';

  if (!accessToken || !senderInstagramId) {
    throw new Error('Instagram channel is not connected');
  }

  const rawRecipientId = extractRawConversationKey('INSTAGRAM', params.conversationKey);
  const url = `https://graph.instagram.com/${META_GRAPH_VERSION}/${senderInstagramId}/messages`;

  const response = await axios.post(
    url,
    {
      recipient: { id: rawRecipientId },
      message: { text: params.text },
    },
    {
      params: { access_token: accessToken },
      timeout: 20000,
    },
  );

  const providerMessageId =
    (typeof response.data?.message_id === 'string' && response.data.message_id.trim()) ||
    `ig_ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return {
    providerMessageId,
    externalAccountId: senderInstagramId,
    rawResponse: response.data ?? null,
  };
}

async function sendWhatsappViaChakra(params: {
  salonId: number;
  conversationKey: string;
  text: string;
  externalAccountId?: string | null;
}) {
  if (!CHAKRA_WHATSAPP_SEND_URL) {
    throw new Error('CHAKRA_WHATSAPP_SEND_URL is missing');
  }

  const salon = await prisma.salon.findUnique({
    where: { id: params.salonId },
    select: {
      id: true,
      chakraPluginId: true,
      chakraPhoneNumberId: true,
    },
  });

  if (!salon?.chakraPluginId) {
    throw new Error('Chakra plugin is not connected');
  }

  const to = extractRawConversationKey('WHATSAPP', params.conversationKey);
  const payload = {
    pluginId: salon.chakraPluginId,
    phoneNumberId: salon.chakraPhoneNumberId || params.externalAccountId || null,
    to,
    text: params.text,
    type: 'text',
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) {
    headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;
  }

  const response = await axios.post(CHAKRA_WHATSAPP_SEND_URL, payload, {
    headers,
    timeout: 25000,
  });

  const providerMessageId =
    (typeof response.data?.messageId === 'string' && response.data.messageId.trim()) ||
    (typeof response.data?.id === 'string' && response.data.id.trim()) ||
    (typeof response.data?.data?.id === 'string' && response.data.data.id.trim()) ||
    `wa_ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return {
    providerMessageId,
    externalAccountId: salon.chakraPhoneNumberId || params.externalAccountId || null,
    rawResponse: response.data ?? null,
  };
}

router.post('/send', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });

  const body = req.body || {};
  const salonId = Number(body.salonId);
  const channel = asChannel(body.channel);
  const conversationKey = typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!Number.isInteger(salonId) || salonId <= 0 || !channel || !conversationKey || !text) {
    return res.status(400).json({ message: 'salonId, channel, conversationKey, text are required' });
  }

  const latestInbound = await resolveLatestInboundMeta(salonId, channel, conversationKey);
  const resolvedConversationKey = latestInbound?.conversationKey || conversationKey;
  const externalAccountIdFromInbound = latestInbound?.externalAccountId || null;
  const customerName = latestInbound?.customerName || null;

  const canonicalUserId = typeof body.canonicalUserId === 'string' ? body.canonicalUserId.trim() : null;
  const customerId = Number.isInteger(Number(body.customerId)) ? Number(body.customerId) : null;

  try {
    const sent =
      channel === 'INSTAGRAM'
        ? await sendInstagramMessage({
            salonId,
            conversationKey: resolvedConversationKey,
            text,
            externalAccountId: externalAccountIdFromInbound,
          })
        : await sendWhatsappViaChakra({
            salonId,
            conversationKey: resolvedConversationKey,
            text,
            externalAccountId: externalAccountIdFromInbound,
          });

    const now = new Date();

    const savedMessage = await prisma.inboundMessageQueue.create({
      data: {
        salonId,
        channel,
        conversationKey: resolvedConversationKey,
        providerMessageId: sent.providerMessageId,
        externalAccountId: sent.externalAccountId || externalAccountIdFromInbound || '',
        customerName,
        messageType: 'text_outbound_ai',
        text,
        eventTimestamp: now,
        rawPayload: {
          direction: 'outbound',
          source: 'AI_AGENT',
          providerResponse: sent.rawResponse,
        } as any,
        status: InboundMessageStatus.DONE,
        processedAt: now,
      },
      select: {
        id: true,
        providerMessageId: true,
        eventTimestamp: true,
      },
    });

    await prisma.outboundMessageTrace.upsert({
      where: {
        channel_providerMessageId: {
          channel,
          providerMessageId: sent.providerMessageId,
        },
      },
      update: {
        salonId,
        conversationKey: resolvedConversationKey,
        externalAccountId: sent.externalAccountId || externalAccountIdFromInbound || null,
        canonicalUserId: canonicalUserId || null,
        customerId: customerId || null,
        source: OutboundMessageSource.AI_AGENT,
        text,
        sentAt: now,
      },
      create: {
        salonId,
        channel,
        conversationKey: resolvedConversationKey,
        providerMessageId: sent.providerMessageId,
        externalAccountId: sent.externalAccountId || externalAccountIdFromInbound || null,
        canonicalUserId: canonicalUserId || null,
        customerId: customerId || null,
        source: OutboundMessageSource.AI_AGENT,
        text,
        sentAt: now,
      },
    });

    return res.status(200).json({
      ok: true,
      channel,
      providerMessageId: savedMessage.providerMessageId,
      messageId: savedMessage.id,
      eventTimestamp: savedMessage.eventTimestamp.toISOString(),
    });
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'send_failed';
    return res.status(502).json({ ok: false, message: String(detail) });
  }
});

export default router;
