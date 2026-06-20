import {
  ChannelType,
  ConversationAutomationMode,
  OutboundMessageSource,
  AppointmentStatus,
  WaitlistOfferStatus,
  ChannelProfileFetchStatus,
  InboundMessageStatus,
} from '@prisma/client';
import axios from 'axios';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  findBoundCustomer,
  normalizeInstagramIdentity,
  normalizePhoneDigits,
  resolveIdentity,
  upsertIdentitySession,
} from '../services/identityService.js';
import {
  isTemplateStatusPayload,
  processTemplateStatusPayload,
} from '../services/templateStatusWebhook.js';
import { upsertConversationMessageEvent } from '../services/conversationMessageEvents.js';
import { resolveHandoverAlert } from '../services/notifications.js';
import { storeConversationAvatarFromUrl } from '../services/conversationAvatarStorage.js';
import { buildMediaItemsFromWebhook } from '../services/conversationMediaCache.js';
import { bindPendingInstagramUsername } from '../services/globalCustomerIdentity.js';
import { tryConsumeInstagramVerifyCode } from '../services/instagramVerifyService.js';
import { isIdentityBanned } from '../services/blacklist.js';
import { sendWhatsappViaChakra, sendInstagramMessage } from './internalAgentOutbound.js';
import {
  buildCustomerCalibration,
  buildSystemPrompt,
  loadCustomerSnapshot,
  loadSalonAgentContext,
} from '../services/salonAgentContext.js';
// W6 cutover: salon AGENT_BACKEND_SALON_IDS listesindeyse inbound n8n yerine
// backend-native agent'a gider. Default (liste boş) → davranış değişmez.
import { isBackendEngine } from '../agent/cutover.js';
import { dispatchAgentInbound, type AgentInboundItem } from '../agent/dispatch.js';

const router = Router();

const META_WEBHOOK_VERIFY_TOKEN = (process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
const META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN = (process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN || '').trim();
const META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = (process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();

const META_APP_SECRET = (process.env.META_APP_SECRET || '').trim();
// Instagram Business Login is technically a separate Meta app with its
// own App Secret. Without this, x-hub-signature-256 on /api/webhooks/
// instagram never validates because Meta signs IG deliveries with this
// secret, not META_APP_SECRET.
const META_INSTAGRAM_APP_SECRET = (process.env.META_INSTAGRAM_APP_SECRET || '').trim();

/**
 * HMAC-SHA256 verification of Meta webhook payloads using X-Hub-Signature-256.
 * Runs BEFORE JSON body parsing — relies on req.body being a raw Buffer that
 * server.ts mounts via express.raw({ type: 'application/json' }) for the
 * /api/webhooks/* path. After verification, the raw buffer is parsed in-place
 * so downstream handlers see the same shape they did when express.json() was
 * the only parser.
 *
 * Failure modes:
 *  - Production AND no META_APP_SECRET configured → 503 (fail closed).
 *  - Dev AND no META_APP_SECRET configured → warn + bypass (raw → parsed JSON).
 *  - Signature header missing or mismatched → 403 with no body logging (do not
 *    leak shape to an attacker probing for verification gaps).
 */
// Shared body parser used by both verifier variants.
function parseRawBody(req: any): boolean {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (rawBody.length === 0) {
    req.body = {};
    return true;
  }
  try {
    req.body = JSON.parse(rawBody.toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Strict Meta HMAC verification. Used for endpoints that receive webhooks
 * DIRECTLY from Meta (Instagram OAuth direct webhook, /meta combined).
 * The HMAC is signed with META_APP_SECRET; we recompute and constant-time
 * compare against the x-hub-signature-256 header.
 */
// Temporary diagnostic helper — fires-and-forgets a DB write whenever a
// webhook is rejected before processing. Without this, signature failures
// (403) and missing-header rejections (403) leave zero trace, making
// "Meta says delivery succeeded but we see nothing" undebuggable. Logs
// a redacted payload preview + signature fingerprints so we can tell
// whether the request even reached us and, if so, why we rejected it.
function logRejectedWebhook(
  reason: 'no_secret' | 'missing_signature_header' | 'invalid_signature' | 'body_parse_failed',
  req: any,
  rawBody: Buffer,
  details: Record<string, unknown> = {},
) {
  // Best-effort — never let the diagnostic blow up the request path.
  void prisma.metaChannelWebhookLog
    .create({
      data: {
        channel: 'INSTAGRAM',
        direction: 'INBOUND',
        eventType: 'signature_reject',
        salonId: null,
        conversationKey: null,
        payload: {
          reason,
          path: req.originalUrl || req.url || null,
          ua: String(req.headers['user-agent'] || '').slice(0, 200),
          contentType: String(req.headers['content-type'] || '').slice(0, 100),
          sigHeaderPresent: Boolean(req.headers['x-hub-signature-256']),
          sigHeaderPreview: String(req.headers['x-hub-signature-256'] || '').slice(0, 24),
          bodyBytes: rawBody.length,
          bodyPreview: rawBody.toString('utf8').slice(0, 400),
          ...details,
        } as any,
      },
    })
    .catch(() => {
      // ignore — diagnostic write must never break the actual reject path
    });
}

// Constant-time compare two hex digests of identical length. Returns
// false if the hex strings differ in length (which is itself a leak-safe
// signal: Meta's HMAC-SHA256 is always 64 hex chars).
function hexSignaturesMatch(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyMetaSignature(req: any, res: any, next: any) {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  // Meta runs separate "apps" for Facebook Login for Business and
  // Instagram Business Login. Each app has its OWN App Secret, and
  // Meta signs webhook deliveries with whichever app is responsible
  // for the integration that produced the event:
  //
  //   - Facebook Page + WhatsApp Business Manager → META_APP_SECRET
  //   - Instagram Business Login (graph.instagram.com OAuth) →
  //     META_INSTAGRAM_APP_SECRET
  //
  // The `/api/webhooks/instagram` route receives traffic signed with
  // META_INSTAGRAM_APP_SECRET. The legacy `/api/webhooks/meta` combined
  // route can carry either. Easiest correct behaviour: accept the
  // signature if it matches ANY configured secret. Order doesn't matter
  // for correctness; we try the secret most likely for this route first
  // so the fast path is one HMAC compute.
  const isInstagramRoute = String(req.originalUrl || req.url || '').includes('/webhooks/instagram');
  const orderedSecrets = isInstagramRoute
    ? [META_INSTAGRAM_APP_SECRET, META_APP_SECRET]
    : [META_APP_SECRET, META_INSTAGRAM_APP_SECRET];
  const candidateSecrets = orderedSecrets.filter((s): s is string => Boolean(s));

  if (candidateSecrets.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[META_WEBHOOK] No app secrets configured in production — refusing webhook.');
      logRejectedWebhook('no_secret', req, rawBody);
      return res.status(503).json({ ok: false });
    }
    console.warn('[META_WEBHOOK] No app secrets configured — signature verification BYPASSED (dev only).');
    if (!parseRawBody(req)) return res.status(400).end();
    return next();
  }

  const headerValue = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!headerValue.startsWith('sha256=')) {
    logRejectedWebhook('missing_signature_header', req, rawBody);
    return res.status(403).end();
  }
  const provided = headerValue.slice('sha256='.length);

  let ok = false;
  let lastExpected = '';
  for (const secret of candidateSecrets) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    lastExpected = expected;
    if (hexSignaturesMatch(provided, expected)) {
      ok = true;
      break;
    }
  }

  if (!ok) {
    logRejectedWebhook('invalid_signature', req, rawBody, {
      providedSigPreview: provided.slice(0, 8) + '...' + provided.slice(-8),
      expectedSigPreview: lastExpected.slice(0, 8) + '...' + lastExpected.slice(-8),
      triedSecrets: candidateSecrets.length,
      route: isInstagramRoute ? 'instagram' : 'other',
    });
    return res.status(403).end();
  }

  if (!parseRawBody(req)) {
    logRejectedWebhook('body_parse_failed', req, rawBody);
    return res.status(400).end();
  }
  return next();
}

/**
 * BSP-proxied webhook verifier (Chakra forwards WhatsApp Cloud API events).
 *
 * Chakra is our partnered Business Solution Provider — the entity that
 * holds the WABA on our behalf. Meta delivers the original webhook to
 * Chakra with Meta's HMAC; Chakra terminates that, batches/normalizes,
 * and re-POSTs to our CHAKRA_PASSTHROUGH_WEBHOOK_URL. Chakra does NOT
 * forward the original x-hub-signature-256 (the upstream HMAC is over
 * Meta's body, not Chakra's). Re-verifying with META_APP_SECRET here
 * always fails — that's the bug that took WhatsApp inbound dark.
 *
 * Trust model: we already trust Chakra at the transport boundary via
 * the bearer CHAKRA_API_TOKEN we hand them for outbound. The webhook
 * traffic is the inbound mirror of that relationship. Accept it after
 * the JSON parse without HMAC; if Chakra ever exposes a signature
 * scheme of their own, swap this for that verifier.
 */
function verifyChakraProxiedWebhook(req: any, res: any, next: any) {
  if (!parseRawBody(req)) return res.status(400).end();
  return next();
}

const N8N_NORMALIZED_WEBHOOK_URL = (process.env.N8N_NORMALIZED_WEBHOOK_URL || '').trim();
const N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL = (process.env.N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL || '').trim();
const N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL = (process.env.N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL || '').trim();
const N8N_INTERNAL_API_KEY = (process.env.N8N_INTERNAL_API_KEY || '').trim();

const HUMAN_ACTIVE_MINUTES = Number(process.env.CONVERSATION_HUMAN_ACTIVE_MINUTES || 360);
const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v23.0').trim();

type InstagramScopedProfile = {
  id: string;
  name: string | null;
  username: string | null;
  profilePic: string | null;
  followerCount: number | null;
  isUserFollowBusiness: boolean | null;
  isBusinessFollowUser: boolean | null;
};

type InstagramProfileCacheRow = {
  subjectNormalized: string;
  profileName: string | null;
  profileUsername: string | null;
  profilePicUrl: string | null;
};

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

function buildMessageSignature(input: {
  conversationKey: string;
  messageType: string;
  text: string | null;
  eventDate: Date;
}): string {
  const payload = `${input.conversationKey}|${input.messageType}|${input.text || ''}|${input.eventDate.getTime()}`;
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

// Mirrors conversationMedia.labelForMediaTypes — fallback text for the
// quoted-block preview when the parent message has no body (a sticker,
// audio, image with no caption, etc.).
function labelForMediaTypes(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0] as { type?: string; isVoice?: boolean } | undefined;
  if (!first) return null;
  if (first.type === 'image') return '📷 Görsel';
  if (first.type === 'video') return '🎬 Video';
  if (first.type === 'audio') return first.isVoice ? '🎙️ Sesli mesaj' : '🎵 Ses';
  return null;
}

function normalizeMessageTypeForRetry(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  let current = normalized;
  if (current.startsWith('echo_')) {
    current = current.slice('echo_'.length);
  }
  if (current.endsWith('_outbound')) {
    current = current.slice(0, -'_outbound'.length);
  }
  return current;
}

function isSameMessageKindForRetry(a: string, b: string): boolean {
  return normalizeMessageTypeForRetry(a) === normalizeMessageTypeForRetry(b);
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

async function resolveCustomerLegacy(input: { salonId: number; channel: ChannelType; channelUserId: string | null }) {
  if (!input.channelUserId) return null;

  if (input.channel === 'WHATSAPP') {
    const needle = normalizePhoneDigits(input.channelUserId);
    if (!needle) return null;
    const list = await prisma.customer.findMany({
      where: { salonId: input.salonId },
      select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
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
    select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
    take: 4000,
  });

  return (
    list.find((c) => {
      const v = normalizeInstagramIdentity(c.instagram || '');
      return v === igNeedle || v === normalizeInstagramIdentity(`INSTAGRAM:${input.channelUserId}`);
    }) || null
  );
}

async function resolveCustomer(input: {
  salonId: number;
  channel: ChannelType;
  channelUserId: string | null;
  conversationKey: string;
}) {
  const identity = resolveIdentity({
    channel: input.channel,
    phone: input.channel === 'WHATSAPP' ? input.channelUserId : null,
    customerKey: input.channel === 'INSTAGRAM' ? input.channelUserId : null,
    conversationKey: input.conversationKey,
  });

  if (identity) {
    const bound = await findBoundCustomer({
      salonId: input.salonId,
      channel: input.channel,
      subjectNormalized: identity.subjectNormalized,
    });
    if (bound) {
      return { customer: bound, identity, identityLinked: true };
    }
  }

  const legacy = await resolveCustomerLegacy({
    salonId: input.salonId,
    channel: input.channel,
    channelUserId: input.channelUserId,
  });

  return { customer: legacy, identity, identityLinked: false };
}

function computeCustomerStatus(input: {
  customer: { instagram: string | null } | null;
  identityLinked: boolean;
}): 'unregistered' | 'number_registered' | 'both_registered' {
  const { customer, identityLinked } = input;
  if (!customer) return 'unregistered';
  if (identityLinked) return 'both_registered';
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
    const updated = await prisma.conversationState.update({
      where: { id: state.id },
      data: {
        mode: ConversationAutomationMode.AUTO,
        humanPendingSince: null,
        humanActiveUntil: null,
        notes: 'human_cancelled_by_customer',
      },
    });
    // Müşteri iptal etti → AUTO'ya döndü; bekleyen handover alarmını ANINDA durdur
    // (sweep emniyet ağına bırakma; 5 dk'ya kadar gereksiz reminder atabilir).
    await resolveHandoverAlert({ salonId: input.salonId, channel: input.channel, conversationKey: input.conversationKey }).catch(
      (err) => console.error('[handover] resolve on cancel failed', err?.message || err),
    );
    // Manuel dönemdeki birikmiş PENDING inbound mesajları DONE yap → hafızada
    // görünsünler (memory.ts processingStatus'a bakmaz) ama mevcut batch'e girmesin.
    await prisma.conversationMessageEvent.updateMany({
      where: { salonId: input.salonId, channel: input.channel, conversationKey: input.conversationKey, direction: 'INBOUND', processingStatus: 'PENDING' },
      data: { processingStatus: 'DONE' },
    }).catch(() => {});
    return updated;
  }

  if (input.isEcho && outboundTrace?.source !== OutboundMessageSource.AI_AGENT && !state.manualAlways) {
    const until = new Date(now.getTime() + HUMAN_ACTIVE_MINUTES * 60 * 1000);
    const updated = await prisma.conversationState.update({
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
    // Çalışan (panel VEYA telefondan/dış kanaldan) müşteriye cevap verdi → alarmı
    // durdur. Eksikti: dış-kanal echo'da mode HUMAN_ACTIVE olduğu için sweep'in
    // mode-guard'ı da çözmüyordu → çalışan cevap vermişken saatlerce reminder yağıyordu.
    await resolveHandoverAlert({
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      byHumanMessage: true,
    }).catch((err) => console.error('[handover] resolve on echo failed', err?.message || err));
    return updated;
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
      const updated = await prisma.conversationState.update({
        where: { id: state.id },
        data: {
          mode: ConversationAutomationMode.AUTO,
          humanPendingSince: null,
          humanActiveUntil: null,
          notes: pendingExpired ? 'auto_resumed_pending_timeout' : 'auto_resumed_active_timeout',
        },
      });
      await prisma.conversationMessageEvent.updateMany({
        where: { salonId: input.salonId, channel: input.channel, conversationKey: input.conversationKey, direction: 'INBOUND', processingStatus: 'PENDING' },
        data: { processingStatus: 'DONE' },
      }).catch(() => {});
      return updated;
    }
  }

  return state;
}

function computeStatePolicy(mode: ConversationAutomationMode) {
  if (mode === 'AUTO') return { aiAllowed: true, responsePolicy: 'normal' };
  if (mode === 'HUMAN_PENDING') return { aiAllowed: false, responsePolicy: 'pending_wait_with_cancel' };
  if (mode === 'AUTO_RESUME_PENDING') return { aiAllowed: true, responsePolicy: 'resume_then_normal' };
  if (mode === 'MANUAL_ALWAYS') return { aiAllowed: false, responsePolicy: 'manual_notify_only' };
  return { aiAllowed: false, responsePolicy: 'human_active_suppress' };
}

function chooseN8nTarget(channel: ChannelType) {
  if (channel === 'INSTAGRAM' && N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL) return N8N_NORMALIZED_INSTAGRAM_WEBHOOK_URL;
  if (channel === 'WHATSAPP' && N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL) return N8N_NORMALIZED_WHATSAPP_WEBHOOK_URL;
  return N8N_NORMALIZED_WEBHOOK_URL;
}

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

function splitCustomerName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const normalized = fullName.trim().replace(/\s+/g, ' ');
  if (!normalized) return { firstName: null, lastName: null };
  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function normalizeInstagramScopedId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return normalizeInstagramIdentity(trimmed) || trimmed;
}

function enrichRawPayloadWithInstagramProfile(rawPayload: unknown, profile: InstagramScopedProfile | null): unknown {
  if (!profile) return rawPayload;
  const raw = asObject(rawPayload);
  if (!Object.keys(raw).length) return rawPayload;

  return {
    ...raw,
    instagramProfile: {
      id: profile.id,
      name: profile.name,
      username: profile.username,
      profile_pic: profile.profilePic,
      follower_count: profile.followerCount,
      is_user_follow_business: profile.isUserFollowBusiness,
      is_business_follow_user: profile.isBusinessFollowUser,
    },
  };
}

async function loadInstagramMetaDirectCredentials(salonId: number) {
  const settings = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { faqAnswers: true },
  });
  const faq = asObject(settings?.faqAnswers);
  const metaDirect = asObject(faq.metaDirect);
  const instagram = asObject(metaDirect.instagram);

  const accessToken = asNullableString(instagram.accessToken);
  if (!accessToken) return null;

  return {
    accessToken,
    externalAccountId: asNullableString(instagram.externalAccountId),
  };
}

async function markInstagramWebhookSeen(salonId: number, eventDate: Date) {
  const record = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { faqAnswers: true },
  });

  const faq = asObject(record?.faqAnswers);
  const metaDirect = asObject(faq.metaDirect);
  const instagram = asObject(metaDirect.instagram);
  const currentIso = asNullableString(instagram.lastWebhookAt);
  const nextIso = eventDate.toISOString();

  if (currentIso) {
    const currentDate = new Date(currentIso);
    if (!Number.isNaN(currentDate.getTime()) && currentDate.getTime() >= eventDate.getTime()) {
      return;
    }
  }

  const nextFaq = {
    ...faq,
    metaDirect: {
      ...metaDirect,
      instagram: {
        ...instagram,
        lastWebhookAt: nextIso,
      },
      whatsapp: asObject(metaDirect.whatsapp),
    },
  };

  await prisma.salonAiAgentSettings.upsert({
    where: { salonId },
    update: { faqAnswers: nextFaq as any },
    create: {
      salonId,
      faqAnswers: nextFaq as any,
    },
  });
}

async function fetchInstagramScopedProfile(input: {
  scopedUserId: string;
  accessToken: string;
}): Promise<InstagramScopedProfile | null> {
  const scopedUserId = normalizeInstagramScopedId(input.scopedUserId);
  if (!scopedUserId || !input.accessToken.trim()) return null;

  try {
    const response = await axios.get(`https://graph.instagram.com/${META_GRAPH_VERSION}/${scopedUserId}`, {
      params: {
        fields:
          'name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user',
        access_token: input.accessToken.trim(),
      },
      timeout: 20000,
    });

    const data = asObject(response.data);
    return {
      id: asNullableString(data.id) || scopedUserId,
      name: asNullableString(data.name),
      username: asNullableString(data.username),
      profilePic: asNullableString(data.profile_pic),
      followerCount: Number.isFinite(Number(data.follower_count)) ? Number(data.follower_count) : null,
      isUserFollowBusiness:
        typeof data.is_user_follow_business === 'boolean' ? data.is_user_follow_business : null,
      isBusinessFollowUser:
        typeof data.is_business_follow_user === 'boolean' ? data.is_business_follow_user : null,
    };
  } catch (error: any) {
    const detail = error?.response?.data?.error || error?.response?.data || error?.message || 'unknown_error';
    console.error('Instagram profile lookup failed:', {
      scopedUserId,
      detail,
    });
    return null;
  }
}

function fromInstagramProfileCacheRow(
  row: InstagramProfileCacheRow | null | undefined,
): InstagramScopedProfile | null {
  if (!row) return null;
  if (!row.profileName && !row.profileUsername && !row.profilePicUrl) return null;
  return {
    id: row.subjectNormalized,
    name: row.profileName,
    username: row.profileUsername,
    profilePic: row.profilePicUrl,
    followerCount: null,
    isUserFollowBusiness: null,
    isBusinessFollowUser: null,
  };
}

async function findInstagramProfileCacheRow(input: {
  salonId: number;
  subjectNormalized: string;
}): Promise<InstagramProfileCacheRow | null> {
  return prisma.channelProfileCache.findUnique({
    where: {
      salonId_channel_subjectNormalized: {
        salonId: input.salonId,
        channel: ChannelType.INSTAGRAM,
        subjectNormalized: input.subjectNormalized,
      },
    },
    select: {
      subjectNormalized: true,
      profileName: true,
      profileUsername: true,
      profilePicUrl: true,
    },
  });
}

async function getOrFetchInstagramProfileOnce(input: {
  salonId: number;
  subjectNormalized: string;
  subjectRaw: string;
  accessToken: string;
}): Promise<InstagramScopedProfile | null> {
  const subjectNormalized = normalizeInstagramScopedId(input.subjectNormalized);
  if (!subjectNormalized) return null;

  const uniqueWhere = {
    salonId_channel_subjectNormalized: {
      salonId: input.salonId,
      channel: ChannelType.INSTAGRAM as ChannelType,
      subjectNormalized,
    },
  };

  let cacheRow = await prisma.channelProfileCache.findUnique({
    where: uniqueWhere,
    select: {
      subjectNormalized: true,
      profileName: true,
      profileUsername: true,
      profilePicUrl: true,
      fetchAttempts: true,
    },
  });

  if (!cacheRow) {
    try {
      await prisma.channelProfileCache.create({
        data: {
          salonId: input.salonId,
          channel: ChannelType.INSTAGRAM,
          subjectNormalized,
          subjectRaw: input.subjectRaw || subjectNormalized,
          fetchStatus: ChannelProfileFetchStatus.PENDING,
          fetchAttempts: 0,
        },
      });
    } catch (error: any) {
      // Unique collision means another worker inserted first; safe to continue.
      const prismaCode = error?.code || error?.meta?.code;
      if (prismaCode !== 'P2002') {
        throw error;
      }
    }

    cacheRow = await prisma.channelProfileCache.findUnique({
      where: uniqueWhere,
      select: {
        subjectNormalized: true,
        profileName: true,
        profileUsername: true,
        profilePicUrl: true,
        fetchAttempts: true,
      },
    });
  }

  const cachedProfile = fromInstagramProfileCacheRow(cacheRow);
  if (cachedProfile) return cachedProfile;

  if ((cacheRow?.fetchAttempts || 0) > 0) {
    // Automatic fetch already attempted once for this subject.
    return null;
  }

  const claimed = await prisma.channelProfileCache.updateMany({
    where: {
      salonId: input.salonId,
      channel: ChannelType.INSTAGRAM,
      subjectNormalized,
      fetchAttempts: 0,
    },
    data: {
      fetchAttempts: 1,
      fetchAttemptedAt: new Date(),
      fetchStatus: ChannelProfileFetchStatus.PENDING,
      subjectRaw: input.subjectRaw || subjectNormalized,
    },
  });

  if (claimed.count === 0) {
    const latest = await findInstagramProfileCacheRow({
      salonId: input.salonId,
      subjectNormalized,
    });
    return fromInstagramProfileCacheRow(latest);
  }

  const fetched = await fetchInstagramScopedProfile({
    scopedUserId: subjectNormalized,
    accessToken: input.accessToken,
  });

  if (fetched) {
    const storedProfilePicUrl = await storeConversationAvatarFromUrl({
      salonId: input.salonId,
      channel: ChannelType.INSTAGRAM,
      conversationKey: subjectNormalized,
      sourceUrl: fetched.profilePic,
      instagramAccessToken: input.accessToken,
    });
    const profilePicToPersist = storedProfilePicUrl || fetched.profilePic;
    await prisma.channelProfileCache.update({
      where: uniqueWhere,
      data: {
        profileName: fetched.name,
        profileUsername: fetched.username,
        profilePicUrl: profilePicToPersist,
        rawProfile: {
          id: fetched.id,
          name: fetched.name,
          username: fetched.username,
          profile_pic: profilePicToPersist,
          follower_count: fetched.followerCount,
          is_user_follow_business: fetched.isUserFollowBusiness,
          is_business_follow_user: fetched.isBusinessFollowUser,
        } as any,
        fetchStatus: ChannelProfileFetchStatus.SUCCESS,
        fetchedAt: new Date(),
        lastError: null,
      },
    });
    return {
      ...fetched,
      profilePic: profilePicToPersist,
    };
  }

  await prisma.channelProfileCache.update({
    where: uniqueWhere,
    data: {
      fetchStatus: ChannelProfileFetchStatus.FAILED,
      lastError: 'profile_lookup_failed',
    },
  });
  return null;
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

/** W6: processed webhook item → backend agent dispatch girdisi. Alanlar n8n'e
 *  giden payload ile aynı kaynaklardan; aiAllowed konuşma modu + kanal-AI gate'i. */
function mapToAgentInboundItem(item: any): AgentInboundItem {
  return {
    salonId: item.salonId,
    channel: item.channel as ChannelType,
    conversationKey: item.conversationKey,
    canonicalUserId: item.canonicalUserId ?? null,
    customerId: item.customerId ?? null,
    channelProfileName: item.profileName ?? null,
    registeredName: item.customerFullName ?? null,
    customerName: item.customerFullName ?? item.profileName ?? null,
    externalAccountId: item.externalAccountId ?? null,
    aiAllowed: Boolean(item.state?.aiAllowed),
    // HUMAN_PENDING + kanal-AI açık → AI yanıt vermeye devam etsin (dispatch gate'i
    // bunu aiAllowed=false olsa bile geçirir; canlı mod tekrar kontrol edilir).
    handoverPending: Boolean(item.state?.mode === 'HUMAN_PENDING' && item.state?.channelAiEnabled),
    repliedTo: item.repliedTo ?? null,
  };
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
        const field = String(change?.field || 'messages');
        const isEchoField = field === 'smb_message_echoes';
        const messageList = (value?.messages || value?.message_echoes || []) as any[];

        for (const msg of messageList) {
          const from = msg?.from ?? null;
          const contact = from ? contactByWaId[from] : null;

          // WhatsApp reaction events: msg.type === 'reaction' carries
          // { message_id: <target>, emoji: "❤️" }. Like the IG branch,
          // we DO NOT create a new conversation row — we route to the
          // reactions merge path so it shows up as an inline chip under
          // the target bubble. An empty emoji means "unreact" in Cloud
          // API conventions.
          if (msg?.type === 'reaction' && msg?.reaction) {
            const emoji = typeof msg.reaction.emoji === 'string' ? msg.reaction.emoji : '';
            out.push({
              channel: 'WHATSAPP',
              kind: 'reaction',
              targetProviderMessageId:
                typeof msg.reaction.message_id === 'string' ? msg.reaction.message_id : null,
              action: emoji ? 'react' : 'unreact',
              emoji: emoji || null,
              fromId: from || null,
              externalAccountId: value?.metadata?.phone_number_id || null,
              externalBusinessId: entry?.id || null,
              timestamp: Number(msg?.timestamp || Date.now()),
              eventTimestamp: toIsoFromTs(msg?.timestamp),
            });
            continue;
          }

          const media: any[] = [];

          if (msg?.image) media.push({ type: 'image', id: msg.image.id ?? null, url: msg.image.url ?? null, caption: msg.image.caption ?? null });
          if (msg?.audio) media.push({ type: 'audio', id: msg.audio.id ?? null, url: msg.audio.url ?? null, voice: !!msg.audio.voice });
          if (msg?.video) media.push({ type: 'video', id: msg.video.id ?? null, url: msg.video.url ?? null, caption: msg.video.caption ?? null });
          if (msg?.document) media.push({ type: 'document', id: msg.document.id ?? null, url: msg.document.url ?? null, filename: msg.document.filename ?? null, caption: msg.document.caption ?? null });
          if (msg?.sticker) media.push({ type: 'sticker', id: msg.sticker.id ?? null, url: msg.sticker.url ?? null });

          const messageType = parseMetaMessageType('WHATSAPP', msg, media);
          
          // Detect echo (outbound) for WhatsApp:
          // In Cloud API, if the message is sent from a linked device (phone app),
          // 'from' will match the business phone number.
          const businessWaId = value?.metadata?.display_phone_number;
          const isEcho = isEchoField || Boolean(msg?.type && from && businessWaId && from === businessWaId);

          // For inbound, channelUserId is 'from'. For echo, it's 'to' (the customer).
          // If 'to' is missing (common in smb_message_echoes), try to use the first contact's wa_id.
          const channelUserId = isEcho 
            ? (msg?.to || contacts[0]?.wa_id || null) 
            : (contact?.wa_id || from || null);
          
          const mediaUrls = media.map((m) => m?.url).filter(Boolean);
          const primaryMedia = media[0] || null;
          const primaryMediaId = primaryMedia?.id || null;

          // Reply context: WhatsApp Cloud API puts the parent message id
          // under `message.context.id`. We carry it forward so the inbox
          // ingest can resolve it to our DB row and persist a quoted
          // preview on the bubble.
          const replyToProviderMessageId =
            typeof msg?.context?.id === 'string' && msg.context.id.trim()
              ? msg.context.id.trim()
              : null;

          out.push({
            channel: 'WHATSAPP',
            providerMessageId: msg?.id ?? `wa_${Date.now()}`,
            messageType,
            routeMessageType: String(messageType || 'unknown').trim().toLowerCase(),
            replyToProviderMessageId,
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
            recipientId: value?.metadata?.phone_number_id || (isEcho ? null : from) || null,
            externalAccountId: value?.metadata?.phone_number_id || null,
            externalBusinessId: entry?.id || null,
            businessDisplayPhone: typeof value?.metadata?.display_phone_number === 'string' ? value.metadata.display_phone_number : null,
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
            direction: isEcho ? 'outbound' : 'inbound',
            isEcho,
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
        const reactionEv = ev?.reaction;
        if (!m && !postback && !reactionEv) continue;

        // Instagram reaction events: customer reacted to one of our outbound
        // messages, or to one of their own. They DO NOT create a new
        // conversation row — they attach to the target message
        // (reaction.mid) and get rendered as an inline emoji on its bubble.
        // We emit a special parsed item that processIncomingBatch routes to
        // the reactions-merge path instead of upsertConversationMessageEvent.
        if (reactionEv && !m && !postback) {
          out.push({
            channel: 'INSTAGRAM',
            kind: 'reaction',
            // identifies the message the reaction targets
            targetProviderMessageId: typeof reactionEv.mid === 'string' ? reactionEv.mid : null,
            action: typeof reactionEv.action === 'string' ? reactionEv.action : 'react',
            emoji:
              typeof reactionEv.emoji === 'string' && reactionEv.emoji
                ? reactionEv.emoji
                : typeof reactionEv.reaction === 'string'
                  ? reactionEv.reaction
                  : null,
            fromId: ev?.sender?.id || null,
            recipientId: ev?.recipient?.id || null,
            externalAccountId: entry?.id || ev?.recipient?.id || null,
            externalBusinessId: entry?.id || null,
            timestamp: Number(ev?.timestamp || Date.now()),
            eventTimestamp: toIsoFromTs(ev?.timestamp),
          });
          continue;
        }

        const isEcho = m?.is_echo === true;
        const attachments = m?.attachments ?? [];
        const media = attachments.map((a: any) => ({
          type: a?.type || 'attachment',
          id: a?.payload?.id || null,
          url: a?.payload?.url || null,
        }));

        const messageType = postback ? 'postback' : parseMetaMessageType('INSTAGRAM', m, media);
        const senderId = ev?.sender?.id || null;
        const recipientId = ev?.recipient?.id || null;
        // For echo events sender is the business account.
        // Conversation/user identity must always represent the customer side.
        const channelUserId = isEcho ? recipientId : senderId;
        const externalAccountId = isEcho ? senderId : recipientId;
        const mediaUrls = media.map((mm: any) => mm?.url).filter(Boolean);
        const primaryMedia = media[0] || null;
        const eventRaw = {
          object: root.object,
          entry: [
            {
              id: entry?.id || null,
              time: entry?.time || ev?.timestamp || Date.now(),
              messaging: [ev],
            },
          ],
        };

        // Reply context: Instagram Graph webhook puts the parent message
        // id under `message.reply_to.mid`. Forward it so we can render
        // the quoted preview on the inbound bubble.
        const replyToProviderMessageId =
          typeof m?.reply_to?.mid === 'string' && m.reply_to.mid.trim()
            ? m.reply_to.mid.trim()
            : null;

        out.push({
          channel: 'INSTAGRAM',
          providerMessageId: m?.mid || `ig_${ev?.timestamp || Date.now()}_${ev?.sender?.id || 'unknown'}`,
          messageType,
          routeMessageType: String(messageType || 'unknown').trim().toLowerCase(),
          replyToProviderMessageId,
          text: m?.text || postback?.title || postback?.payload || null,
          timestamp: Number(ev?.timestamp || Date.now()),
          eventTimestamp: toIsoFromTs(ev?.timestamp),
          senderId,
          recipientId,
          externalAccountId: externalAccountId || entry?.id || null,
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
          raw: eventRaw,
        });
      }
    }
  }

  return out;
}

/**
 * Merge a reaction event into the target message's reactions JSON column.
 *
 * Shape of `reactions`:
 *   [{ emoji: "❤️", from: "<psid|phone>", at: "<iso>", action?: "react" }]
 *
 * `action: 'react'` adds (deduped by `from`, replaces any previous emoji
 * from the same sender). `action: 'unreact'` removes any entry from that
 * sender. Both Instagram and WhatsApp follow the same shape — channel
 * differences live in how the parser pulls the emoji + target mid.
 *
 * Returns 'ok' on success, 'target_not_found' when the targeted message
 * id doesn't exist in our DB (Meta sometimes delivers reactions on
 * messages we never received the original of, e.g. ones older than our
 * subscription start). The webhook log captures the raw event in either
 * case so we can audit later.
 */
async function applyMessageReaction(
  channel: ChannelType,
  ev: any,
): Promise<'ok' | 'target_not_found' | 'no_target_id'> {
  const targetMid = typeof ev.targetProviderMessageId === 'string' ? ev.targetProviderMessageId.trim() : '';
  if (!targetMid) return 'no_target_id';

  const target = await prisma.conversationMessageEvent.findUnique({
    where: { channel_providerMessageId: { channel, providerMessageId: targetMid } },
    select: { id: true, reactions: true },
  });
  if (!target) return 'target_not_found';

  const existing: Array<{ emoji: string; from: string; at: string }> = Array.isArray(target.reactions)
    ? (target.reactions as any[]).filter((r) => r && typeof r === 'object').map((r) => ({
        emoji: typeof r.emoji === 'string' ? r.emoji : '',
        from: typeof r.from === 'string' ? r.from : '',
        at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
      }))
    : [];

  const fromId = typeof ev.fromId === 'string' ? ev.fromId : '';
  const action = ev.action === 'unreact' ? 'unreact' : 'react';

  // Drop any prior reaction from this sender first — a person can only
  // hold one active reaction per message at a time (WhatsApp behavior;
  // Instagram lets multiple of the SAME message-target via different
  // accounts which is already keyed on `from` here).
  const filtered = existing.filter((r) => r.from !== fromId);
  let next = filtered;
  if (action === 'react' && fromId && typeof ev.emoji === 'string' && ev.emoji) {
    next = [
      ...filtered,
      {
        emoji: ev.emoji,
        from: fromId,
        at: typeof ev.eventTimestamp === 'string' ? ev.eventTimestamp : new Date().toISOString(),
      },
    ];
  }

  await prisma.conversationMessageEvent.update({
    where: { id: target.id },
    data: { reactions: next as any },
  });
  return 'ok';
}

async function processIncomingBatch(items: any[]) {
  const processed: any[] = [];
  const instagramCredentialsBySalon = new Map<number, { accessToken: string; externalAccountId: string | null } | null>();
  const instagramProfileBySubject = new Map<string, InstagramScopedProfile | null>();
  // Kanal-bazı "AI Aktif" bayrağı (SalonChannelBinding.aiEnabled) — salon+kanal
  // başına bir kez sorgula, batch içinde tekrar etme. Güvenli varsayılan: açık.
  const channelAiCache = new Map<string, boolean>();

  for (const row of items) {
    const channel = row.channel as ChannelType;

    // Reaction events follow a separate path: they don't create a new
    // ConversationMessageEvent row — they merge into the target message's
    // `reactions` JSON column. The mobile bubble then renders the emoji
    // chip inline (WhatsApp / Instagram style) instead of as a standalone
    // bubble. `react` adds, `unreact` removes.
    if (row.kind === 'reaction') {
      const result = await applyMessageReaction(channel, row).catch((err) => {
        console.error('[reactions] apply failed:', err);
        return 'reaction_apply_failed';
      });
      processed.push({ ...row, success: result === 'ok', result });
      continue;
    }

    const incomingProviderMessageId = String(row.providerMessageId || '').trim();
    let providerMessageId = incomingProviderMessageId;
    const conversationKey = String(row.channelConversationKey || '').trim();
    const externalAccountId = typeof row.externalAccountId === 'string' ? row.externalAccountId.trim() : null;
    const externalBusinessId = typeof row.externalBusinessId === 'string' ? row.externalBusinessId.trim() : null;

    // Instagram account-verification code capture (salon-agnostic). If an inbound
    // IG DM carries a pending KEDY-xxxxx code, bind that account's IGSID to the
    // person who started the verification. Runs BEFORE salon resolution so it
    // also works for the Kedy-central IG account (which has no salon binding).
    // Wrapped so it can never break normal webhook processing.
    if (channel === 'INSTAGRAM' && !row.isEcho && typeof row.text === 'string' && row.text.length > 0) {
      try {
        await tryConsumeInstagramVerifyCode({
          igsid: normalizeInstagramScopedId(typeof row.channelUserId === 'string' ? row.channelUserId : ''),
          username: null,
          text: row.text,
        });
      } catch (e: any) {
        console.warn('IG verify code capture failed:', e?.message || e);
      }
    }

    const salonId = await resolveSalonId(channel, externalAccountId, externalBusinessId);
    if (!salonId) {
      processed.push({ ...row, success: false, result: 'salon_not_found' });
      continue;
    }

    if (channel === 'INSTAGRAM' && !row.isEcho) {
      await markInstagramWebhookSeen(salonId, toEventDate(row));
    }

    // Backfill salon.whatsappPhone with the human-readable display phone
    // exposed by Meta in WhatsApp webhook metadata. Chakra'nın plugin state
    // sadece phone_number_id veriyor; display_phone_number'ı yalnızca
    // mesaj webhook'unda görüyoruz. Sadece kolon boşsa yazıyoruz; kullanıcı
    // manuel girmişse dokunma.
    if (channel === 'WHATSAPP') {
      const displayPhone = typeof row.businessDisplayPhone === 'string' ? row.businessDisplayPhone.trim() : '';
      if (displayPhone) {
        try {
          await prisma.salon.updateMany({
            where: {
              id: salonId,
              OR: [{ whatsappPhone: null }, { whatsappPhone: '' }],
            },
            data: { whatsappPhone: displayPhone },
          });
        } catch (err: any) {
          console.warn('whatsappPhone webhook backfill failed:', err?.message || err);
        }
      }
    }

    let instagramProfile: InstagramScopedProfile | null = null;
    let instagramAccessTokenForAvatar: string | null = null;
    if (channel === 'INSTAGRAM' && !row.isEcho) {
      const scopedUserId = normalizeInstagramScopedId(
        typeof row.channelUserId === 'string' ? row.channelUserId : '',
      );
      if (scopedUserId) {
        let credentials = instagramCredentialsBySalon.get(salonId);
        if (credentials === undefined) {
          credentials = await loadInstagramMetaDirectCredentials(salonId);
          instagramCredentialsBySalon.set(salonId, credentials);
        }

        const connectedAccountId = normalizeInstagramScopedId(credentials?.externalAccountId || '');
        instagramAccessTokenForAvatar = credentials?.accessToken || null;
        if (credentials?.accessToken && (!connectedAccountId || connectedAccountId !== scopedUserId)) {
          const cacheKey = `${salonId}:${scopedUserId}`;
          if (instagramProfileBySubject.has(cacheKey)) {
            instagramProfile = instagramProfileBySubject.get(cacheKey) || null;
          } else {
            instagramProfile = await getOrFetchInstagramProfileOnce({
              salonId,
              subjectNormalized: scopedUserId,
              subjectRaw: typeof row.channelUserId === 'string' ? row.channelUserId : scopedUserId,
              accessToken: credentials.accessToken,
            });
            instagramProfileBySubject.set(cacheKey, instagramProfile);
          }
        }

        // Deferred IG bind (Mechanism B): if a customer claimed this IG username
        // at registration (pendingInstagramUsername), link the now-known IGSID to
        // their platform-wide identity so cross-salon recognition + the unified
        // profile photo start working for this person on Instagram too.
        if (instagramProfile?.username) {
          try {
            await bindPendingInstagramUsername({
              igsid: scopedUserId,
              username: instagramProfile.username,
              profilePicUrl: instagramProfile.profilePic,
            });
          } catch (bindError) {
            console.warn('IG deferred bind failed:', bindError);
          }
        }
      }
    }

    const { customer, identity, identityLinked } = await resolveCustomer({
      salonId,
      channel,
      channelUserId: typeof row.channelUserId === 'string' ? row.channelUserId : null,
      conversationKey,
    });

    // --- INTERACTIVE BUTTON HANDLER ---
    if (row.actionPayload && customer?.id) {
      const payload = String(row.actionPayload).trim().toUpperCase();
      const now = new Date();

      if (['CONFIRM_APPOINTMENT', 'REMINDER_CONFIRM', 'CANCEL_APPOINTMENT', 'REMINDER_CANCEL'].includes(payload)) {
        // Find next upcoming appointment
        const appointment = await prisma.appointment.findFirst({
          where: {
            salonId,
            customerId: customer.id,
            startTime: { gte: now },
            // UPDATED = ertelenmiş (ölü) randevu — WhatsApp onay/iptal butonu onu
            // HEDEF ALMAMALI (yoksa müşteri "Onayla"da canlı yeni randevu yerine
            // eski ölü randevuyu CONFIRMED/CANCELLED yapardı). CONFIRMED dahil:
            // onaylanmış randevu yine iptal edilebilsin.
            status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED] }
          },
          orderBy: { startTime: 'asc' }
        });

        if (appointment) {
          let newStatus: AppointmentStatus | null = null;
          if (payload === 'CONFIRM_APPOINTMENT' || payload === 'REMINDER_CONFIRM') {
            newStatus = AppointmentStatus.CONFIRMED;
          } else if (payload === 'CANCEL_APPOINTMENT' || payload === 'REMINDER_CANCEL') {
            newStatus = AppointmentStatus.CANCELLED;
          }

          if (newStatus) {
            await prisma.appointment.update({
              where: { id: appointment.id },
              data: { status: newStatus }
            });
            console.log(`[Webhook] Appointment ${appointment.id} updated to ${newStatus} via ${payload}`);
          }
        }
      } else if (payload === 'WAITLIST_ACCEPT') {
        // Find most recent pending waitlist offer
        const offer = await prisma.waitlistOffer.findFirst({
          where: {
            salonId,
            waitlistEntry: { customerId: customer.id },
            status: WaitlistOfferStatus.SENT,
            expiresAt: { gte: now }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (offer) {
          await prisma.waitlistOffer.update({
            where: { id: offer.id },
            data: { 
              status: WaitlistOfferStatus.ACCEPTED,
              acceptedAt: now
            }
          });
          console.log(`[Webhook] Waitlist offer ${offer.id} accepted for customer ${customer.id}`);
        }
      } else if (['FEEDBACK_HAPPY', 'FEEDBACK_ISSUE'].includes(payload)) {
        // Find most recent finished appointment
        const appointment = await prisma.appointment.findFirst({
          where: {
            salonId,
            customerId: customer.id,
            endTime: { lte: now }
          },
          orderBy: { endTime: 'desc' }
        });

        if (appointment) {
          console.log(`[Webhook] Feedback received: ${payload} for appointment ${appointment.id}`);
          // Optional: Create a SalonFeedback entry if model exists
        }
      }
    }
    // ----------------------------------

    // Yasaklı müşteri kontrolü — echo değil + gerçek inbound mesaj
    if (!row.isEcho) {
      const subjectForBan = channel === 'INSTAGRAM'
        ? (typeof row.channelUserId === 'string' ? row.channelUserId.trim() : null)
        : null;
      const phoneForBan = channel === 'WHATSAPP' ? conversationKey : null;
      const banResult = await isIdentityBanned({
        salonId,
        customerId: customer?.id ?? null,
        phone: phoneForBan,
        channel,
        subjectNormalized: subjectForBan,
      }).catch(() => ({ blocked: false, reason: null, entryId: null, matchType: null }));

      if (banResult.blocked) {
        const salonRow = await prisma.salon.findUnique({
          where: { id: salonId },
          select: { name: true, whatsappPhone: true },
        }).catch(() => null);
        const contactPhone = salonRow?.whatsappPhone?.trim() || null;
        const salonName = salonRow?.name?.trim() || 'Salon';
        const banMsg = contactPhone
          ? `Merhaba! Bu numara/hesap, ${salonName} tarafından randevu ve hizmet alımına kapatılmıştır. Bir yanlışlık olduğunu düşünüyorsanız veya durumu çözmek istiyorsanız lütfen salonumuzu arayın: ${contactPhone}`
          : `Merhaba! Bu numara/hesap, ${salonName} tarafından randevu ve hizmet alımına kapatılmıştır. Bir yanlışlık olduğunu düşünüyorsanız lütfen salonla doğrudan iletişime geçiniz.`;

        if (channel === 'WHATSAPP') {
          await sendWhatsappViaChakra({
            salonId,
            conversationKey,
            text: banMsg,
            actionKind: 'none',
            externalAccountId: externalAccountId || null,
          }).catch(() => {});
        } else if (channel === 'INSTAGRAM') {
          await sendInstagramMessage({
            salonId,
            conversationKey,
            text: banMsg,
            actionKind: 'none',
            externalAccountId: externalAccountId || null,
          }).catch(() => {});
        }

        processed.push({ ...row, success: true, result: 'banned_autoreply' });
        continue;
      }
    }

    const customerStatus = computeCustomerStatus({ customer, identityLinked });
    const canonicalUserId = customer?.id ? `customer:${customer.id}` : conversationKey;
    const channelProfileName =
      asNullableString(row.rawProfileName) || asNullableString(instagramProfile?.name) || null;

    const customerFullName = customer?.name && customer.name.trim().length > 0 ? customer.name.trim() : null;
    const fallbackSplit = splitCustomerName(customerFullName);
    const customerFirstName = asNullableString(customer?.firstName) || fallbackSplit.firstName;
    const customerLastName = asNullableString(customer?.lastName) || fallbackSplit.lastName;

    const nameSource = customer?.id
      ? customer.name && customer.name.trim().length > 0
        ? 'customer_record'
        : 'none'
      : channelProfileName
        ? 'channel_profile'
        : 'none';

    const profileName = customer?.id
      ? customer.name && customer.name.trim().length > 0
        ? customer.name.trim()
        : null
      : channelProfileName;

    const profileUsername = asNullableString(instagramProfile?.username);
    const storedProfilePictureUrl = await storeConversationAvatarFromUrl({
      salonId,
      channel,
      conversationKey,
      sourceUrl: instagramProfile?.profilePic || null,
      instagramAccessToken: channel === 'INSTAGRAM' ? instagramAccessTokenForAvatar : null,
    });
    const profilePictureUrl = storedProfilePictureUrl || asNullableString(instagramProfile?.profilePic);
    if (instagramProfile && profilePictureUrl) {
      instagramProfile.profilePic = profilePictureUrl;
    }
    const rawPayloadForStorage = enrichRawPayloadWithInstagramProfile(row.raw, instagramProfile);

    const eventDate = toEventDate(row);
    const forceAutoByCancel = isHumanCancelSignal(row);
    const intendedMessageType = row.isEcho ? `echo_${row.messageType}` : row.messageType;

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
      const sameMessageType = isSameMessageKindForRetry(existingProviderRow.messageType, intendedMessageType);
      const sameText = (existingProviderRow.text || null) === (row.text || null);
      const likelyRetryOrEcho = sameConversation && sameMessageType && sameText && withinRetryWindow;

      if (!likelyRetryOrEcho) {
        const signature = buildMessageSignature({
          conversationKey,
          messageType: intendedMessageType,
          text: row.text || null,
          eventDate,
        });
        providerMessageId = `${providerMessageId}__${signature}`;
      }
    }

    if (identity) {
      await upsertIdentitySession({
        salonId,
        identity,
        conversationKey,
        canonicalUserId,
        customerId: customer?.id || null,
        inboundAt: eventDate,
        status: customer?.id ? 'LINKED' : 'ACTIVE',
        metadata: {
          lastProviderMessageId: providerMessageId,
          lastDirection: row.isEcho ? 'echo' : 'inbound',
        },
      });
    }

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
        messageType: intendedMessageType,
        text: row.text || null,
        eventTimestamp: eventDate,
        rawPayload: rawPayloadForStorage as any,
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
        messageType: intendedMessageType,
        text: row.text || null,
        eventTimestamp: eventDate,
        rawPayload: rawPayloadForStorage as any,
        status: row.isEcho ? InboundMessageStatus.DONE : InboundMessageStatus.PENDING,
        processedAt: row.isEcho ? new Date() : null,
      },
    });

    const outboundTraceMeta = row.isEcho
      ? await prisma.outboundMessageTrace.findUnique({
          where: {
            channel_providerMessageId: {
              channel,
              providerMessageId: incomingProviderMessageId || providerMessageId,
            },
          },
          select: {
            source: true,
            sourceUserId: true,
            sourceUserEmail: true,
          },
        })
      : null;

    const eventRawPayload = row.isEcho
      ? ({
          ...asObject(rawPayloadForStorage),
          source: outboundTraceMeta?.source || asObject(rawPayloadForStorage).source || null,
          sentBy: {
            userId:
              typeof outboundTraceMeta?.sourceUserId === 'number'
                ? outboundTraceMeta.sourceUserId
                : asObject(asObject(rawPayloadForStorage).sentBy).userId || null,
            email:
              typeof outboundTraceMeta?.sourceUserEmail === 'string'
                ? outboundTraceMeta.sourceUserEmail
                : asObject(asObject(rawPayloadForStorage).sentBy).email || null,
          },
        } as any)
      : (rawPayloadForStorage as any);

    // Extract structured media metadata from the channel-specific `media`
    // array into our mediaItems schema. Empty → null so we don't overwrite
    // a previously-populated row on idempotent webhook redelivery.
    const rawMediaArray = Array.isArray((row as any).media) ? (row as any).media : [];
    const mediaItems = buildMediaItemsFromWebhook(rawMediaArray);

    // Resolve customer's reply-to context into our DB pointer. Quoted
    // message id comes from WhatsApp's `message.context.id` or
    // Instagram's `message.reply_to.mid`; we look it up in our own
    // ConversationMessageEvent table (same salon + channel) and copy
    // the id + a short text preview into the new row so the bubble can
    // render a quoted block above the body, mirroring how WhatsApp /
    // Instagram do it natively.
    const replyToProviderMessageId =
      typeof (row as any).replyToProviderMessageId === 'string'
        && (row as any).replyToProviderMessageId.trim()
        ? (row as any).replyToProviderMessageId.trim() as string
        : null;
    let repliedToMessageId: number | null = null;
    let repliedToText: string | null = null;
    let repliedToContext: {
      messageId: number;
      providerMessageId: string;
      text: string | null;
      direction: 'inbound' | 'outbound' | 'system' | null;
      fromAI: boolean;
      mediaLabel: string | null;
      eventTimestamp: string | null;
    } | null = null;
    if (replyToProviderMessageId) {
      const parent = await prisma.conversationMessageEvent.findFirst({
        where: { salonId, channel, providerMessageId: replyToProviderMessageId },
        select: {
          id: true,
          text: true,
          messageType: true,
          mediaItems: true,
          direction: true,
          outboundSource: true,
          eventTimestamp: true,
        },
      });
      if (parent) {
        repliedToMessageId = parent.id;
        const mediaLabel = labelForMediaTypes(parent.mediaItems);
        repliedToText = parent.text || mediaLabel || parent.messageType || null;
        const dir = String(parent.direction || '').toLowerCase();
        repliedToContext = {
          messageId: parent.id,
          providerMessageId: replyToProviderMessageId,
          text: parent.text || null,
          direction: (dir === 'inbound' || dir === 'outbound' || dir === 'system')
            ? (dir as 'inbound' | 'outbound' | 'system')
            : null,
          fromAI: String(parent.outboundSource || '').toUpperCase() === 'AI_AGENT',
          mediaLabel,
          eventTimestamp: parent.eventTimestamp ? parent.eventTimestamp.toISOString() : null,
        };
      }
    }

    await upsertConversationMessageEvent({
      salonId,
      channel,
      conversationKey,
      providerMessageId,
      externalAccountId: externalAccountId || externalBusinessId || '',
      customerName: profileName,
      messageType: intendedMessageType,
      text: row.text || null,
      direction: row.isEcho ? 'OUTBOUND' : 'INBOUND',
      eventTimestamp: eventDate,
      // Cancel sinyali (HUMAN_CANCEL): state evaluateConversationState'de zaten işlendi
      // (mode→AUTO). Agent'a iletme — "İptal Et" metnini randevu-iptali sanmasın.
      processingStatus: (row.isEcho || forceAutoByCancel) ? InboundMessageStatus.DONE : InboundMessageStatus.PENDING,
      outboundSource: row.isEcho ? outboundTraceMeta?.source || null : null,
      outboundSenderUserId: row.isEcho ? outboundTraceMeta?.sourceUserId || null : null,
      outboundSenderEmail: row.isEcho ? outboundTraceMeta?.sourceUserEmail || null : null,
      rawPayload: eventRawPayload,
      mediaItems: mediaItems.length > 0 ? (mediaItems as any) : undefined,
      repliedToMessageId,
      repliedToProviderMessageId: replyToProviderMessageId,
      repliedToText,
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

    // HUMAN_CANCEL sonrası: drain bitti, şimdi AI'nın bağlamı anlayacağı
    // synthetic bir PENDING mesaj ekle. Dispatch 5sn debounce içinde bunu alır
    // ve agent "handover iptal edildi" bağlamıyla uygun yanıt üretir.
    if (forceAutoByCancel && !row.isEcho) {
      await upsertConversationMessageEvent({
        salonId,
        channel,
        conversationKey,
        providerMessageId: `handover_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        externalAccountId: externalAccountId || externalBusinessId || '',
        customerName: profileName,
        messageType: 'handover_cancelled',
        text: 'Asistanla devam etmek istiyorum.',
        direction: 'INBOUND',
        eventTimestamp: new Date(eventDate.getTime() + 1),
        processingStatus: InboundMessageStatus.PENDING,
        rawPayload: {},
      });
    }

    const statePolicy = computeStatePolicy(state.mode);

    // Kanal-bazı "AI Aktif": salon bu kanalda otomatik yanıtı kapattıysa
    // (panel toggle → SalonChannelBinding.aiEnabled=false) agent hiç çalışmasın.
    // Mevcut n8n "If" gate'i zaten state.aiAllowed'a bakıyor → buraya AND'liyoruz,
    // n8n grafiğine dokunmaya gerek yok. Güvenli varsayılan: bağlama yoksa açık.
    const channelAiKey = `${salonId}:${channel}`;
    let channelAiEnabled = channelAiCache.get(channelAiKey);
    if (channelAiEnabled === undefined) {
      try {
        const aiBinding = await prisma.salonChannelBinding.findFirst({
          where: { salonId, channel },
          select: { aiEnabled: true },
          orderBy: { id: 'desc' },
        });
        channelAiEnabled = aiBinding ? aiBinding.aiEnabled !== false : true;
      } catch {
        channelAiEnabled = true;
      }
      channelAiCache.set(channelAiKey, channelAiEnabled);
    }

    const agentContext = await loadSalonAgentContext(salonId);
    const agentSettings = agentContext?.agentSettings ?? {
      tone: 'balanced',
      answerLength: 'medium',
      emojiUsage: 'low',
      bookingGuidance: 'medium',
      handoverThreshold: 'balanced',
      aiDisclosure: 'onQuestion',
    };
    const salonInfo = agentContext?.salonInfo ?? {
      salonId,
      name: null,
      city: null,
      district: null,
      address: null,
      googleMapsUrl: null,
      instagramUrl: null,
      whatsappPhone: null,
      tagline: null,
      about: null,
      timezone: 'Europe/Istanbul',
      workStartHour: 9,
      workEndHour: 18,
      slotInterval: 30,
      workingDays: null,
      workingHoursByDay: null,
      commonQuestions: null,
    };
    const toneDirective = agentContext?.toneDirective || '';
    const styleDirective = agentContext?.styleDirective || '';
    const salonOneLiner = agentContext?.salonOneLiner || '';

    // Müşteri snapshot + ton kalibrasyonu — n8n agent prompt'ında
    // "# MÜŞTERİ KİMLİK" bloğu için. Kayıtsız müşteride DB sorgusu yapmaz.
    const customerSnapshot = await loadCustomerSnapshot({
      salonId,
      customerId: customer?.id || null,
      channelProfileName,
      registeredName: customerFullName,
    });
    const customerCalibration = buildCustomerCalibration(agentSettings.tone, customerSnapshot);

    processed.push({
      ...row,
      toneDirective,
      styleDirective,
      salonOneLiner,
      customer: customerSnapshot,
      customerCalibration,
      // Tam dinamik sistem prompt — salon ayarları + müşteri + ton/stil burada
      // birleşir. n8n agent node'u sadece bunu enjekte eder ($json.body.systemPrompt).
      systemPrompt: buildSystemPrompt({
        toneDirective,
        styleDirective,
        salonOneLiner,
        salonInfo,
        customer: customerSnapshot,
        customerCalibration,
        repliedTo: repliedToContext,
      }),
      providerMessageId,
      originalProviderMessageId: incomingProviderMessageId !== providerMessageId ? incomingProviderMessageId : undefined,
      salonId,
      customerId: customer?.id || null,
      customerStatus,
      canonicalUserId,
      profileName,
      customerFirstName,
      customerLastName,
      customerFullName: customerFullName || profileName || null,
      profileUsername,
      profilePictureUrl,
      channelProfile: instagramProfile
        ? {
            id: instagramProfile.id,
            name: instagramProfile.name,
            username: instagramProfile.username,
            profile_pic: instagramProfile.profilePic,
            follower_count: instagramProfile.followerCount,
            is_user_follow_business: instagramProfile.isUserFollowBusiness,
            is_business_follow_user: instagramProfile.isBusinessFollowUser,
          }
        : null,
      nameSource,
      phone_available: channel === 'WHATSAPP' || Boolean(customer?.phone),
      instagram_linked: Boolean(identityLinked || (customer?.instagram && customer.instagram.trim())),
      identityLinked,
      canGenerateMagicLinkDirectly: computeMagicDirect(channel, customerStatus),
      salonInfo,
      agentSettings,
      state: {
        mode: state.mode,
        // Konuşma modu izin veriyor VE kanal-bazı AI açıksa otomatik yanıt.
        aiAllowed: statePolicy.aiAllowed && channelAiEnabled,
        responsePolicy: statePolicy.responsePolicy,
        // Backend dispatch: HUMAN_PENDING'de aiAllowed false olsa da kanal-AI açıksa
        // yanıt vermeye devam etsin (n8n bundan etkilenmez — aiAllowed'ı okur).
        channelAiEnabled,
      },
      userAction: forceAutoByCancel ? 'HUMAN_CANCEL' : row.actionPayload || null,
      // Reply-to context for the AI agent. When the customer quotes an
      // earlier message in their reply, n8n receives the parent's body
      // (or media-type label) plus a hint about who originally sent it,
      // so the system prompt can ground the response on the right
      // referent ("they're asking about your earlier suggestion to …").
      repliedTo: repliedToContext,
      // Backward compatibility for old flows
      conversationKey,
      customer_status: customerStatus,
      can_generate_magic_link_directly: computeMagicDirect(channel, customerStatus),
      profile_username: profileUsername,
      profile_picture_url: profilePictureUrl,
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
    // Short-circuit: template status update events go to their own handler
    // (drives the SalonMessageTemplate submission state machine).
    if (isTemplateStatusPayload(req.body)) {
      await processTemplateStatusPayload(req.body).catch(err =>
        console.error('[channelWebhooks] template status processing failed:', err)
      );
      return res.status(200).json({ ok: true, kind: 'template_status' });
    }

    // Log the raw webhook for debugging
    const channel = forcedChannel || (req.body?.object === 'whatsapp_business_account' ? 'WHATSAPP' : req.body?.object === 'instagram' ? 'INSTAGRAM' : 'WHATSAPP');
    
    // We try to log it background-ish so we don't slow down the response
    void prisma.metaChannelWebhookLog.create({
      data: {
        channel: channel as any,
        direction: 'INBOUND',
        eventType: req.body?.entry?.[0]?.changes?.[0]?.value?.messages ? 'message' : 'other',
        payload: req.body || {},
        headers: req.headers || {},
      }
    }).catch(err => console.error('Error logging webhook:', err));

    const normalized = normalizeWebhookPayload(req.body);
    const filtered = forcedChannel ? normalized.filter((i) => i.channel === forcedChannel) : normalized;
    const processed = await processIncomingBatch(filtered);

    // Update the log with results and salonId if possible
    if (processed.length > 0) {
      const first = processed[0];
      const salonId = (first as any).salonId || null; // This might be hidden since it's a batch, but let's try to get it from results
      
      // Since it's a batch, we'll just log the first successful salonId or null
      const effectiveSalonId = processed.find(p => p.success)?.salonId || processed[0]?.salonId || null;

      void prisma.metaChannelWebhookLog.create({
        data: {
          channel: channel as any,
          direction: 'INBOUND',
          eventType: 'processing_result',
          salonId: effectiveSalonId,
          payload: {
            summary: processed.map(p => ({
              providerMessageId: p.providerMessageId,
              success: p.success,
              result: p.result,
              isEcho: p.isEcho
            }))
          },
          headers: {}
        }
      }).catch(() => {});
    }

    for (const item of processed) {
      if (!item.success || item.isEcho) continue;
      // W6 cutover: bu salon backend-native motorundaysa n8n'e değil in-process
      // agent'a yolla. dispatchAgentInbound 5sn debounce içerdiğinden AWAIT
      // EDİLMEZ (HTTP cevabını bekletmesin) — fire-and-forget, hatayı kendi yutar.
      if (isBackendEngine(item.salonId)) {
        void dispatchAgentInbound(mapToAgentInboundItem(item));
      } else {
        await forwardToN8n(item, item.channel);
      }
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

router.post('/instagram', verifyMetaSignature, async (req, res) => handleInbound(req, res, 'INSTAGRAM'));
// WhatsApp arrives via Chakra BSP — no x-hub-signature-256 because Chakra
// terminates Meta's original HMAC and re-issues the payload. See
// verifyChakraProxiedWebhook for the trust model rationale.
router.post('/whatsapp', verifyChakraProxiedWebhook, async (req, res) => handleInbound(req, res, 'WHATSAPP'));
router.post('/meta', verifyMetaSignature, async (req, res) => handleInbound(req, res));

export default router;
