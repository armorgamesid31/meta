import {
  ChannelType,
  ConversationAutomationMode,
  InboundMessageStatus,
  OutboundMessageSource,
} from '@prisma/client';
import axios from 'axios';
import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

const META_WEBHOOK_VERIFY_TOKEN = (process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
const META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN = (process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '').trim();
const META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = (process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();

const N8N_NORMALIZED_WEBHOOK_URL = (process.env.N8N_NORMALIZED_WEBHOOK_URL || '').trim();
const N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL = (process.env.N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL || '').trim();
const N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL = (process.env.N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL || '').trim();
const N8N_INTERNAL_API_KEY = (process.env.N8N_INTERNAL_API_KEY || '').trim();

const HUMAN_ACTIVE_MINUTES = Number(process.env.CONVERSATION_HUMAN_ACTIVE_MINUTES || 360);

function toIsoFromTs(ts: unknown): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
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

function normalizePhoneDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function normalizeInstagramIdentity(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function parseMetaMessageType(channel: ChannelType, msg: any, media: Array<{ type: string }>): string {
  if (channel === 'INSTAGRAM') {
    if (msg?.reply_to?.story || msg?.story) return 'story_reply';
    if (msg?.reaction) return 'reaction';
    if (msg?.sticker) return 'sticker';
    if (msg?.text) return 'text';
    if (msg?.attachments?.length) {
      const t = media[0]?.type || 'attachment';
      return t === 'file' ? 'document' : t;
    }
    return msg?.type || 'unknown';
  }

  if (msg?.interactive) return 'interactive';
  return msg?.type || 'unknown';
}

function isHumanCancelSignal(row: any): boolean {
  const payload = typeof row?.actionPayload === 'string' ? row.actionPayload.trim().toUpperCase() : '';
  const text = typeof row?.text === 'string' ? row.text.trim().toUpperCase() : '';
  if (payload === 'HUMAN_CANCEL') return true;
  if (text === 'HUMAN_CANCEL') return true;
  if (text === 'İPTAL ET' || text === 'IPTAL ET') return true;
  return false;
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
    orderBy: { salonId: 'asc' },
    select: { salonId: true },
  });
  return binding?.salonId || null;
}

async function resolveCustomer(input: { salonId: number; channel: ChannelType; channelUserId: string | null }) {
  if (!input.channelUserId) return null;

  if (input.channel === 'WHATSAPP') {
    const needle = normalizePhoneDigits(input.channelUserId);
    if (!needle) return null;
    const list = await prisma.customer.findMany({
      where: { salonId: input.salonId },
      select: { id: true, name: true, phone: true, instagram: true },
      take: 4000,
    });
    return list.find((c) => normalizePhoneDigits(c.phone) === needle) || null;
  }

  const igNeedle = normalizeInstagramIdentity(input.channelUserId);
  if (!igNeedle) return null;
  const list = await prisma.customer.findMany({
    where: {
      salonId: input.salonId,
      instagram: { not: null },
    },
    select: { id: true, name: true, phone: true, instagram: true },
    take: 4000,
  });

  return (
    list.find((c) => {
      const v = normalizeInstagramIdentity(c.instagram || '');
      return v === igNeedle || v === normalizeInstagramIdentity(`INSTAGRAM:${input.channelUserId}`);
    }) || null
  );
}

function computeCustomerStatus(customer: { instagram: string | null } | null): 'unregistered' | 'number_registered' | 'both_registered' {
  if (!customer) return 'unregistered';
  return customer.instagram && customer.instagram.trim().length > 0 ? 'both_registered' : 'number_registered';
}

function computeMagicDirect(channel: ChannelType, status: 'unregistered' | 'number_registered' | 'both_registered') {
  if (status === 'unregistered') return false;
  if (channel === 'WHATSAPP') return true;
  return status === 'both_registered';
}

async function evaluateConversationState(input: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  profileName: string | null;
  forceAutoByCancel: boolean;
  isEcho: boolean;
  providerMessageId: string;
  eventDate: Date;
}) {
  const outboundTrace = input.isEcho
    ? await prisma.outboundMessageTrace.findUnique({
        where: {
          channel_providerMessageId: {
            channel: input.channel,
            providerMessageId: input.providerMessageId,
          },
        },
        select: { source: true },
      })
    : null;

  const now = input.eventDate;
  const state = await prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: input.conversationKey,
      },
    },
    update: {
      ...(input.canonicalUserId ? { canonicalUserId: input.canonicalUserId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.profileName ? { profileName: input.profileName } : {}),
      ...(input.isEcho ? {} : { lastCustomerMessageAt: now }),
    },
    create: {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      canonicalUserId: input.canonicalUserId || null,
      customerId: input.customerId || null,
      profileName: input.profileName || null,
      mode: ConversationAutomationMode.AUTO,
      lastCustomerMessageAt: input.isEcho ? null : now,
    },
  });

  if (input.forceAutoByCancel && !input.isEcho && !state.manualAlways) {
    return prisma.conversationState.update({
      where: { id: state.id },
      data: {
        mode: ConversationAutomationMode.AUTO,
        humanPendingSince: null,
        humanActiveUntil: null,
        notes: 'human_cancelled_by_customer',
      },
    });
  }

  if (input.isEcho && outboundTrace?.source !== OutboundMessageSource.AI_AGENT && !state.manualAlways) {
    const until = new Date(now.getTime() + HUMAN_ACTIVE_MINUTES * 60 * 1000);
    return prisma.conversationState.update({
      where: { id: state.id },
      data: {
        mode: ConversationAutomationMode.HUMAN_ACTIVE,
        manualAlways: false,
        humanPendingSince: null,
        lastHumanMessageAt: now,
        humanActiveUntil: until,
        notes:
          outboundTrace?.source === OutboundMessageSource.HUMAN_APP
            ? 'human_app_echo'
            : 'human_external_echo',
      },
    });
  }

  if (!state.manualAlways) {
    const activeExpired =
      state.mode === ConversationAutomationMode.HUMAN_ACTIVE &&
      state.humanActiveUntil &&
      state.humanActiveUntil.getTime() <= now.getTime();

    const pendingExpired =
      state.mode === ConversationAutomationMode.HUMAN_PENDING &&
      state.humanPendingSince &&
      now.getTime() - state.humanPendingSince.getTime() >= HUMAN_ACTIVE_MINUTES * 60 * 1000;

    if (activeExpired || pendingExpired) {
      return prisma.conversationState.update({
        where: { id: state.id },
        data: {
          mode: ConversationAutomationMode.AUTO,
          humanPendingSince: null,
          humanActiveUntil: null,
          notes: pendingExpired ? 'auto_resumed_pending_timeout' : 'auto_resumed_active_timeout',
        },
      });
    }
  }

  return state;
}

function computeStatePolicy(mode: ConversationAutomationMode) {
  if (mode === 'AUTO') return { aiAllowed: true, responsePolicy: 'normal' };
  if (mode === 'HUMAN_PENDING') return { aiAllowed: true, responsePolicy: 'pending_wait_with_cancel' };
  if (mode === 'AUTO_RESUME_PENDING') return { aiAllowed: true, responsePolicy: 'resume_then_normal' };
  if (mode === 'MANUAL_ALWAYS') return { aiAllowed: false, responsePolicy: 'manual_notify_only' };
  return { aiAllowed: false, responsePolicy: 'human_active_suppress' };
}

async function loadAgentSettings(salonId: number) {
  const settings = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: {
      tone: true,
      answerLength: true,
      emojiUsage: true,
      bookingGuidance: true,
      handoverThreshold: true,
      aiDisclosure: true,
    },
  });

  return {
    tone: settings?.tone || 'balanced',
    answerLength: settings?.answerLength || 'medium',
    emojiUsage: settings?.emojiUsage || 'low',
    bookingGuidance: settings?.bookingGuidance || 'medium',
    handoverThreshold: settings?.handoverThreshold || 'balanced',
    aiDisclosure: settings?.aiDisclosure || 'onQuestion',
  };
}

function chooseN8nTarget(channel: ChannelType) {
  if (channel === 'INSTAGRAM' && N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL) return N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL;
  if (channel === 'WHATSAPP' && N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL) return N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL;
  return N8N_NORMALIZED_WEBHOOK_URL;
}

async function forwardToN8n(payload: any, channel: ChannelType) {
  const target = chooseN8nTarget(channel);
  if (!target) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (N8N_INTERNAL_API_KEY) headers['x-internal-api-key'] = N8N_INTERNAL_API_KEY;

  await axios.post(target, payload, {
    headers,
    timeout: 20000,
  });
}

function normalizeWebhookPayload(body: any) {
  const out: any[] = [];
  const root = body ?? {};

  if (root.object === 'whatsapp_business_account') {
    for (const entry of root.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change?.value ?? {};
        const contacts = value?.contacts ?? [];
        const contactByWaId = Object.fromEntries(contacts.map((c: any) => [c?.wa_id, c]));

        for (const msg of value?.messages ?? []) {
          const from = msg?.from ?? null;
          const contact = from ? contactByWaId[from] : null;
          const media: any[] = [];

          if (msg?.image) media.push({ type: 'image', id: msg.image.id ?? null, url: msg.image.url ?? null, caption: msg.image.caption ?? null });
          if (msg?.audio) media.push({ type: 'audio', id: msg.audio.id ?? null, url: msg.audio.url ?? null, voice: !!msg.audio.voice });
          if (msg?.video) media.push({ type: 'video', id: msg.video.id ?? null, url: msg.video.url ?? null, caption: msg.video.caption ?? null });
          if (msg?.document) media.push({ type: 'document', id: msg.document.id ?? null, url: msg.document.url ?? null, filename: msg.document.filename ?? null, caption: msg.document.caption ?? null });
          if (msg?.sticker) media.push({ type: 'sticker', id: msg.sticker.id ?? null, url: msg.sticker.url ?? null });

          const messageType = parseMetaMessageType('WHATSAPP', msg, media);
          const channelUserId = contact?.wa_id || from || null;
          const mediaUrls = media.map((m) => m?.url).filter(Boolean);
          const primaryMedia = media[0] || null;
          const primaryMediaId = primaryMedia?.id || null;

          out.push({
            channel: 'WHATSAPP',
            providerMessageId: msg?.id ?? `wa_${Date.now()}`,
            messageType,
            routeMessageType: String(messageType || 'unknown').trim().toLowerCase(),
            text:
              msg?.text?.body ||
              msg?.image?.caption ||
              msg?.video?.caption ||
              msg?.document?.caption ||
              msg?.interactive?.button_reply?.title ||
              msg?.interactive?.list_reply?.title ||
              null,
            timestamp: Number(msg?.timestamp || Date.now()),
            eventTimestamp: toIsoFromTs(msg?.timestamp),
            senderId: from || null,
            recipientId: value?.metadata?.phone_number_id || null,
            externalAccountId: value?.metadata?.phone_number_id || null,
            externalBusinessId: entry?.id || null,
            channelUserId,
            channelConversationKey: `WHATSAPP:${channelUserId || 'unknown'}`,
            rawProfileName: contact?.profile?.name || null,
            media,
            mediaUrls,
            primaryMediaUrl: mediaUrls[0] || null,
            primaryMediaId,
            primaryMediaType: primaryMedia?.type || null,
            hasMedia: mediaUrls.length > 0,
            fetchMediaUrl: primaryMediaId ? `https://api.chakrahq.com/v1/whatsapp/v19.0/media/${primaryMediaId}/show` : null,
            actionPayload: msg?.interactive?.button_reply?.id || msg?.interactive?.list_reply?.id || null,
            actionTitle: msg?.interactive?.button_reply?.title || msg?.interactive?.list_reply?.title || null,
            direction: 'inbound',
            isEcho: false,
            raw: root,
          });
        }
      }
    }
  }

  if (root.object === 'instagram') {
    for (const entry of root.entry ?? []) {
      for (const ev of entry.messaging ?? []) {
        const m = ev?.message;
        const postback = ev?.postback;
        if (!m && !postback) continue;

        const isEcho = m?.is_echo === true;
        const attachments = m?.attachments ?? [];
        const media = attachments.map((a: any) => ({
          type: a?.type || 'attachment',
          id: a?.payload?.id || null,
          url: a?.payload?.url || null,
        }));

        const messageType = postback ? 'postback' : parseMetaMessageType('INSTAGRAM', m, media);
        const channelUserId = ev?.sender?.id || null;
        const mediaUrls = media.map((mm: any) => mm?.url).filter(Boolean);
        const primaryMedia = media[0] || null;

        out.push({
          channel: 'INSTAGRAM',
          providerMessageId: m?.mid || `ig_${ev?.timestamp || Date.now()}_${ev?.sender?.id || 'unknown'}`,
          messageType,
          routeMessageType: String(messageType || 'unknown').trim().toLowerCase(),
          text: m?.text || postback?.title || postback?.payload || null,
          timestamp: Number(ev?.timestamp || Date.now()),
          eventTimestamp: toIsoFromTs(ev?.timestamp),
          senderId: ev?.sender?.id || null,
          recipientId: ev?.recipient?.id || null,
          externalAccountId: ev?.recipient?.id || entry?.id || null,
          externalBusinessId: entry?.id || null,
          channelUserId,
          channelConversationKey: `INSTAGRAM:${channelUserId || 'unknown'}`,
          rawProfileName: null,
          media,
          mediaUrls,
          primaryMediaUrl: mediaUrls[0] || null,
          primaryMediaId: primaryMedia?.id || null,
          primaryMediaType: primaryMedia?.type || null,
          hasMedia: mediaUrls.length > 0,
          fetchMediaUrl: mediaUrls[0] || null,
          actionPayload: m?.quick_reply?.payload || postback?.payload || null,
          actionTitle: postback?.title || null,
          direction: isEcho ? 'outbound' : 'inbound',
          isEcho,
          raw: root,
        });
      }
    }
  }

  return out;
}

async function processIncomingBatch(items: any[]) {
  const processed: any[] = [];

  for (const row of items) {
    const channel = row.channel as ChannelType;
    const providerMessageId = String(row.providerMessageId || '').trim();
    const conversationKey = String(row.channelConversationKey || '').trim();
    const externalAccountId = typeof row.externalAccountId === 'string' ? row.externalAccountId.trim() : null;
    const externalBusinessId = typeof row.externalBusinessId === 'string' ? row.externalBusinessId.trim() : null;

    const salonId = await resolveSalonId(channel, externalAccountId, externalBusinessId);
    if (!salonId) {
      processed.push({ ...row, success: false, result: 'salon_not_found' });
      continue;
    }

    const customer = await resolveCustomer({
      salonId,
      channel,
      channelUserId: typeof row.channelUserId === 'string' ? row.channelUserId : null,
    });

    const customerStatus = computeCustomerStatus(customer);
    const canonicalUserId = customer?.id ? `customer:${customer.id}` : conversationKey;

    const nameSource = customer?.id
      ? customer.name && customer.name.trim().length > 0
        ? 'customer_record'
        : 'none'
      : row.rawProfileName
        ? 'channel_profile'
        : 'none';

    const profileName = customer?.id
      ? customer.name && customer.name.trim().length > 0
        ? customer.name.trim()
        : null
      : typeof row.rawProfileName === 'string' && row.rawProfileName.trim()
        ? row.rawProfileName.trim()
        : null;

    const eventDate = toEventDate(row);
    const forceAutoByCancel = isHumanCancelSignal(row);

    await prisma.inboundMessageQueue.upsert({
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
        customerName: profileName,
        messageType: row.isEcho ? `echo_${row.messageType}` : row.messageType,
        text: row.text || null,
        eventTimestamp: eventDate,
        rawPayload: row.raw as any,
        status: row.isEcho ? InboundMessageStatus.DONE : InboundMessageStatus.PENDING,
        processedAt: row.isEcho ? new Date() : null,
      },
      create: {
        salonId,
        channel,
        conversationKey,
        providerMessageId,
        externalAccountId: externalAccountId || externalBusinessId || '',
        customerName: profileName,
        messageType: row.isEcho ? `echo_${row.messageType}` : row.messageType,
        text: row.text || null,
        eventTimestamp: eventDate,
        rawPayload: row.raw as any,
        status: row.isEcho ? InboundMessageStatus.DONE : InboundMessageStatus.PENDING,
        processedAt: row.isEcho ? new Date() : null,
      },
    });

    const state = await evaluateConversationState({
      salonId,
      channel,
      conversationKey,
      canonicalUserId,
      customerId: customer?.id || null,
      profileName,
      forceAutoByCancel,
      isEcho: Boolean(row.isEcho),
      providerMessageId,
      eventDate,
    });

    const statePolicy = computeStatePolicy(state.mode);
    const agentSettings = await loadAgentSettings(salonId);

    processed.push({
      ...row,
      salonId,
      customerId: customer?.id || null,
      customerStatus,
      canonicalUserId,
      profileName,
      nameSource,
      phone_available: channel === 'WHATSAPP' || Boolean(customer?.phone),
      instagram_linked: Boolean(customer?.instagram && customer.instagram.trim()),
      canGenerateMagicLinkDirectly: computeMagicDirect(channel, customerStatus),
      agentSettings,
      state: {
        mode: state.mode,
        aiAllowed: statePolicy.aiAllowed,
        responsePolicy: statePolicy.responsePolicy,
      },
      userAction: forceAutoByCancel ? 'HUMAN_CANCEL' : row.actionPayload || null,
      // Backward compatibility for old flows
      conversationKey,
      customer_status: customerStatus,
      can_generate_magic_link_directly: computeMagicDirect(channel, customerStatus),
      success: true,
      result: 'ok',
    });
  }

  return processed;
}

function isVerificationRequest(req: any) {
  return req.query['hub.mode'] === 'subscribe';
}

function getAllowedTokens(channel?: ChannelType): string[] {
  const all = [META_WEBHOOK_VERIFY_TOKEN, META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN, META_WHATSAPP_WEBHOOK_VERIFY_TOKEN]
    .map((v) => v.trim())
    .filter(Boolean);

  if (channel === 'INSTAGRAM') {
    const scoped = [META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN, META_WEBHOOK_VERIFY_TOKEN].map((v) => v.trim()).filter(Boolean);
    return scoped.length ? scoped : all;
  }

  if (channel === 'WHATSAPP') {
    const scoped = [META_WHATSAPP_WEBHOOK_VERIFY_TOKEN, META_WEBHOOK_VERIFY_TOKEN].map((v) => v.trim()).filter(Boolean);
    return scoped.length ? scoped : all;
  }

  return all;
}

function handleVerification(req: any, res: any, channel?: ChannelType) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const allowed = getAllowedTokens(channel);
  const tokenOk = typeof token === 'string' && allowed.includes(token);

  if (mode === 'subscribe' && tokenOk && challenge) {
    return res.status(200).send(String(challenge));
  }

  return res.status(403).send('Forbidden');
}

async function handleInbound(req: any, res: any, forcedChannel?: ChannelType) {
  try {
    const normalized = normalizeWebhookPayload(req.body);
    const filtered = forcedChannel ? normalized.filter((i) => i.channel === forcedChannel) : normalized;
    const processed = await processIncomingBatch(filtered);

    for (const item of processed) {
      if (!item.success || item.isEcho) continue;
      await forwardToN8n(item, item.channel);
    }

    return res.status(200).json({
      ok: true,
      total: processed.length,
      forwarded: processed.filter((p) => p.success && !p.isEcho).length,
    });
  } catch (error: any) {
    console.error('Channel webhook processing error:', error?.response?.data || error);
    return res.status(200).json({ ok: false });
  }
}

router.get('/instagram', (req, res) => {
  if (!isVerificationRequest(req)) return res.status(200).send('ok');
  return handleVerification(req, res, 'INSTAGRAM');
});

router.get('/whatsapp', (req, res) => {
  if (!isVerificationRequest(req)) return res.status(200).send('ok');
  return handleVerification(req, res, 'WHATSAPP');
});

router.get('/meta', (req, res) => {
  if (!isVerificationRequest(req)) return res.status(200).send('ok');
  return handleVerification(req, res);
});

router.post('/instagram', async (req, res) => handleInbound(req, res, 'INSTAGRAM'));
router.post('/whatsapp', async (req, res) => handleInbound(req, res, 'WHATSAPP'));
router.post('/meta', async (req, res) => handleInbound(req, res));

export default router;
