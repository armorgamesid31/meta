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

  const salonId = (magicLink.context as { salonId?: number })?.salonId;
  if (!salonId || typeof salonId !== 'number') {
    return res.status(400).json({ message: 'Invalid magic link context' });
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true }
  });

  if (!salon) {
    return res.status(404).json({ message: 'Salon not found' });
  }

  const customer = await prisma.customer.findFirst({
    where: {
      phone: magicLink.phone,
      salonId
    }
  });

  const isKnownCustomer = !!customer;

  let appointments: { id: number; startTime: Date; endTime: Date; status: string }[] = [];
  if (customer) {
    const raw = await prisma.appointment.findMany({
      where: { customerId: customer.id, salonId },
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

  res.status(200).json({
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    customerPhone: magicLink.phone,
    customerGender,
    salonId,
    salonName: salon.name,
    isKnownCustomer,
    appointments
  });
});

export default router;
