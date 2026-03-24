import { ChannelType, InboundMessageStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

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
    const providerMessageId = typeof row.providerMessageId === 'string' ? row.providerMessageId.trim() : '';
    const conversationKey = typeof row.conversationKey === 'string' ? row.conversationKey.trim() : '';
    const externalAccountId = typeof row.externalAccountId === 'string' ? row.externalAccountId.trim() : null;
    const externalBusinessId = typeof row.externalBusinessId === 'string' ? row.externalBusinessId.trim() : null;
    const customerName = typeof row.customerName === 'string' ? row.customerName.trim() : null;
    const messageType = typeof row.messageType === 'string' && row.messageType.trim() ? row.messageType.trim() : 'unknown';
    const text = typeof row.text === 'string' && row.text.trim() ? row.text.trim() : null;
    const rawPayload = (row.raw ?? row.body ?? row) as Prisma.InputJsonValue;

    if (!channel || !providerMessageId || !conversationKey) {
      results.push({ index: i, ok: false, result: 'invalid_payload' });
      continue;
    }

    const salonId = await resolveSalonId(channel, externalAccountId, externalBusinessId);
    if (!salonId) {
      results.push({ index: i, ok: false, result: 'salon_not_found' });
      continue;
    }

    try {
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
          messageType,
          text,
          eventTimestamp: toEventDate(row),
          rawPayload,
          status: InboundMessageStatus.PENDING,
          updatedAt: new Date(),
        },
        create: {
          salonId,
          channel,
          conversationKey,
          providerMessageId,
          externalAccountId: externalAccountId || externalBusinessId || '',
          customerName,
          messageType,
          text,
          eventTimestamp: toEventDate(row),
          rawPayload,
          status: InboundMessageStatus.PENDING,
        },
        select: { id: true },
      });

      results.push({ index: i, ok: true, result: 'upserted', id: item.id });
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
