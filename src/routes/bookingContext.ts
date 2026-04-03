import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function isRescheduleSchemaMissingError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const target = String((error as any)?.meta?.target || '');
  const message = String((error as any)?.message || '');
  if (code === 'P2022') {
    return /(preferenceMode|preferredStaffId|rescheduledFromAppointmentId|rescheduleBatchId)/i.test(
      `${target} ${message}`,
    );
  }
  return /(column .* does not exist).*(preferenceMode|preferredStaffId|rescheduledFromAppointmentId|rescheduleBatchId)/i.test(
    message,
  );
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

  let appointments: Array<{
    id: number;
    startTime: Date;
    endTime: Date;
    status: string;
    serviceName: string | null;
    staffName: string | null;
    canUpdate: boolean;
    isFuture: boolean;
    groupKey: string;
    rescheduledFromAppointmentId: number | null;
    rescheduleBatchId: string | null;
  }> = [];
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
    let raw: Array<{
      id: number;
      startTime: Date;
      endTime: Date;
      status: string;
      rescheduledFromAppointmentId?: number | null;
      rescheduleBatchId?: string | null;
      service?: { name: string } | null;
      staff?: { name: string } | null;
    }> = [];

    try {
      raw = await prisma.appointment.findMany({
        where: {
          customerId: customer.id,
          salonId,
          status: { not: 'CANCELLED' },
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          rescheduledFromAppointmentId: true,
          rescheduleBatchId: true,
          service: {
            select: {
              name: true,
            },
          },
          staff: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        take: 20,
      });
    } catch (error) {
      if (!isRescheduleSchemaMissingError(error)) {
        throw error;
      }

      // Backward-compatible fallback for databases where reschedule V2 columns are not migrated yet.
      raw = await prisma.appointment.findMany({
        where: {
          customerId: customer.id,
          salonId,
          status: { not: 'CANCELLED' },
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          service: {
            select: {
              name: true,
            },
          },
          staff: {
            select: {
              name: true,
            },
          },
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        take: 20,
      });
    }

    const nowForEligibility = Date.now();
    let groupCursor = 0;
    let currentGroupKey = '';
    let previousEndMs = 0;
    for (const item of raw) {
      const startMs = new Date(item.startTime).getTime();
      const endMs = new Date(item.endTime).getTime();
      const isFuture = startMs > nowForEligibility;
      const gapMs = startMs - previousEndMs;
      if (!currentGroupKey || gapMs > 5 * 60 * 1000 || gapMs < 0) {
        groupCursor += 1;
        currentGroupKey = `${new Date(item.startTime).toISOString().slice(0, 10)}:${groupCursor}`;
      }
      previousEndMs = endMs;

      appointments.push({
        id: item.id,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        serviceName: item.service?.name || null,
        staffName: item.staff?.name || null,
        canUpdate: isFuture && ['BOOKED', 'CONFIRMED'].includes(String(item.status || '').toUpperCase()),
        isFuture,
        groupKey: currentGroupKey,
        rescheduledFromAppointmentId: item.rescheduledFromAppointmentId || null,
        rescheduleBatchId: item.rescheduleBatchId || null,
      });
    }

    appointments.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

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
