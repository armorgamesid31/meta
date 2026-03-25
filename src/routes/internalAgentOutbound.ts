import { ChannelType, InboundMessageStatus, OutboundMessageSource } from '@prisma/client';
import axios from 'axios';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ensureMagicLink } from '../services/magicLinkService.js';

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

type ActionKind = 'none' | 'cancel' | 'booking';

function pickMagicLinkUrl(body: any): string | null {
  const candidates = [
    body?.magicLinkUrl,
    body?.magicUrl,
    body?.bookingUrl,
    body?.magicLink?.url,
    body?.magicLink?.magicUrl,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'y';
  }
  return false;
}

async function resolveConversationStateMode(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
}) {
  const candidates = normalizeConversationCandidates(params.channel, params.conversationKey);
  const state = await prisma.conversationState.findFirst({
    where: {
      salonId: params.salonId,
      channel: params.channel,
      conversationKey: { in: candidates },
    },
    orderBy: { updatedAt: 'desc' },
    select: { mode: true },
  });
  return state?.mode || null;
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
  actionKind: ActionKind;
  magicLinkUrl?: string | null;
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

  const bookingUrl = params.magicLinkUrl && params.magicLinkUrl.trim() ? params.magicLinkUrl.trim() : null;
  let payload: Record<string, any>;

  if (params.actionKind === 'booking' && bookingUrl) {
    payload = {
      recipient: { id: rawRecipientId },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: params.text,
            buttons: [
              {
                type: 'web_url',
                title: 'Randevu',
                url: bookingUrl,
              },
            ],
          },
        },
      },
    };
  } else if (params.actionKind === 'cancel') {
    payload = {
      recipient: { id: rawRecipientId },
      message: {
        text: params.text,
        quick_replies: [
          {
            content_type: 'text',
            title: 'İptal Et',
            payload: 'HUMAN_CANCEL',
          },
        ],
      },
    };
  } else {
    payload = {
      recipient: { id: rawRecipientId },
      message: { text: params.text },
    };
  }

  const response = await axios.post(
    url,
    payload,
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
  actionKind: ActionKind;
  magicLinkUrl?: string | null;
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
  const bookingUrl = params.magicLinkUrl && params.magicLinkUrl.trim() ? params.magicLinkUrl.trim() : null;

  const payload: Record<string, any> = {
    pluginId: salon.chakraPluginId,
    phoneNumberId: salon.chakraPhoneNumberId || params.externalAccountId || null,
    to,
  };

  // WhatsApp interactive button for human pending cancel.
  // Booking uses text + link and optional quick action reply label for consistent UX.
  if (params.actionKind === 'cancel') {
    payload.type = 'interactive';
    payload.interactive = {
      type: 'button',
      body: {
        text: params.text,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'HUMAN_CANCEL',
              title: 'İptal Et',
            },
          },
        ],
      },
    };
  } else if (params.actionKind === 'booking' && bookingUrl) {
    payload.type = 'interactive';
    payload.interactive = {
      type: 'button',
      body: {
        text: `${params.text}\n\n${bookingUrl}`,
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'BOOKING_INTENT',
              title: 'Randevu',
            },
          },
        ],
      },
    };
  } else {
    payload.type = 'text';
    payload.text = params.text;
  }

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
  const forceCancelButton = body?.forceCancelButton === true;
  const bookingIntent = asBoolean(body?.bookingIntent) || asBoolean(body?.intentBooking) || asBoolean(body?.toolBookingIntent);

  let magicLinkUrl = pickMagicLinkUrl(body);
  let magicLinkAction: 'created' | 'renewed' | null = null;

  try {
    if (!magicLinkUrl && bookingIntent) {
      const rawConversationId = extractRawConversationKey(channel, resolvedConversationKey);
      const phoneFromBody = typeof body.phone === 'string' ? body.phone.trim() : '';
      const customerKeyFromBody = typeof body.customerKey === 'string' ? body.customerKey.trim() : '';
      const fallbackCustomerKey = canonicalUserId || `${channel}:${rawConversationId}`;

      const ensured = await ensureMagicLink({
        salonId,
        type: 'BOOKING',
        phone: phoneFromBody || (channel === 'WHATSAPP' ? rawConversationId : null),
        customerKey: customerKeyFromBody || fallbackCustomerKey,
        context: {
          salonId,
          channel,
          conversationKey: resolvedConversationKey,
          canonicalUserId: canonicalUserId || null,
          customerId: customerId || null,
        },
      });

      magicLinkUrl = ensured.magicUrl;
      magicLinkAction = ensured.action;
    }

    const mode = await resolveConversationStateMode({
      salonId,
      channel,
      conversationKey: resolvedConversationKey,
    });

    let actionKind: ActionKind = 'none';
    if (magicLinkUrl) {
      actionKind = 'booking';
    } else if (forceCancelButton || mode === 'HUMAN_PENDING') {
      actionKind = 'cancel';
    }

    const sent =
      channel === 'INSTAGRAM'
        ? await sendInstagramMessage({
            salonId,
            conversationKey: resolvedConversationKey,
            text,
            actionKind,
            magicLinkUrl,
            externalAccountId: externalAccountIdFromInbound,
          })
        : await sendWhatsappViaChakra({
            salonId,
            conversationKey: resolvedConversationKey,
            text,
            actionKind,
            magicLinkUrl,
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
        messageType: actionKind === 'none' ? 'text_outbound_ai' : `interactive_${actionKind}_outbound_ai`,
        text,
        eventTimestamp: now,
        rawPayload: {
          direction: 'outbound',
          source: 'AI_AGENT',
          bookingIntent,
          actionKind,
          magicLinkUrl: magicLinkUrl || null,
          magicLinkAction,
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
      bookingIntent,
      actionKind,
      magicLinkUrl: magicLinkUrl || null,
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
