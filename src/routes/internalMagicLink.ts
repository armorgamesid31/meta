import { ChannelType, MagicLinkType } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ensureMagicLink } from '../services/magicLinkService.js';

const router = Router();

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) return true;
  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

function asMagicType(value: unknown): MagicLinkType {
  if (typeof value !== 'string') return 'BOOKING';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'BOOKING' || normalized === 'RESCHEDULE') {
    return normalized as MagicLinkType;
  }
  return 'BOOKING';
}

function asChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') {
    return normalized as ChannelType;
  }
  return null;
}

router.post('/ensure', async (req: any, res: any) => {
  const respond = (ok: boolean) => res.status(200).json(ok);

  if (!isInternalAuthorized(req)) {
    return respond(false);
  }

  const body = req.body || {};
  const salonId = Number(body.salonId);
  const rawCustomerKey = typeof body.customerKey === 'string' ? body.customerKey.trim() : '';
  let customerKey = rawCustomerKey;
  let phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const context = typeof body.context === 'object' && body.context !== null ? body.context : null;
  const explicitChannel = asChannel(body.channel);

  if (rawCustomerKey && rawCustomerKey.startsWith('customer:')) {
    const parsed = Number(rawCustomerKey.slice('customer:'.length));
    if (Number.isInteger(parsed) && parsed > 0) {
      const existing = await prisma.customer.findFirst({
        where: { id: parsed, salonId },
        select: { phone: true, instagram: true },
      });
      if (existing?.phone) {
        phone = existing.phone.trim();
      } else if (existing?.instagram) {
        customerKey = existing.instagram.trim();
      }
    }
  }

  if (!phone && !customerKey && context && typeof (context as any).conversationKey === 'string') {
    const conversationKey = String((context as any).conversationKey || '').trim();
    if (conversationKey.startsWith('INSTAGRAM:')) {
      customerKey = conversationKey;
    } else if (conversationKey.startsWith('WHATSAPP:')) {
      phone = conversationKey.slice('WHATSAPP:'.length);
    }
  }

  if (!Number.isInteger(salonId) || salonId <= 0) {
    return respond(false);
  }

  if (!customerKey && !phone) {
    return respond(false);
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, slug: true },
  });
  if (!salon) {
    return respond(false);
  }

  try {
    await ensureMagicLink({
      salonId,
      type: asMagicType(body.type),
      channel: explicitChannel || asChannel((context as any)?.channel || null),
      phone: phone || null,
      customerKey: customerKey || null,
      context,
      salonSlug: salon?.slug || null,
    });

    return respond(true);
  } catch (error) {
    console.error('Internal magic-link ensure error:', error);
    return respond(false);
  }
});

export default router;
