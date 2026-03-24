import { ChannelType, ConversationAutomationMode } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

const DEFAULT_HUMAN_ACTIVE_MINUTES = Number(process.env.CONVERSATION_HUMAN_ACTIVE_MINUTES || 360);

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

function asMode(value: unknown): ConversationAutomationMode | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === 'AUTO' ||
    normalized === 'HUMAN_PENDING' ||
    normalized === 'HUMAN_ACTIVE' ||
    normalized === 'MANUAL_ALWAYS' ||
    normalized === 'AUTO_RESUME_PENDING'
  ) {
    return normalized as ConversationAutomationMode;
  }
  return null;
}

function computeAiPolicy(mode: ConversationAutomationMode) {
  if (mode === 'AUTO') return { aiAllowed: true, responsePolicy: 'normal' };
  if (mode === 'HUMAN_PENDING') return { aiAllowed: false, responsePolicy: 'pending_wait_with_cancel' };
  if (mode === 'AUTO_RESUME_PENDING') return { aiAllowed: true, responsePolicy: 'resume_then_normal' };
  if (mode === 'MANUAL_ALWAYS') return { aiAllowed: false, responsePolicy: 'manual_notify_only' };
  return { aiAllowed: false, responsePolicy: 'human_active_suppress' };
}

router.post('/evaluate', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });

  const body = req.body || {};
  const salonId = Number(body.salonId);
  const channel = asChannel(body.channel);
  const conversationKey = typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';

  if (!Number.isInteger(salonId) || salonId <= 0 || !channel || !conversationKey) {
    return res.status(400).json({ message: 'salonId, channel, conversationKey are required' });
  }

  const now = new Date();
  const canonicalUserId = typeof body.canonicalUserId === 'string' ? body.canonicalUserId.trim() : null;
  const customerId = Number.isInteger(Number(body.customerId)) ? Number(body.customerId) : null;
  const profileName = typeof body.profileName === 'string' ? body.profileName.trim() : null;

  let state = await prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: { salonId, channel, conversationKey },
    },
    update: {
      ...(canonicalUserId ? { canonicalUserId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(profileName ? { profileName } : {}),
      lastCustomerMessageAt: now,
    },
    create: {
      salonId,
      channel,
      conversationKey,
      canonicalUserId: canonicalUserId || null,
      customerId: customerId || null,
      profileName: profileName || null,
      mode: ConversationAutomationMode.AUTO,
      lastCustomerMessageAt: now,
    },
  });

  // Timeout auto-release for HUMAN_ACTIVE / HUMAN_PENDING unless MANUAL_ALWAYS.
  if (!state.manualAlways) {
    const humanActiveExpired =
      state.mode === ConversationAutomationMode.HUMAN_ACTIVE &&
      state.humanActiveUntil &&
      state.humanActiveUntil.getTime() <= now.getTime();

    const humanPendingExpired =
      state.mode === ConversationAutomationMode.HUMAN_PENDING &&
      state.humanPendingSince &&
      now.getTime() - state.humanPendingSince.getTime() >= DEFAULT_HUMAN_ACTIVE_MINUTES * 60 * 1000;

    if (humanActiveExpired || humanPendingExpired) {
      state = await prisma.conversationState.update({
        where: { id: state.id },
        data: {
          mode: ConversationAutomationMode.AUTO,
          humanPendingSince: null,
          humanActiveUntil: null,
          notes: humanPendingExpired ? 'auto_resumed_pending_timeout' : 'auto_resumed_active_timeout',
        },
      });
    }
  }

  const { aiAllowed, responsePolicy } = computeAiPolicy(state.mode);
  return res.status(200).json({
    ok: true,
    state: {
      id: state.id,
      mode: state.mode,
      manualAlways: state.manualAlways,
      humanPendingSince: state.humanPendingSince,
      humanActiveUntil: state.humanActiveUntil,
      canonicalUserId: state.canonicalUserId,
      customerId: state.customerId,
    },
    aiAllowed,
    responsePolicy,
  });
});

router.post('/set', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });

  const body = req.body || {};
  const salonId = Number(body.salonId);
  const channel = asChannel(body.channel);
  const conversationKey = typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';
  const mode = asMode(body.mode);
  const note = typeof body.note === 'string' ? body.note.trim() : null;
  const requestedMinutes = Number(body.humanActiveMinutes);
  const activeMinutes =
    Number.isFinite(requestedMinutes) && requestedMinutes > 0 ? requestedMinutes : DEFAULT_HUMAN_ACTIVE_MINUTES;

  if (!Number.isInteger(salonId) || salonId <= 0 || !channel || !conversationKey || !mode) {
    return res.status(400).json({ message: 'salonId, channel, conversationKey, mode are required' });
  }

  const now = new Date();
  const nextActiveUntil = new Date(now.getTime() + activeMinutes * 60 * 1000);

  const data: any = {
    mode,
    notes: note,
  };

  if (mode === ConversationAutomationMode.HUMAN_PENDING) {
    data.humanPendingSince = now;
  }
  if (mode === ConversationAutomationMode.HUMAN_ACTIVE) {
    data.humanPendingSince = null;
    data.lastHumanMessageAt = now;
    data.humanActiveUntil = nextActiveUntil;
    data.manualAlways = false;
  }
  if (mode === ConversationAutomationMode.MANUAL_ALWAYS) {
    data.manualAlways = true;
    data.humanPendingSince = null;
    data.humanActiveUntil = null;
  }
  if (mode === ConversationAutomationMode.AUTO || mode === ConversationAutomationMode.AUTO_RESUME_PENDING) {
    data.humanPendingSince = null;
    data.humanActiveUntil = null;
    data.manualAlways = false;
  }

  const state = await prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: { salonId, channel, conversationKey },
    },
    update: data,
    create: {
      salonId,
      channel,
      conversationKey,
      ...data,
    },
  });

  return res.status(200).json({ ok: true, state });
});

router.post('/cancel-pending', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  const body = req.body || {};
  const salonId = Number(body.salonId);
  const channel = asChannel(body.channel);
  const conversationKey = typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';

  if (!Number.isInteger(salonId) || salonId <= 0 || !channel || !conversationKey) {
    return res.status(400).json({ message: 'salonId, channel, conversationKey are required' });
  }

  const state = await prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: { salonId, channel, conversationKey },
    },
    update: {
      mode: ConversationAutomationMode.AUTO,
      humanPendingSince: null,
      notes: 'pending_cancelled_by_customer',
    },
    create: {
      salonId,
      channel,
      conversationKey,
      mode: ConversationAutomationMode.AUTO,
      humanPendingSince: null,
      notes: 'pending_cancelled_by_customer',
    },
  });

  return res.status(200).json({ ok: true, state });
});

router.post('/touch-human', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  const body = req.body || {};
  const salonId = Number(body.salonId);
  const channel = asChannel(body.channel);
  const conversationKey = typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';

  if (!Number.isInteger(salonId) || salonId <= 0 || !channel || !conversationKey) {
    return res.status(400).json({ message: 'salonId, channel, conversationKey are required' });
  }

  const now = new Date();
  const until = new Date(now.getTime() + DEFAULT_HUMAN_ACTIVE_MINUTES * 60 * 1000);
  const state = await prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: { salonId, channel, conversationKey },
    },
    update: {
      mode: ConversationAutomationMode.HUMAN_ACTIVE,
      manualAlways: false,
      humanPendingSince: null,
      lastHumanMessageAt: now,
      humanActiveUntil: until,
    },
    create: {
      salonId,
      channel,
      conversationKey,
      mode: ConversationAutomationMode.HUMAN_ACTIVE,
      manualAlways: false,
      humanPendingSince: null,
      lastHumanMessageAt: now,
      humanActiveUntil: until,
    },
  });

  return res.status(200).json({ ok: true, state });
});

export default router;
