import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.get('/context', async (req: any, res: any) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ message: 'Token is required' });
  }

  const magicLink = await prisma.magicLink.findUnique({
    where: { token }
  });

  if (!magicLink) {
    return res.status(404).json({ message: 'Magic link not found' });
  }

  if (magicLink.expiresAt < new Date()) {
    return res.status(410).json({ message: 'Magic link has expired' });
  }

  const context = magicLink.context as { salonId?: number; language?: string; lang?: string; customerKey?: string } | null;
  if (!context || typeof context.salonId !== 'number') {
    return res.status(400).json({ message: 'Magic link context must contain salonId' });
  }

  const rawIdentity = magicLink.phone.trim();
  const isIdentity = rawIdentity.startsWith('id:');
  const identityValue = isIdentity ? rawIdentity.slice(3) : rawIdentity;
  const normalizeInstagramKey = (value: string | null | undefined) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) return null;
    if (trimmed.startsWith('customer:')) return null;
    if (trimmed.startsWith('INSTAGRAM:')) return trimmed.slice('INSTAGRAM:'.length);
    return trimmed;
  };
  const originChannel = isIdentity ? 'INSTAGRAM' : 'WHATSAPP';
  const originPhone = isIdentity ? null : identityValue;
  const originInstagramId = isIdentity
    ? normalizeInstagramKey(identityValue)
    : normalizeInstagramKey(context?.customerKey);

  const salonId = context.salonId;
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true }
  });

  if (!salon) {
    return res.status(404).json({ message: 'Salon not found' });
  }

  const phone = isIdentity ? '' : rawIdentity;
  const customerKey = typeof context.customerKey === 'string' ? context.customerKey.trim() : '';

  let customer = null as any;
  if (phone) {
    customer = await prisma.customer.findFirst({
      where: {
        phone,
        salonId
      }
    });
  } else if (customerKey) {
    customer = await prisma.customer.findFirst({
      where: {
        instagram: customerKey,
        salonId
      }
    });
  }

  const isKnownCustomer = !!customer && customer.registrationStatus === 'VERIFIED';

  let appointments: { id: number; startTime: Date; endTime: Date; status: string }[] = [];
  if (customer) {
    const raw = await prisma.appointment.findMany({
      where: {
        customerId: customer.id,
        salonId,
        status: { not: 'CANCELLED' }
      },
      select: { id: true, startTime: true, endTime: true, status: true },
      orderBy: { startTime: 'desc' },
      take: 5
    });
    appointments = raw.map((a) => ({
      id: a.id,
      startTime: a.startTime,
      endTime: a.endTime,
      status: a.status
    }));
  }

  const customerGender = customer?.gender
    ? (customer.gender as 'male' | 'female' | 'other')
    : null;
  const customerLanguage = context?.language || context?.lang || null;
  const resolvedPhone = phone || customer?.phone || '';

  res.status(200).json({
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    customerPhone: resolvedPhone,
    customerGender,
    customerLanguage,
    originChannel,
    originPhone,
    originInstagramId,
    salonId,
    salonName: salon.name,
    isKnownCustomer,
    appointments
  });
});

export default router;
