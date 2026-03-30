import { MagicLinkType } from '@prisma/client';
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

router.post('/ensure', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ ok: false, success: false, message: 'Unauthorized' });
  }

  const body = req.body || {};
  const salonId = Number(body.salonId);
  const rawCustomerKey = typeof body.customerKey === 'string' ? body.customerKey.trim() : '';
  let customerKey = rawCustomerKey;
  let phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const context = typeof body.context === 'object' && body.context !== null ? body.context : null;

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
    return res.status(400).json({ ok: false, success: false, message: 'salonId is required' });
  }

  if (!customerKey && !phone) {
    return res.status(400).json({ ok: false, success: false, message: 'customerKey or phone is required' });
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true },
  });
  if (!salon) {
    return res.status(404).json({ ok: false, success: false, message: 'Salon not found' });
  }

  try {
    const ensured = await ensureMagicLink({
      salonId,
      type: asMagicType(body.type),
      phone: phone || null,
      customerKey: customerKey || null,
      context,
    });

    return res.status(200).json({
      ok: true,
      success: true,
      action: ensured.action,
      magicUrl: ensured.magicUrl,
      token: ensured.token,
      expiresAt: ensured.expiresAt,
    });
  } catch (error) {
    console.error('Internal magic-link ensure error:', error);
    return res.status(200).json({
      ok: false,
      success: false,
      action: 'failed',
    });
  }
});

export default router;
