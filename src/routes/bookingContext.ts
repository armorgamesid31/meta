import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

router.get('/context', async (req: any, res: any) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ message: 'Token is required' });
  }

  const now = new Date();
  const magicLink = await prisma.magicLink.findUnique({
    where: { token },
    include: {
      identitySession: {
        select: {
          id: true,
          customerId: true,
          canonicalUserId: true,
          conversationKey: true,
        },
      },
    },
  });

  if (!magicLink) {
    return res.status(404).json({ message: 'Magic link not found' });
  }

  if (magicLink.expiresAt < now || magicLink.status === 'EXPIRED' || magicLink.status === 'REVOKED') {
    return res.status(410).json({ message: 'Magic link has expired' });
  }

  const context = asObject(magicLink.context);
  const salonId = Number.isInteger(magicLink.salonId) && magicLink.salonId > 0
    ? magicLink.salonId
    : Number(context.salonId || 0);

  if (!Number.isInteger(salonId) || salonId <= 0) {
    return res.status(400).json({ message: 'Magic link context must contain salonId' });
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true },
  });

  if (!salon) {
    return res.status(404).json({ message: 'Salon not found' });
  }

  const originChannel = magicLink.channel;
  const originPhone = magicLink.subjectType === 'PHONE' ? magicLink.phone : null;
  const originInstagramId = magicLink.subjectType === 'INSTAGRAM_ID' ? magicLink.phone : null;

  let linkedCustomerId = magicLink.usedByCustomerId || magicLink.identitySession?.customerId || null;

  const binding = await prisma.identityBinding.findUnique({
    where: {
      salonId_channel_subjectNormalized: {
        salonId,
        channel: magicLink.channel,
        subjectNormalized: magicLink.subjectNormalized,
      },
    },
    select: { customerId: true },
  });

  if (!linkedCustomerId && binding?.customerId) {
    linkedCustomerId = binding.customerId;
  }

  let customer = linkedCustomerId
    ? await prisma.customer.findFirst({
        where: {
          id: linkedCustomerId,
          salonId,
        },
      })
    : null;

  // Legacy fallback for records created before identity binding rollout.
  if (!customer) {
    if (originPhone) {
      customer = await prisma.customer.findFirst({
        where: {
          salonId,
          phone: originPhone,
        },
      });
    } else if (originInstagramId) {
      customer = await prisma.customer.findFirst({
        where: {
          salonId,
          instagram: originInstagramId,
        },
      });
    }
  }

  const isKnownCustomer = Boolean(customer);

  let appointments: { id: number; startTime: Date; endTime: Date; status: string }[] = [];
  let activePackages: Array<{
    id: number;
    name: string;
    expiresAt: Date | null;
    serviceBalances: Array<{
      serviceId: number;
      initialQuota: number;
      remainingQuota: number;
      serviceName: string | null;
    }>;
  }> = [];

  if (customer) {
    const raw = await prisma.appointment.findMany({
      where: {
        customerId: customer.id,
        salonId,
        status: { not: 'CANCELLED' },
      },
      select: { id: true, startTime: true, endTime: true, status: true },
      orderBy: { startTime: 'desc' },
      take: 5,
    });
    appointments = raw.map((a) => ({
      id: a.id,
      startTime: a.startTime,
      endTime: a.endTime,
      status: a.status,
    }));

    const nowForPackages = new Date();
    await (prisma as any).customerPackage.updateMany({
      where: {
        salonId,
        customerId: customer.id,
        status: 'ACTIVE',
        expiresAt: { lt: nowForPackages },
      },
      data: { status: 'EXPIRED' },
    });

    const packages = await (prisma as any).customerPackage.findMany({
      where: {
        salonId,
        customerId: customer.id,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gte: nowForPackages } }],
      },
      include: {
        serviceBalances: {
          where: { remainingQuota: { gt: 0 } },
          include: {
            service: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });

    activePackages = (packages || [])
      .map((pkg: any) => ({
        id: pkg.id,
        name: pkg.name,
        expiresAt: pkg.expiresAt || null,
        serviceBalances: (pkg.serviceBalances || []).map((balance: any) => ({
          serviceId: balance.serviceId,
          initialQuota: balance.initialQuota,
          remainingQuota: balance.remainingQuota,
          serviceName: balance.service?.name || null,
        })),
      }))
      .filter((pkg: any) => pkg.serviceBalances.length > 0);
  }

  const customerGender = customer?.gender
    ? (customer.gender as 'male' | 'female' | 'other')
    : null;
  const customerLanguage = context.language || context.lang || null;
  const resolvedPhone = customer?.phone || originPhone || '';
  const identityLinked = Boolean(binding?.customerId || magicLink.usedByCustomerId || magicLink.identitySession?.customerId);

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
    identityLinked,
    identitySessionId: magicLink.identitySessionId,
    appointments,
    activePackages,
  });
});

export default router;
