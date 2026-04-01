import { ChannelType, OutboundMessageSource } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

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

function asSource(value: unknown): OutboundMessageSource | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'AI_AGENT' || normalized === 'HUMAN_APP') return normalized as OutboundMessageSource;
  return null;
}

router.post('/register', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });

  const body = req.body || {};
  const salonId = Number(body.salonId);
  const channel = asChannel(body.channel);
  const source = asSource(body.source);
  const conversationKey = typeof body.conversationKey === 'string' ? body.conversationKey.trim() : '';
  const providerMessageId = typeof body.providerMessageId === 'string' ? body.providerMessageId.trim() : '';

  if (!Number.isInteger(salonId) || salonId <= 0 || !channel || !source || !conversationKey || !providerMessageId) {
    return res.status(400).json({
      message: 'salonId, channel, source, conversationKey, providerMessageId are required',
    });
  }

  const sentAt =
    typeof body.sentAt === 'string' && body.sentAt.trim()
      ? new Date(body.sentAt)
      : new Date();

  if (Number.isNaN(sentAt.getTime())) {
    return res.status(400).json({ message: 'sentAt is invalid' });
  }

  const canonicalUserId = typeof body.canonicalUserId === 'string' ? body.canonicalUserId.trim() : null;
  const customerId = Number.isInteger(Number(body.customerId)) ? Number(body.customerId) : null;
  const externalAccountId = typeof body.externalAccountId === 'string' ? body.externalAccountId.trim() : null;
  const text = typeof body.text === 'string' ? body.text.trim() : null;
  const sourceUserId = Number.isInteger(Number(body.sourceUserId)) ? Number(body.sourceUserId) : null;
  const sourceUserEmail =
    typeof body.sourceUserEmail === 'string' && body.sourceUserEmail.trim()
      ? body.sourceUserEmail.trim()
      : null;

  const item = await prisma.outboundMessageTrace.upsert({
    where: {
      channel_providerMessageId: {
        channel,
        providerMessageId,
      },
    },
    update: {
      salonId,
      source,
      conversationKey,
      externalAccountId: externalAccountId || null,
      canonicalUserId: canonicalUserId || null,
      customerId: customerId || null,
      sourceUserId: sourceUserId || null,
      sourceUserEmail: sourceUserEmail || null,
      text: text || null,
      sentAt,
      updatedAt: new Date(),
    },
    create: {
      salonId,
      channel,
      source,
      conversationKey,
      providerMessageId,
      externalAccountId: externalAccountId || null,
      canonicalUserId: canonicalUserId || null,
      customerId: customerId || null,
      sourceUserId: sourceUserId || null,
      sourceUserEmail: sourceUserEmail || null,
      text: text || null,
      sentAt,
    },
    select: {
      id: true,
      channel: true,
      source: true,
      providerMessageId: true,
    },
  });

  return res.status(200).json({ ok: true, item });
});

export default router;
