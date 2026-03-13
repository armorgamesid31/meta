import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function asPositiveInt(value: unknown, fallback: number, min = 1, max = 500): number {
  const numeric = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(numeric, min), max);
}

function getSalonId(req: any, res: any): number | null {
  if (!req.user?.salonId) {
    res.status(401).json({ message: 'Unauthorized.' });
    return null;
  }
  return req.user.salonId;
}

function normalizeInstagramUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const username = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return `https://instagram.com/${username}`;
}

type DiscountKind = 'PERCENT' | 'FIXED';

function asDiscountKind(value: unknown): DiscountKind | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PERCENT' || normalized === 'FIXED') {
    return normalized;
  }
  return null;
}

function getAppointmentDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 70) {
    return 'HIGH';
  }
  if (score >= 35) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function buildGeneratedWebsiteCopy(input: { salonName?: string; city?: string | null }) {
  const salonName = (input.salonName || '').trim() || 'Salonunuz';
  const city = (input.city || '').trim() || 'şehrinizde';

  return {
    heroText: `${salonName} ile kendinize zaman ayırın`,
    tagline: `${city} profesyonel güzellik deneyimi`,
    description:
      `${salonName}, uzman ekibiyle saç, cilt ve bakım hizmetlerinde güvenilir sonuçlar sunar. ` +
      'Hijyenik salon ortamı, kaliteli ürünler ve kişiselleştirilmiş dokunuşlarla her ziyareti keyifli bir deneyime dönüştürür.',
  };
}

function parseCampaignDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function toPercentDelta(current: number, previous: number): number {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function sumCompletedRevenue(params: { salonId: number; from: Date; to: Date }) {
  const rows = await prisma.appointment.findMany({
    where: {
      salonId: params.salonId,
      status: 'COMPLETED',
      startTime: {
        gte: params.from,
        lte: params.to,
      },
    },
    select: {
      service: {
        select: {
          price: true,
        },
      },
    },
  });

  return rows.reduce((total, row) => total + (row.service?.price || 0), 0);
}

async function buildCampaignMetrics(campaign: any) {
  const now = new Date();
  const windowStart = campaign.startsAt || campaign.createdAt || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rawWindowEnd = campaign.endsAt && campaign.endsAt < now ? campaign.endsAt : now;
  const windowEnd = rawWindowEnd > windowStart ? rawWindowEnd : now;

  const durationMs = Math.max(windowEnd.getTime() - windowStart.getTime(), 24 * 60 * 60 * 1000);
  const previousStart = new Date(windowStart.getTime() - durationMs);
  const previousEnd = windowStart;

  const [appointmentsCurrent, appointmentsPrevious, completedCurrent, completedPrevious, cancelledCurrent, cancelledPrevious, newCustomersCurrent, newCustomersPrevious, revenueCurrent, revenuePrevious] =
    await Promise.all([
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          startTime: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'COMPLETED',
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'COMPLETED',
          startTime: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'CANCELLED',
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'CANCELLED',
          startTime: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      prisma.customer.count({
        where: {
          salonId: campaign.salonId,
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.customer.count({
        where: {
          salonId: campaign.salonId,
          createdAt: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      sumCompletedRevenue({ salonId: campaign.salonId, from: windowStart, to: windowEnd }),
      sumCompletedRevenue({ salonId: campaign.salonId, from: previousStart, to: previousEnd }),
    ]);

  return {
    window: {
      start: windowStart,
      end: windowEnd,
      previousStart,
      previousEnd,
    },
    current: {
      appointmentCount: appointmentsCurrent,
      completedCount: completedCurrent,
      cancelledCount: cancelledCurrent,
      newCustomerCount: newCustomersCurrent,
      revenueEstimate: Number(revenueCurrent.toFixed(2)),
    },
    previous: {
      appointmentCount: appointmentsPrevious,
      completedCount: completedPrevious,
      cancelledCount: cancelledPrevious,
      newCustomerCount: newCustomersPrevious,
      revenueEstimate: Number(revenuePrevious.toFixed(2)),
    },
    deltas: {
      appointmentPercent: toPercentDelta(appointmentsCurrent, appointmentsPrevious),
      newCustomerPercent: toPercentDelta(newCustomersCurrent, newCustomersPrevious),
      revenuePercent: toPercentDelta(revenueCurrent, revenuePrevious),
    },
  };
}

const TONE_VALUES = new Set(['friendly', 'professional', 'balanced']);
const ANSWER_LENGTH_VALUES = new Set(['short', 'medium', 'detailed']);
const EMOJI_USAGE_VALUES = new Set(['off', 'low', 'normal']);
const BOOKING_GUIDANCE_VALUES = new Set(['low', 'medium', 'high']);
const HANDOVER_THRESHOLD_VALUES = new Set(['early', 'balanced', 'late']);
const AI_DISCLOSURE_VALUES = new Set(['always', 'onQuestion', 'never']);

function asStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const entries = Object.entries(input as Record<string, unknown>);
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      output[key] = value.trim();
    }
  }
  return output;
}

const STAFF_COLOR_PALETTE = [
  '#B76E79',
  '#6C7BA1',
  '#8C6F56',
  '#5B8A72',
  '#7B6D8D',
  '#A86D5D',
  '#5E7F91',
  '#9A7A5C',
] as const;

function paletteColorBySeed(seed: number): string {
  const index = Math.abs(seed) % STAFF_COLOR_PALETTE.length;
  return STAFF_COLOR_PALETTE[index];
}

function randomStaffColor(): string {
  const seed = Date.now() + Math.floor(Math.random() * 1000);
  return paletteColorBySeed(seed);
}

function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

function parseStaffServiceAssignments(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const rows: Array<{ serviceId: number; customPrice: number | null; customDuration: number | null }> = [];
  const seen = new Set<number>();

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const source = raw as Record<string, unknown>;
    const serviceId = Number(source.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0 || seen.has(serviceId)) {
      continue;
    }

    let customPrice: number | null = null;
    if (source.customPrice !== null && source.customPrice !== undefined && source.customPrice !== '') {
      const parsed = Number(source.customPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        continue;
      }
      customPrice = parsed;
    }

    let customDuration: number | null = null;
    if (source.customDuration !== null && source.customDuration !== undefined && source.customDuration !== '') {
      const parsed = Number(source.customDuration);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        continue;
      }
      customDuration = Math.round(parsed);
    }

    rows.push({ serviceId, customPrice, customDuration });
    seen.add(serviceId);
  }

  return rows;
}

function mapStaffForMobile(staff: any) {
  const serviceById = new Map<number, any>();

  for (const row of staff?.StaffService || []) {
    if (!row?.isactive || !row?.Service) {
      continue;
    }

    const existing = serviceById.get(row.serviceId);
    if (!existing || (existing.gender !== 'female' && row.gender === 'female')) {
      const service = row.Service;
      serviceById.set(row.serviceId, {
        serviceId: service.id,
        name: service.name,
        categoryKey: service.ServiceCategory?.categoryRef?.key || service.category || 'OTHER',
        categoryName:
          service.ServiceCategory?.name || service.ServiceCategory?.categoryRef?.defaultName || service.category || 'Diğer',
        defaultPrice: service.price,
        defaultDuration: service.duration,
        customPrice: row.price !== service.price ? row.price : null,
        customDuration: row.duration !== service.duration ? row.duration : null,
        effectivePrice: row.price,
        effectiveDuration: row.duration,
        gender: row.gender,
      });
    }
  }

  const services = Array.from(serviceById.values()).sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return {
    id: staff.id,
    name: staff.name,
    title: staff.title,
    bio: staff.bio,
    phone: staff.phone,
    profileImageUrl: staff.profileImageUrl,
    themeColor: normalizeThemeColor(staff.themeColor) || paletteColorBySeed(staff.id),
    services,
    serviceCount: services.length,
  };
}

router.get('/appointments', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const from = parseIsoDate(req.query.from);
  const to = parseIsoDate(req.query.to);

  if (!from || !to) {
    return res.status(400).json({ message: 'from and to query params are required ISO dates.' });
  }

  if (from >= to) {
    return res.status(400).json({ message: 'from must be earlier than to.' });
  }

  const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
  const staffId = typeof req.query.staffId === 'string' ? Number(req.query.staffId) : null;
  const limit = asPositiveInt(req.query.limit, 250, 1, 500);

  try {
    const where: any = {
      salonId,
      startTime: { lt: to },
      endTime: { gt: from },
    };

    if (statusFilter) {
      where.status = statusFilter;
    }
    if (staffId && staffId > 0) {
      where.staffId = staffId;
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        service: {
          select: {
            id: true,
            name: true,
            duration: true,
            price: true,
            requiresSpecialist: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return res.status(200).json({
      from: from.toISOString(),
      to: to.toISOString(),
      items: appointments,
      count: appointments.length,
    });
  } catch (error) {
    console.error('Admin appointments window query error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/appointments', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const startTime = parseIsoDate(req.body?.startTime);
  const customerIdRaw = req.body?.customerId;
  const customerId =
    customerIdRaw === null || customerIdRaw === undefined || customerIdRaw === ''
      ? null
      : Number(customerIdRaw);
  const explicitCustomerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
  const explicitCustomerPhone = typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
  const gender =
    typeof req.body?.gender === 'string' && ['male', 'female', 'other'].includes(req.body.gender)
      ? req.body.gender
      : 'female';

  const normalizedServices = Array.isArray(req.body?.services) && req.body.services.length > 0
    ? req.body.services
        .map((item: any) => ({
          serviceId: Number(item?.serviceId),
          staffId: item?.staffId === null || item?.staffId === undefined || item?.staffId === '' ? null : Number(item.staffId),
          duration: item?.duration === null || item?.duration === undefined || item?.duration === '' ? null : Number(item.duration),
        }))
        .filter((item: any) => Number.isInteger(item.serviceId) && item.serviceId > 0)
    : null;

  const fallbackServiceId = Number(req.body?.serviceId);
  const fallbackStaffId = Number(req.body?.staffId);
  const servicesToCreate =
    normalizedServices && normalizedServices.length > 0
      ? normalizedServices
      : Number.isInteger(fallbackServiceId) && fallbackServiceId > 0
      ? [{ serviceId: fallbackServiceId, staffId: Number.isInteger(fallbackStaffId) && fallbackStaffId > 0 ? fallbackStaffId : null, duration: null }]
      : [];

  if (!startTime) {
    return res.status(400).json({ message: 'startTime is required as ISO date.' });
  }
  if (!servicesToCreate.length) {
    return res.status(400).json({ message: 'At least one service is required.' });
  }
  if (customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) {
    return res.status(400).json({ message: 'customerId must be a positive integer.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [existingCustomerById, existingCustomerByPhone] = await Promise.all([
        customerId
          ? tx.customer.findFirst({
              where: { id: customerId, salonId },
              select: { id: true, name: true, phone: true, gender: true },
            })
          : Promise.resolve(null),
        !customerId && explicitCustomerPhone
          ? tx.customer.findFirst({
              where: { salonId, phone: explicitCustomerPhone },
              select: { id: true, name: true, phone: true, gender: true },
            })
          : Promise.resolve(null),
      ]);

      if (customerId && !existingCustomerById) {
        return { error: { code: 404, message: 'Customer not found.' } };
      }

      let customer = existingCustomerById || existingCustomerByPhone || null;
      if (!customer) {
        if (!explicitCustomerPhone) {
          return { error: { code: 400, message: 'customerPhone is required when customer is not selected.' } };
        }
        customer = await tx.customer.create({
          data: {
            salonId,
            name: explicitCustomerName || null,
            phone: explicitCustomerPhone,
            gender,
          },
          select: { id: true, name: true, phone: true, gender: true },
        });
      }

      const customerName = (explicitCustomerName || customer.name || '').trim() || 'Misafir Müşteri';
      const customerPhone = (explicitCustomerPhone || customer.phone || '').trim();
      if (!customerPhone) {
        return { error: { code: 400, message: 'customerPhone is required.' } };
      }

      const serviceIds: number[] = Array.from(
        new Set<number>(servicesToCreate.map((item: any) => Number(item.serviceId)).filter((id: number) => Number.isInteger(id) && id > 0)),
      );
      const services = await tx.service.findMany({
        where: { salonId, id: { in: serviceIds } },
        select: { id: true, name: true, duration: true, requiresSpecialist: true },
      });
      const serviceMap = new Map(services.map((service) => [service.id, service]));
      if (services.length !== serviceIds.length) {
        return { error: { code: 404, message: 'One or more services were not found.' } };
      }

      const allStaffServiceRows = await tx.staffService.findMany({
        where: {
          serviceId: { in: serviceIds },
          isactive: true,
          Staff: { salonId },
        },
        select: {
          staffId: true,
          serviceId: true,
          duration: true,
        },
      });
      const staffServiceMap = new Map<string, { duration: number }>();
      const availableStaffByService = new Map<number, number[]>();
      for (const row of allStaffServiceRows) {
        staffServiceMap.set(`${row.serviceId}:${row.staffId}`, { duration: row.duration });
        const list = availableStaffByService.get(row.serviceId) || [];
        if (!list.includes(row.staffId)) {
          list.push(row.staffId);
        }
        availableStaffByService.set(row.serviceId, list);
      }

      const plannedBlocks: Array<{
        serviceId: number;
        staffId: number;
        startTime: Date;
        endTime: Date;
      }> = [];

      let cursor = new Date(startTime);
      for (const block of servicesToCreate) {
        const service = serviceMap.get(block.serviceId)!;
        const candidates = availableStaffByService.get(block.serviceId) || [];

        let selectedStaffId = block.staffId;
        if (selectedStaffId && !candidates.includes(selectedStaffId)) {
          return { error: { code: 400, message: `${service.name} için seçilen uzman uygun değil.` } };
        }

        if (!selectedStaffId) {
          if (service.requiresSpecialist && candidates.length > 1) {
            return { error: { code: 400, message: `${service.name} için uzman seçimi zorunlu.` } };
          }
          if (candidates.length === 0) {
            return { error: { code: 400, message: `${service.name} için uygun aktif uzman bulunamadı.` } };
          }
          selectedStaffId = candidates[0];
        }

        const staffService = staffServiceMap.get(`${block.serviceId}:${selectedStaffId}`);
        const duration = Math.max(1, block.duration || staffService?.duration || service.duration || 30);
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

        const overlap = await tx.appointment.findFirst({
          where: {
            salonId,
            staffId: selectedStaffId,
            status: { in: ['BOOKED'] },
            startTime: { lt: slotEnd },
            endTime: { gt: slotStart },
          },
          select: { id: true, startTime: true, endTime: true },
        });

        if (overlap) {
          return {
            error: {
              code: 409,
              message: `${service.name} için ${slotStart.toISOString()} saatinde uzman müsait değil.`,
              conflict: overlap,
            },
          };
        }

        plannedBlocks.push({
          serviceId: block.serviceId,
          staffId: selectedStaffId,
          startTime: slotStart,
          endTime: slotEnd,
        });
        cursor = new Date(slotEnd);
      }

      const createdAppointments = [];
      for (const block of plannedBlocks) {
        const appointment = await tx.appointment.create({
          data: {
            salonId,
            customerId: customer.id,
            customerName,
            customerPhone,
            serviceId: block.serviceId,
            staffId: block.staffId,
            startTime: block.startTime,
            endTime: block.endTime,
            status: 'BOOKED',
            source: 'ADMIN',
            notes,
            gender: (customer.gender || gender) as any,
          },
          include: {
            service: {
              select: {
                id: true,
                name: true,
                duration: true,
                price: true,
                requiresSpecialist: true,
              },
            },
            staff: {
              select: {
                id: true,
                name: true,
                title: true,
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        });
        createdAppointments.push(appointment);
      }

      return { appointments: createdAppointments };
    });

    if ('error' in result) {
      return res.status(result.error.code).json({
        message: result.error.message,
        ...(result.error.conflict ? { conflict: result.error.conflict } : {}),
      });
    }

    return res.status(201).json({
      item: result.appointments[0],
      items: result.appointments,
      count: result.appointments.length,
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Aynı telefon numarasıyla kayıtlı müşteri zaten var.' });
    }
    console.error('Admin create appointment error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const cursorRaw = typeof req.query.cursor === 'string' ? Number(req.query.cursor) : null;
  const limit = asPositiveInt(req.query.limit, 20, 1, 100);

  if (cursorRaw !== null && (!Number.isInteger(cursorRaw) || cursorRaw <= 0)) {
    return res.status(400).json({ message: 'cursor must be a positive integer.' });
  }

  try {
    const where: any = { salonId };

    if (cursorRaw) {
      where.id = { lt: cursorRaw };
    }

    const rows = await prisma.customer.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        name: true,
        phone: true,
        gender: true,
        birthDate: true,
        acceptMarketing: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1]?.id || '') : null;

    return res.status(200).json({
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        gender: row.gender,
        birthDate: row.birthDate,
        acceptMarketing: row.acceptMarketing,
        appointmentCount: row._count.appointments,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error('Admin customers cursor query error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/customers', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const gender = typeof req.body?.gender === 'string' ? req.body.gender : null;
  const acceptMarketing = Boolean(req.body?.acceptMarketing);

  if (!phone) {
    return res.status(400).json({ message: 'phone is required.' });
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        salonId,
        name: name || null,
        phone,
        gender: gender && ['male', 'female', 'other'].includes(gender) ? (gender as any) : null,
        acceptMarketing,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        gender: true,
        birthDate: true,
        acceptMarketing: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({ customer });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu telefon salon icin zaten kayitli.' });
    }
    console.error('Admin create customer error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  try {
    const [customer, appointments, riskProfile, latestDiscount] = await prisma.$transaction([
      prisma.customer.findFirst({
        where: { id: customerId, salonId },
        select: {
          id: true,
          name: true,
          phone: true,
          gender: true,
          birthDate: true,
          acceptMarketing: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.appointment.findMany({
        where: { salonId, customerId },
        include: {
          service: { select: { id: true, name: true, duration: true, price: true } },
          staff: { select: { id: true, name: true } },
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      prisma.customerRiskProfile.findUnique({
        where: { customerId_salonId: { customerId, salonId } },
        select: {
          riskScore: true,
          noShowCount: true,
          noShows: true,
          totalBookings: true,
          lastCalculatedAt: true,
        },
      }),
      prisma.customerBehaviorLog.findFirst({
        where: { salonId, customerId, action: 'CUSTOMER_DISCOUNT_SET' },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        select: { metadata: true, occurredAt: true, createdAt: true },
      }),
    ]);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const nonCancelled = appointments.filter((item) => item.status !== 'CANCELLED');
    const uniqueDayCount = new Set(nonCancelled.map((item) => getAppointmentDayKey(item.startTime))).size;
    const completedAppointments = appointments.filter((item) => item.status === 'COMPLETED');
    const totalRevenue = completedAppointments.reduce((sum, item) => sum + (item.service?.price || 0), 0);

    const favoriteStaffCounter = new Map<number, { id: number; name: string; count: number }>();
    for (const appointment of nonCancelled) {
      const existing = favoriteStaffCounter.get(appointment.staffId);
      if (existing) {
        existing.count += 1;
      } else {
        favoriteStaffCounter.set(appointment.staffId, {
          id: appointment.staff.id,
          name: appointment.staff.name,
          count: 1,
        });
      }
    }
    const favoriteStaff =
      Array.from(favoriteStaffCounter.values()).sort((a, b) => b.count - a.count || a.id - b.id)[0] || null;

    const noShowCountFromData = appointments.filter((item) => item.status === 'NO_SHOW').length;
    const totalBookingsFromData = nonCancelled.length;
    const noShowRatio = totalBookingsFromData > 0 ? noShowCountFromData / totalBookingsFromData : 0;
    const riskScoreRaw =
      typeof riskProfile?.riskScore === 'number' ? riskProfile.riskScore : Math.min(100, noShowRatio * 100);
    const riskScore = Number(Math.max(0, Math.min(100, riskScoreRaw)).toFixed(1));

    let discount: any = null;
    if (latestDiscount?.metadata && typeof latestDiscount.metadata === 'object' && !Array.isArray(latestDiscount.metadata)) {
      const raw = latestDiscount.metadata as Record<string, any>;
      const kind = asDiscountKind(raw.kind);
      const value = typeof raw.value === 'number' ? raw.value : Number(raw.value);
      if (kind && Number.isFinite(value) && value > 0) {
        discount = {
          kind,
          value,
          note: typeof raw.note === 'string' ? raw.note : null,
          notifyCustomer: Boolean(raw.notifyCustomer),
          messageTemplate: typeof raw.messageTemplate === 'string' ? raw.messageTemplate : null,
          lastNotificationStatus:
            typeof raw.lastNotificationStatus === 'string' ? raw.lastNotificationStatus : null,
          updatedAt: (latestDiscount.occurredAt || latestDiscount.createdAt || new Date()).toISOString(),
        };
      }
    }

    return res.status(200).json({
      customer,
      summary: {
        totalAppointmentDays: uniqueDayCount,
        totalRevenue,
        favoriteStaff,
        noShowRiskScore: riskScore,
        noShowRiskLevel: toRiskLevel(riskScore),
        noShowCount: typeof riskProfile?.noShows === 'number' ? riskProfile.noShows : noShowCountFromData,
        totalBookings:
          typeof riskProfile?.totalBookings === 'number' ? riskProfile.totalBookings : totalBookingsFromData,
      },
      discount,
      appointments: appointments.slice(0, 30),
    });
  } catch (error) {
    console.error('Admin customer detail error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/customers/:id/discount', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const kind = asDiscountKind(req.body?.kind);
  const value = typeof req.body?.value === 'number' ? req.body.value : Number(req.body?.value);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const notifyCustomer = Boolean(req.body?.notifyCustomer);
  const messageTemplate = typeof req.body?.messageTemplate === 'string' ? req.body.messageTemplate.trim() : '';

  if (!kind) {
    return res.status(400).json({ message: 'kind must be PERCENT or FIXED.' });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ message: 'value must be a positive number.' });
  }
  if (kind === 'PERCENT' && value > 100) {
    return res.status(400).json({ message: 'PERCENT discount cannot exceed 100.' });
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, salonId },
      select: { id: true, name: true, phone: true },
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const now = new Date();
    const normalizedMessageTemplate =
      messageTemplate ||
      (kind === 'PERCENT'
        ? `${value}% indirim hakkınız tanımlandı.`
        : `${value} TL indirim hakkınız tanımlandı.`);
    const lastNotificationStatus = notifyCustomer
      ? customer.phone
        ? 'queued'
        : 'skipped_no_phone'
      : 'not_requested';

    await prisma.customerBehaviorLog.create({
      data: {
        salonId,
        customerId,
        action: 'CUSTOMER_DISCOUNT_SET',
        behaviorType: 'DISCOUNT',
        metadata: {
          kind,
          value,
          note: note || null,
          notifyCustomer,
          messageTemplate: normalizedMessageTemplate,
          lastNotificationStatus,
          updatedAt: now.toISOString(),
        },
        occurredAt: now,
      },
    });

    if (notifyCustomer) {
      await prisma.customerBehaviorLog.create({
        data: {
          salonId,
          customerId,
          action: 'CUSTOMER_DISCOUNT_NOTIFICATION',
          behaviorType: 'NOTIFICATION',
          metadata: {
            channel: 'WHATSAPP',
            status: lastNotificationStatus,
            messageTemplate: normalizedMessageTemplate,
          },
          occurredAt: now,
        },
      });
    }

    return res.status(200).json({
      discount: {
        kind,
        value,
        note: note || null,
        notifyCustomer,
        messageTemplate: normalizedMessageTemplate,
        lastNotificationStatus,
        updatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Admin customer discount update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/setup', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const [salon, settings, serviceCount, staffCount] = await prisma.$transaction([
      prisma.salon.findUnique({
        where: { id: salonId },
        select: {
          id: true,
          name: true,
          address: true,
          whatsappPhone: true,
          city: true,
          countryCode: true,
          tagline: true,
          about: true,
          heroImageUrl: true,
          instagramUrl: true,
        },
      }),
      prisma.salonSettings.findUnique({
        where: { salonId },
        select: {
          workStartHour: true,
          workEndHour: true,
          slotInterval: true,
          workingDays: true,
        },
      }),
      prisma.service.count({ where: { salonId } }),
      prisma.staff.count({ where: { salonId } }),
    ]);

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }

    const hasPhone = Boolean((salon.whatsappPhone || '').trim());
    const hasAddress = Boolean((salon.address || '').trim());
    const hasWorkingHours =
      typeof settings?.workStartHour === 'number' && typeof settings?.workEndHour === 'number';
    const hasServices = serviceCount > 0;
    const hasStaff = staffCount > 0;

    return res.status(200).json({
      salon,
      settings,
      checklist: {
        workingHours: hasWorkingHours,
        address: hasAddress,
        phone: hasPhone,
        service: hasServices,
        staff: hasStaff,
        completed: hasWorkingHours && hasAddress && hasPhone && hasServices && hasStaff,
      },
      counts: {
        services: serviceCount,
        staff: staffCount,
      },
    });
  } catch (error) {
    console.error('Admin setup read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/setup', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const payload = req.body || {};

  try {
    const salon = await prisma.salon.update({
      where: { id: salonId },
      data: {
        ...(typeof payload.name === 'string' ? { name: payload.name.trim() } : {}),
        ...(typeof payload.address === 'string' ? { address: payload.address.trim() } : {}),
        ...(typeof payload.whatsappPhone === 'string' ? { whatsappPhone: payload.whatsappPhone.trim() } : {}),
        ...(typeof payload.city === 'string' ? { city: payload.city.trim() } : {}),
        ...(typeof payload.countryCode === 'string' ? { countryCode: payload.countryCode.trim().toUpperCase() } : {}),
        ...(typeof payload.tagline === 'string' ? { tagline: payload.tagline.trim() } : {}),
        ...(typeof payload.about === 'string' ? { about: payload.about.trim() } : {}),
        ...(typeof payload.heroImageUrl === 'string' ? { heroImageUrl: payload.heroImageUrl.trim() } : {}),
        ...(typeof payload.instagramUrl === 'string' ? { instagramUrl: payload.instagramUrl.trim() } : {}),
      },
    });

    const hasSettingsUpdate =
      payload.workStartHour !== undefined ||
      payload.workEndHour !== undefined ||
      payload.slotInterval !== undefined ||
      payload.workingDays !== undefined;

    let settings: any = null;

    if (hasSettingsUpdate) {
      settings = await prisma.salonSettings.upsert({
        where: { salonId },
        update: {
          ...(payload.workStartHour !== undefined ? { workStartHour: Number(payload.workStartHour) } : {}),
          ...(payload.workEndHour !== undefined ? { workEndHour: Number(payload.workEndHour) } : {}),
          ...(payload.slotInterval !== undefined ? { slotInterval: Number(payload.slotInterval) } : {}),
          ...(payload.workingDays !== undefined ? { workingDays: payload.workingDays } : {}),
        },
        create: {
          salonId,
          ...(payload.workStartHour !== undefined ? { workStartHour: Number(payload.workStartHour) } : {}),
          ...(payload.workEndHour !== undefined ? { workEndHour: Number(payload.workEndHour) } : {}),
          ...(payload.slotInterval !== undefined ? { slotInterval: Number(payload.slotInterval) } : {}),
          ...(payload.workingDays !== undefined ? { workingDays: payload.workingDays } : {}),
        },
      });
    }

    return res.status(200).json({ salon, settings });
  } catch (error) {
    console.error('Admin setup update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/whatsapp-agent/settings', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const settings = await prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: {
        tone: true,
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
        aiDisclosure: true,
        faqAnswers: true,
      },
    });

    return res.status(200).json({
      settings: settings || {
        tone: 'balanced',
        answerLength: 'medium',
        emojiUsage: 'low',
        bookingGuidance: 'medium',
        handoverThreshold: 'balanced',
        aiDisclosure: 'onQuestion',
        faqAnswers: {},
      },
    });
  } catch (error) {
    console.error('Admin WhatsApp agent settings read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/whatsapp-agent/settings', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const payload = req.body || {};
  const tone = typeof payload.tone === 'string' && TONE_VALUES.has(payload.tone) ? payload.tone : 'balanced';
  const answerLength = typeof payload.answerLength === 'string' && ANSWER_LENGTH_VALUES.has(payload.answerLength)
    ? payload.answerLength
    : 'medium';
  const emojiUsage = typeof payload.emojiUsage === 'string' && EMOJI_USAGE_VALUES.has(payload.emojiUsage)
    ? payload.emojiUsage
    : 'low';
  const bookingGuidance = typeof payload.bookingGuidance === 'string' && BOOKING_GUIDANCE_VALUES.has(payload.bookingGuidance)
    ? payload.bookingGuidance
    : 'medium';
  const handoverThreshold =
    typeof payload.handoverThreshold === 'string' && HANDOVER_THRESHOLD_VALUES.has(payload.handoverThreshold)
      ? payload.handoverThreshold
      : 'balanced';
  const aiDisclosure =
    typeof payload.aiDisclosure === 'string' && AI_DISCLOSURE_VALUES.has(payload.aiDisclosure)
      ? payload.aiDisclosure
      : 'onQuestion';
  const faqAnswers = asStringMap(payload.faqAnswers);

  try {
    const settings = await prisma.salonAiAgentSettings.upsert({
      where: { salonId },
      update: {
        tone,
        answerLength,
        emojiUsage,
        bookingGuidance,
        handoverThreshold,
        aiDisclosure,
        faqAnswers,
      },
      create: {
        salonId,
        tone,
        answerLength,
        emojiUsage,
        bookingGuidance,
        handoverThreshold,
        aiDisclosure,
        faqAnswers,
      },
      select: {
        tone: true,
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
        aiDisclosure: true,
        faqAnswers: true,
      },
    });

    return res.status(200).json({ settings });
  } catch (error) {
    console.error('Admin WhatsApp agent settings update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/website/content', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const [salon, gallery] = await prisma.$transaction([
      prisma.salon.findUnique({
        where: { id: salonId },
        select: {
          id: true,
          name: true,
          tagline: true,
          about: true,
          heroImageUrl: true,
          instagramUrl: true,
          whatsappPhone: true,
          city: true,
        },
      }),
      prisma.salonGalleryImage.findMany({
        where: { salonId },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          imageUrl: true,
          altText: true,
          displayOrder: true,
        },
      }),
    ]);

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }

    return res.status(200).json({
      salon: {
        name: salon.name,
        tagline: salon.tagline,
        heroText: salon.tagline,
        about: salon.about,
        heroImageUrl: salon.heroImageUrl,
        instagramUrl: salon.instagramUrl,
        whatsappPhone: salon.whatsappPhone,
        city: salon.city,
      },
      gallery,
    });
  } catch (error) {
    console.error('Admin website content read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/website/content', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const payload = req.body || {};
  const gallery = Array.isArray(payload.gallery) ? payload.gallery : null;

  try {
    const updatedSalon = await prisma.salon.update({
      where: { id: salonId },
      data: {
        ...(typeof payload.salonName === 'string' ? { name: payload.salonName.trim() } : {}),
        ...(typeof payload.tagline === 'string' ? { tagline: payload.tagline.trim() } : {}),
        ...(typeof payload.description === 'string' ? { about: payload.description.trim() } : {}),
        ...(typeof payload.heroImageUrl === 'string' ? { heroImageUrl: payload.heroImageUrl.trim() } : {}),
        ...(payload.instagram !== undefined ? { instagramUrl: normalizeInstagramUrl(payload.instagram) } : {}),
        ...(typeof payload.whatsapp === 'string' ? { whatsappPhone: payload.whatsapp.trim() } : {}),
      },
      select: {
        id: true,
        name: true,
        tagline: true,
        about: true,
        heroImageUrl: true,
        instagramUrl: true,
        whatsappPhone: true,
      },
    });

    if (gallery) {
      const sanitizedGallery = gallery
        .map((item: any, index: number) => {
          const imageUrl = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
          if (!imageUrl) {
            return null;
          }
          return {
            salonId,
            imageUrl,
            altText: typeof item?.altText === 'string' ? item.altText.trim() || null : null,
            displayOrder: Number.isInteger(item?.displayOrder) ? Number(item.displayOrder) : index,
          };
        })
        .filter(Boolean) as Array<{
        salonId: number;
        imageUrl: string;
        altText: string | null;
        displayOrder: number;
      }>;

      await prisma.$transaction([
        prisma.salonGalleryImage.deleteMany({ where: { salonId } }),
        ...(sanitizedGallery.length > 0 ? [prisma.salonGalleryImage.createMany({ data: sanitizedGallery })] : []),
      ]);
    }

    const galleryResponse = await prisma.salonGalleryImage.findMany({
      where: { salonId },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        imageUrl: true,
        altText: true,
        displayOrder: true,
      },
    });

    return res.status(200).json({
      salon: {
        ...updatedSalon,
        heroText: updatedSalon.tagline,
      },
      gallery: galleryResponse,
    });
  } catch (error) {
    console.error('Admin website content update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/website/generate', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { name: true, city: true },
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }

    const generated = buildGeneratedWebsiteCopy({
      salonName: typeof req.body?.salonName === 'string' ? req.body.salonName : salon.name,
      city: typeof req.body?.city === 'string' ? req.body.city : salon.city,
    });

    return res.status(200).json({ generated });
  } catch (error) {
    console.error('Admin website copy generate error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/service-categories', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const categories = await prisma.serviceCategory.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        bufferMinutes: true,
        marketingDescription: true,
        categoryId: true,
        categoryRef: {
          select: {
            key: true,
            defaultName: true,
            displayOrder: true,
          },
        },
        _count: {
          select: {
            Service: true,
          },
        },
      },
    });

    const items = categories
      .map((item) => ({
        id: item.id,
        name: item.name,
        key: item.categoryRef?.key || 'OTHER',
        defaultName: item.categoryRef?.defaultName || item.name,
        displayOrder: item.displayOrder,
        effectiveOrder: item.displayOrder ?? item.categoryRef?.displayOrder ?? 999,
        capacity: item.capacity,
        sequentialRequired: item.sequentialRequired,
        bufferMinutes: item.bufferMinutes,
        marketingDescription: item.marketingDescription,
        serviceCount: item._count.Service,
      }))
      .sort((a, b) => a.effectiveOrder - b.effectiveOrder || a.id - b.id);

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin service categories list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/service-categories/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({ message: 'Invalid category id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (req.body?.displayOrder !== undefined) {
    const displayOrder = Number(req.body.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      return res.status(400).json({ message: 'displayOrder must be >= 0.' });
    }
    updates.displayOrder = displayOrder;
  }
  if (req.body?.capacity !== undefined) {
    const capacity = Number(req.body.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return res.status(400).json({ message: 'capacity must be a positive integer.' });
    }
    updates.capacity = capacity;
  }
  if (req.body?.sequentialRequired !== undefined) {
    updates.sequentialRequired = Boolean(req.body.sequentialRequired);
  }
  if (req.body?.bufferMinutes !== undefined) {
    const buffer = Number(req.body.bufferMinutes);
    if (!Number.isInteger(buffer) || buffer < 0) {
      return res.status(400).json({ message: 'bufferMinutes must be >= 0.' });
    }
    updates.bufferMinutes = buffer;
  }
  if (req.body?.marketingDescription !== undefined) {
    updates.marketingDescription =
      typeof req.body.marketingDescription === 'string' ? req.body.marketingDescription.trim() || null : null;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.serviceCategory.findFirst({
      where: { id: categoryId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const item = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: updates,
      select: {
        id: true,
        name: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        bufferMinutes: true,
        marketingDescription: true,
        categoryRef: {
          select: {
            key: true,
            defaultName: true,
          },
        },
      },
    });

    return res.status(200).json({
      item: {
        id: item.id,
        name: item.name,
        displayOrder: item.displayOrder,
        capacity: item.capacity,
        sequentialRequired: item.sequentialRequired,
        bufferMinutes: item.bufferMinutes,
        marketingDescription: item.marketingDescription,
        key: item.categoryRef?.key || 'OTHER',
        defaultName: item.categoryRef?.defaultName || item.name,
      },
    });
  } catch (error) {
    console.error('Admin service category update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-categories/reorder', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map((value: any) => Number(value)) : [];
  if (!orderedIds.length || orderedIds.some((id: number) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ message: 'orderedIds must be a non-empty number array.' });
  }

  try {
    const rows = await prisma.serviceCategory.findMany({
      where: { salonId, id: { in: orderedIds } },
      select: { id: true },
    });
    if (rows.length !== orderedIds.length) {
      return res.status(400).json({ message: 'orderedIds contains invalid categories.' });
    }

    await prisma.$transaction(
      orderedIds.map((id: number, index: number) =>
        prisma.serviceCategory.update({
          where: { id },
          data: { displayOrder: index },
          select: { id: true },
        }),
      ),
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin service category reorder error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/service-groups', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.serviceGroup.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        description: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        preparationMinutes: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });

    return res.status(200).json({
      items: items.map((item) => ({
        ...item,
        serviceCount: item._count.services,
      })),
    });
  } catch (error) {
    console.error('Admin service groups list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-groups', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() || null : null;
  const displayOrder = req.body?.displayOrder === undefined ? null : Number(req.body.displayOrder);
  const capacity = req.body?.capacity === undefined ? 1 : Number(req.body.capacity);
  const sequentialRequired = req.body?.sequentialRequired === undefined ? false : Boolean(req.body.sequentialRequired);
  const preparationMinutes = req.body?.preparationMinutes === undefined ? 0 : Number(req.body.preparationMinutes);

  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 0)) {
    return res.status(400).json({ message: 'displayOrder must be >= 0.' });
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return res.status(400).json({ message: 'capacity must be a positive integer.' });
  }
  if (!Number.isInteger(preparationMinutes) || preparationMinutes < 0) {
    return res.status(400).json({ message: 'preparationMinutes must be >= 0.' });
  }

  try {
    const item = await prisma.serviceGroup.create({
      data: {
        salonId,
        name,
        description,
        displayOrder,
        capacity,
        sequentialRequired,
        preparationMinutes,
      },
      select: {
        id: true,
        name: true,
        description: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        preparationMinutes: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    return res.status(201).json({
      item: {
        ...item,
        serviceCount: item._count.services,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu grup adı zaten kullanılıyor.' });
    }
    console.error('Admin service group create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/service-groups/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ message: 'Invalid group id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (req.body?.description !== undefined) {
    updates.description =
      typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
  }
  if (req.body?.displayOrder !== undefined) {
    const displayOrder = Number(req.body.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      return res.status(400).json({ message: 'displayOrder must be >= 0.' });
    }
    updates.displayOrder = displayOrder;
  }
  if (req.body?.capacity !== undefined) {
    const capacity = Number(req.body.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return res.status(400).json({ message: 'capacity must be a positive integer.' });
    }
    updates.capacity = capacity;
  }
  if (req.body?.sequentialRequired !== undefined) {
    updates.sequentialRequired = Boolean(req.body.sequentialRequired);
  }
  if (req.body?.preparationMinutes !== undefined) {
    const minutes = Number(req.body.preparationMinutes);
    if (!Number.isInteger(minutes) || minutes < 0) {
      return res.status(400).json({ message: 'preparationMinutes must be >= 0.' });
    }
    updates.preparationMinutes = minutes;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.serviceGroup.findFirst({
      where: { id: groupId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Group not found.' });
    }

    const item = await prisma.serviceGroup.update({
      where: { id: groupId },
      data: updates,
      select: {
        id: true,
        name: true,
        description: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        preparationMinutes: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    return res.status(200).json({
      item: {
        ...item,
        serviceCount: item._count.services,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu grup adı zaten kullanılıyor.' });
    }
    console.error('Admin service group update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-groups/reorder', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map((value: any) => Number(value)) : [];
  if (!orderedIds.length || orderedIds.some((id: number) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ message: 'orderedIds must be a non-empty number array.' });
  }

  try {
    const rows = await prisma.serviceGroup.findMany({
      where: { salonId, id: { in: orderedIds } },
      select: { id: true },
    });
    if (rows.length !== orderedIds.length) {
      return res.status(400).json({ message: 'orderedIds contains invalid groups.' });
    }

    await prisma.$transaction(
      orderedIds.map((id: number, index: number) =>
        prisma.serviceGroup.update({
          where: { id },
          data: { displayOrder: index },
          select: { id: true },
        }),
      ),
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin service group reorder error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/services', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const services = await prisma.service.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        categoryId: true,
        capacityOverride: true,
        sequentialOverride: true,
        bufferOverride: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        serviceGroup: {
          select: {
            id: true,
            name: true,
            capacity: true,
            sequentialRequired: true,
            preparationMinutes: true,
          },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({
      items: services.map((item) => ({
        ...item,
        categoryKey: item.ServiceCategory?.categoryRef?.key || item.category || 'OTHER',
        categoryName: item.ServiceCategory?.name || item.ServiceCategory?.categoryRef?.defaultName || item.category || 'Diğer',
        serviceGroupId: item.serviceGroup?.id || null,
        serviceGroupName: item.serviceGroup?.name || null,
      })),
    });
  } catch (error) {
    console.error('Admin services list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/services/:id/staff', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'Invalid service id.' });
  }

  try {
    const staff = await prisma.staffService.findMany({
      where: {
        serviceId,
        isactive: true,
        Staff: { salonId },
      },
      select: {
        staffId: true,
        duration: true,
        price: true,
        Staff: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
      },
      orderBy: {
        Staff: {
          name: 'asc',
        },
      },
    });

    return res.status(200).json({
      items: staff.map((row) => ({
        id: row.Staff.id,
        name: row.Staff.name,
        title: row.Staff.title,
        overrideDuration: row.duration,
        overridePrice: row.price,
      })),
    });
  } catch (error) {
    console.error('Admin service staff list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/services', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const duration = Number(req.body?.duration);
  const price = Number(req.body?.price);
  const category = typeof req.body?.category === 'string' && req.body.category.trim() ? req.body.category.trim() : 'OTHER';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
  const requiresSpecialist = Boolean(req.body?.requiresSpecialist);
  const categoryId =
    req.body?.categoryId === null || req.body?.categoryId === undefined || req.body?.categoryId === ''
      ? null
      : Number(req.body.categoryId);
  const serviceGroupId =
    req.body?.serviceGroupId === null || req.body?.serviceGroupId === undefined || req.body?.serviceGroupId === ''
      ? null
      : Number(req.body.serviceGroupId);
  const capacityOverride =
    req.body?.capacityOverride === null || req.body?.capacityOverride === undefined || req.body?.capacityOverride === ''
      ? null
      : Number(req.body.capacityOverride);
  const sequentialOverride =
    req.body?.sequentialOverride === null || req.body?.sequentialOverride === undefined || req.body?.sequentialOverride === ''
      ? null
      : Boolean(req.body.sequentialOverride);
  const bufferOverride =
    req.body?.bufferOverride === null || req.body?.bufferOverride === undefined || req.body?.bufferOverride === ''
      ? null
      : Number(req.body.bufferOverride);

  if (!name || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ message: 'name, duration and price are required.' });
  }
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return res.status(400).json({ message: 'categoryId must be a positive integer.' });
  }
  if (serviceGroupId !== null && (!Number.isInteger(serviceGroupId) || serviceGroupId <= 0)) {
    return res.status(400).json({ message: 'serviceGroupId must be a positive integer.' });
  }
  if (capacityOverride !== null && (!Number.isInteger(capacityOverride) || capacityOverride <= 0)) {
    return res.status(400).json({ message: 'capacityOverride must be a positive integer.' });
  }
  if (bufferOverride !== null && (!Number.isFinite(bufferOverride) || bufferOverride < 0)) {
    return res.status(400).json({ message: 'bufferOverride must be >= 0.' });
  }

  try {
    if (serviceGroupId !== null) {
      const groupExists = await prisma.serviceGroup.findFirst({
        where: { id: serviceGroupId, salonId },
        select: { id: true },
      });
      if (!groupExists) {
        return res.status(400).json({ message: 'serviceGroupId is not valid for this salon.' });
      }
    }

    const service = await prisma.service.create({
      data: {
        salonId,
        name,
        duration: Math.round(duration),
        price,
        category,
        description,
        requiresSpecialist,
        categoryId,
        serviceGroupId,
        capacityOverride,
        sequentialOverride,
        bufferOverride,
      },
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        categoryId: true,
        serviceGroupId: true,
        capacityOverride: true,
        sequentialOverride: true,
        bufferOverride: true,
      },
    });

    return res.status(201).json({ item: service });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu isimde hizmet zaten mevcut.' });
    }
    console.error('Admin service create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/services/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'Invalid service id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (typeof req.body?.description === 'string') {
    updates.description = req.body.description.trim() || null;
  }
  if (typeof req.body?.category === 'string') {
    updates.category = req.body.category.trim() || 'OTHER';
  }
  if (req.body?.duration !== undefined) {
    const duration = Number(req.body.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ message: 'duration must be a positive number.' });
    }
    updates.duration = Math.round(duration);
  }
  if (req.body?.price !== undefined) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: 'price must be a non-negative number.' });
    }
    updates.price = price;
  }
  if (req.body?.requiresSpecialist !== undefined) {
    updates.requiresSpecialist = Boolean(req.body.requiresSpecialist);
  }
  if (req.body?.categoryId !== undefined) {
    if (req.body.categoryId === null || req.body.categoryId === '') {
      updates.categoryId = null;
    } else {
      const categoryId = Number(req.body.categoryId);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ message: 'categoryId must be a positive integer.' });
      }
      updates.categoryId = categoryId;
    }
  }
  if (req.body?.serviceGroupId !== undefined) {
    if (req.body.serviceGroupId === null || req.body.serviceGroupId === '') {
      updates.serviceGroupId = null;
    } else {
      const serviceGroupId = Number(req.body.serviceGroupId);
      if (!Number.isInteger(serviceGroupId) || serviceGroupId <= 0) {
        return res.status(400).json({ message: 'serviceGroupId must be a positive integer.' });
      }
      updates.serviceGroupId = serviceGroupId;
    }
  }
  if (req.body?.capacityOverride !== undefined) {
    if (req.body.capacityOverride === null || req.body.capacityOverride === '') {
      updates.capacityOverride = null;
    } else {
      const capacity = Number(req.body.capacityOverride);
      if (!Number.isInteger(capacity) || capacity <= 0) {
        return res.status(400).json({ message: 'capacityOverride must be a positive integer.' });
      }
      updates.capacityOverride = capacity;
    }
  }
  if (req.body?.sequentialOverride !== undefined) {
    if (req.body.sequentialOverride === null || req.body.sequentialOverride === '') {
      updates.sequentialOverride = null;
    } else {
      updates.sequentialOverride = Boolean(req.body.sequentialOverride);
    }
  }
  if (req.body?.bufferOverride !== undefined) {
    if (req.body.bufferOverride === null || req.body.bufferOverride === '') {
      updates.bufferOverride = null;
    } else {
      const buffer = Number(req.body.bufferOverride);
      if (!Number.isFinite(buffer) || buffer < 0) {
        return res.status(400).json({ message: 'bufferOverride must be >= 0.' });
      }
      updates.bufferOverride = Math.round(buffer);
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    if (updates.serviceGroupId !== undefined && updates.serviceGroupId !== null) {
      const groupExists = await prisma.serviceGroup.findFirst({
        where: { id: updates.serviceGroupId, salonId },
        select: { id: true },
      });
      if (!groupExists) {
        return res.status(400).json({ message: 'serviceGroupId is not valid for this salon.' });
      }
    }

    const service = await prisma.service.update({
      where: { id: serviceId },
      data: updates,
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        categoryId: true,
        serviceGroupId: true,
        capacityOverride: true,
        sequentialOverride: true,
        bufferOverride: true,
      },
    });

    return res.status(200).json({ item: service });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu isimde hizmet zaten mevcut.' });
    }
    console.error('Admin service update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.delete('/services/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'Invalid service id.' });
  }

  try {
    const exists = await prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    await prisma.service.delete({ where: { id: serviceId } });
    return res.status(204).send();
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Bu hizmet randevularda kullanıldığı için silinemez.' });
    }
    console.error('Admin service delete error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/staff', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const staff = await prisma.staff.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        themeColor: true,
        profileImageUrl: true,
        StaffService: {
          where: {
            Service: { salonId },
          },
          select: {
            id: true,
            serviceId: true,
            price: true,
            duration: true,
            isactive: true,
            gender: true,
            Service: {
              select: {
                id: true,
                name: true,
                category: true,
                price: true,
                duration: true,
                ServiceCategory: {
                  select: {
                    id: true,
                    name: true,
                    categoryRef: {
                      select: {
                        key: true,
                        defaultName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({ items: staff.map(mapStaffForMobile) });
  } catch (error) {
    console.error('Admin staff list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/staff', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  const themeColor =
    req.body?.themeColor === null || req.body?.themeColor === undefined || req.body?.themeColor === ''
      ? null
      : normalizeThemeColor(req.body.themeColor);

  if (req.body?.themeColor !== undefined && req.body?.themeColor !== null && req.body?.themeColor !== '' && !themeColor) {
    return res.status(400).json({ message: 'themeColor must be in #RRGGBB format.' });
  }

  const assignments = parseStaffServiceAssignments(req.body?.serviceAssignments);

  try {
    const createdStaffId = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          salonId,
          name,
          title: typeof req.body?.title === 'string' ? req.body.title.trim() : null,
          bio: typeof req.body?.bio === 'string' ? req.body.bio.trim() : null,
          phone: typeof req.body?.phone === 'string' ? req.body.phone.trim() : null,
          themeColor: themeColor || randomStaffColor(),
          profileImageUrl: typeof req.body?.profileImageUrl === 'string' ? req.body.profileImageUrl.trim() : null,
        },
        select: { id: true },
      });

      if (assignments.length > 0) {
        const serviceIds = assignments.map((item) => item.serviceId);
        const services = await tx.service.findMany({
          where: {
            salonId,
            id: { in: serviceIds },
          },
          select: { id: true, price: true, duration: true },
        });

        if (services.length !== serviceIds.length) {
          throw new Error('INVALID_SERVICE_ASSIGNMENT');
        }

        const serviceMap = new Map(services.map((service) => [service.id, service]));
        await tx.staffService.createMany({
          data: assignments.map((item) => {
            const service = serviceMap.get(item.serviceId)!;
            return {
              staffId: staff.id,
              serviceId: item.serviceId,
              price: item.customPrice ?? service.price,
              duration: item.customDuration ?? service.duration,
              isactive: true,
              gender: 'female',
            };
          }),
        });
      }

      return staff.id;
    });

    const staff = await prisma.staff.findFirst({
      where: { id: createdStaffId, salonId },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        themeColor: true,
        profileImageUrl: true,
        StaffService: {
          where: {
            Service: { salonId },
          },
          select: {
            id: true,
            serviceId: true,
            price: true,
            duration: true,
            isactive: true,
            gender: true,
            Service: {
              select: {
                id: true,
                name: true,
                category: true,
                price: true,
                duration: true,
                ServiceCategory: {
                  select: {
                    id: true,
                    name: true,
                    categoryRef: {
                      select: {
                        key: true,
                        defaultName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return res.status(201).json({ item: mapStaffForMobile(staff) });
  } catch (error) {
    if ((error as Error)?.message === 'INVALID_SERVICE_ASSIGNMENT') {
      return res.status(400).json({ message: 'serviceAssignments içinde geçersiz hizmet var.' });
    }
    console.error('Admin staff create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/staff/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const staffId = Number(req.params.id);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return res.status(400).json({ message: 'Invalid staff id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    const name = req.body.name.trim();
    if (!name) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }
    updates.name = name;
  }
  if (req.body?.title !== undefined) {
    updates.title = typeof req.body.title === 'string' ? req.body.title.trim() || null : null;
  }
  if (req.body?.bio !== undefined) {
    updates.bio = typeof req.body.bio === 'string' ? req.body.bio.trim() || null : null;
  }
  if (req.body?.phone !== undefined) {
    updates.phone = typeof req.body.phone === 'string' ? req.body.phone.trim() || null : null;
  }
  if (req.body?.profileImageUrl !== undefined) {
    updates.profileImageUrl = typeof req.body.profileImageUrl === 'string' ? req.body.profileImageUrl.trim() || null : null;
  }
  if (req.body?.themeColor !== undefined) {
    if (req.body.themeColor === null || req.body.themeColor === '') {
      updates.themeColor = null;
    } else {
      const themeColor = normalizeThemeColor(req.body.themeColor);
      if (!themeColor) {
        return res.status(400).json({ message: 'themeColor must be in #RRGGBB format.' });
      }
      updates.themeColor = themeColor;
    }
  }

  const hasAssignments = req.body?.serviceAssignments !== undefined;
  const assignments = hasAssignments ? parseStaffServiceAssignments(req.body?.serviceAssignments) : [];

  if (!Object.keys(updates).length && !hasAssignments) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.staff.findFirst({
        where: { id: staffId, salonId },
        select: { id: true },
      });
      if (!existing) {
        throw new Error('STAFF_NOT_FOUND');
      }

      if (Object.keys(updates).length > 0) {
        await tx.staff.update({
          where: { id: staffId },
          data: updates,
        });
      }

      if (hasAssignments) {
        const serviceIds = assignments.map((item) => item.serviceId);
        if (serviceIds.length > 0) {
          const services = await tx.service.findMany({
            where: {
              salonId,
              id: { in: serviceIds },
            },
            select: { id: true, price: true, duration: true },
          });
          if (services.length !== serviceIds.length) {
            throw new Error('INVALID_SERVICE_ASSIGNMENT');
          }

          const serviceMap = new Map(services.map((service) => [service.id, service]));
          await tx.staffService.deleteMany({
            where: { staffId },
          });

          await tx.staffService.createMany({
            data: assignments.map((item) => {
              const service = serviceMap.get(item.serviceId)!;
              return {
                staffId,
                serviceId: item.serviceId,
                price: item.customPrice ?? service.price,
                duration: item.customDuration ?? service.duration,
                isactive: true,
                gender: 'female',
              };
            }),
          });
        } else {
          await tx.staffService.deleteMany({
            where: { staffId },
          });
        }
      }
    });

    const staff = await prisma.staff.findFirst({
      where: { id: staffId, salonId },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        themeColor: true,
        profileImageUrl: true,
        StaffService: {
          where: {
            Service: { salonId },
          },
          select: {
            id: true,
            serviceId: true,
            price: true,
            duration: true,
            isactive: true,
            gender: true,
            Service: {
              select: {
                id: true,
                name: true,
                category: true,
                price: true,
                duration: true,
                ServiceCategory: {
                  select: {
                    id: true,
                    name: true,
                    categoryRef: {
                      select: {
                        key: true,
                        defaultName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return res.status(200).json({ item: mapStaffForMobile(staff) });
  } catch (error) {
    if ((error as Error)?.message === 'STAFF_NOT_FOUND') {
      return res.status(404).json({ message: 'Staff not found.' });
    }
    if ((error as Error)?.message === 'INVALID_SERVICE_ASSIGNMENT') {
      return res.status(400).json({ message: 'serviceAssignments içinde geçersiz hizmet var.' });
    }
    console.error('Admin staff update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.delete('/staff/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const staffId = Number(req.params.id);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return res.status(400).json({ message: 'Invalid staff id.' });
  }

  try {
    const existing = await prisma.staff.findFirst({
      where: { id: staffId, salonId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Staff not found.' });
    }

    await prisma.staff.delete({
      where: { id: staffId },
    });

    return res.status(204).send();
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Bu çalışan randevularda kullanıldığı için silinemez.' });
    }
    console.error('Admin staff delete error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/inventory/items', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.inventoryItem.findMany({
      where: { salonId, isActive: true },
      orderBy: [{ currentStock: 'asc' }, { id: 'desc' }],
    });

    return res.status(200).json({
      items: items.map((item) => ({
        ...item,
        lowStock: item.currentStock <= item.minStock,
      })),
    });
  } catch (error) {
    console.error('Admin inventory list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/inventory/items', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        salonId,
        name,
        category: typeof req.body?.category === 'string' ? req.body.category.trim() : null,
        unit: typeof req.body?.unit === 'string' && req.body.unit.trim() ? req.body.unit.trim() : 'adet',
        currentStock: Math.max(0, Number(req.body?.currentStock) || 0),
        minStock: Math.max(0, Number(req.body?.minStock) || 0),
        price: req.body?.price !== undefined ? Number(req.body.price) : null,
        supplier: typeof req.body?.supplier === 'string' ? req.body.supplier.trim() : null,
      },
    });

    return res.status(201).json({ item });
  } catch (error) {
    console.error('Admin inventory create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/inventory/items/:id/adjust', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const itemId = Number(req.params.id);
  const quantity = Math.abs(Number(req.body?.quantity));
  const type = String(req.body?.type || 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;

  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'Invalid item id or quantity.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, salonId, isActive: true } });
      if (!item) {
        throw new Error('ITEM_NOT_FOUND');
      }

      const nextStock = type === 'OUT' ? item.currentStock - quantity : item.currentStock + quantity;
      if (nextStock < 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      const updatedItem = await tx.inventoryItem.update({
        where: { id: item.id },
        data: { currentStock: nextStock },
      });

      await tx.inventoryMovement.create({
        data: {
          salonId,
          inventoryItemId: item.id,
          type,
          quantity,
          reason,
          createdByUserId: req.user.userId,
        },
      });

      return updatedItem;
    });

    return res.status(200).json({ item: result });
  } catch (error: any) {
    if (error?.message === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ message: 'Inventory item not found.' });
    }
    if (error?.message === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({ message: 'Insufficient stock.' });
    }
    console.error('Admin inventory adjust error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/inventory/movements', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const itemId = typeof req.query.itemId === 'string' ? Number(req.query.itemId) : null;
  const limit = asPositiveInt(req.query.limit, 50, 1, 200);

  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        salonId,
        ...(itemId && itemId > 0 ? { inventoryItemId: itemId } : {}),
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return res.status(200).json({ items: movements });
  } catch (error) {
    console.error('Admin inventory movements error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/campaigns', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { salonId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return res.status(200).json({ items: campaigns });
  } catch (error) {
    console.error('Admin campaigns list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/campaigns', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';

  if (!name || !type) {
    return res.status(400).json({ message: 'name and type are required.' });
  }

  try {
    const startsAt = parseCampaignDateInput(req.body?.startsAt);
    const endsAt = parseCampaignDateInput(req.body?.endsAt);
    if (startsAt === undefined || endsAt === undefined) {
      return res.status(400).json({ message: 'Invalid startsAt or endsAt date.' });
    }

    const campaign = await prisma.campaign.create({
      data: {
        salonId,
        name,
        type,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : null,
        config: req.body?.config ?? null,
        isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
        startsAt,
        endsAt,
      },
    });

    return res.status(201).json({ item: campaign });
  } catch (error) {
    console.error('Admin campaign create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/campaigns/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        salonId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const metrics = await buildCampaignMetrics(campaign);

    return res.status(200).json({
      item: campaign,
      metrics,
    });
  } catch (error) {
    console.error('Admin campaign detail error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/campaigns/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  const data: any = {};
  if (typeof req.body?.name === 'string') {
    const trimmed = req.body.name.trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }
    data.name = trimmed;
  }
  if (typeof req.body?.type === 'string') {
    const trimmed = req.body.type.trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'type cannot be empty.' });
    }
    data.type = trimmed;
  }
  if (req.body?.description !== undefined) {
    data.description =
      typeof req.body.description === 'string' && req.body.description.trim()
        ? req.body.description.trim()
        : null;
  }
  if (req.body?.config !== undefined) {
    data.config = req.body.config ?? null;
  }
  if (req.body?.isActive !== undefined) {
    data.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.startsAt !== undefined) {
    const startsAt = parseCampaignDateInput(req.body.startsAt);
    if (startsAt === undefined) {
      return res.status(400).json({ message: 'Invalid startsAt date.' });
    }
    data.startsAt = startsAt;
  }
  if (req.body?.endsAt !== undefined) {
    const endsAt = parseCampaignDateInput(req.body.endsAt);
    if (endsAt === undefined) {
      return res.status(400).json({ message: 'Invalid endsAt date.' });
    }
    data.endsAt = endsAt;
  }

  try {
    const existing = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        salonId,
      },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data,
    });

    return res.status(200).json({ item: campaign });
  } catch (error) {
    console.error('Admin campaign update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.delete('/campaigns/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  try {
    const existing = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        salonId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    await prisma.campaign.delete({
      where: { id: campaignId },
    });

    return res.status(204).send();
  } catch (error) {
    console.error('Admin campaign delete error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/automations', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.automationRule.findMany({
      where: { salonId },
      orderBy: [{ isEnabled: 'desc' }, { updatedAt: 'desc' }],
    });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin automations list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/automations', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!key || !name) {
    return res.status(400).json({ message: 'key and name are required.' });
  }

  try {
    const item = await prisma.automationRule.create({
      data: {
        salonId,
        key,
        name,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : null,
        config: req.body?.config ?? null,
        isEnabled: Boolean(req.body?.isEnabled),
      },
    });

    return res.status(201).json({ item });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu otomasyon anahtari zaten tanimli.' });
    }
    console.error('Admin automation create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/automations/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id.' });
  }

  try {
    const current = await prisma.automationRule.findFirst({ where: { id, salonId } });
    if (!current) {
      return res.status(404).json({ message: 'Automation not found.' });
    }

    const item = await prisma.automationRule.update({
      where: { id },
      data: {
        ...(req.body?.name !== undefined ? { name: String(req.body.name).trim() } : {}),
        ...(req.body?.description !== undefined ? { description: req.body.description ? String(req.body.description).trim() : null } : {}),
        ...(req.body?.config !== undefined ? { config: req.body.config } : {}),
        ...(req.body?.isEnabled !== undefined ? { isEnabled: Boolean(req.body.isEnabled) } : {}),
      },
    });

    return res.status(200).json({ item });
  } catch (error) {
    console.error('Admin automation update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/analytics/overview', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const from = parseIsoDate(req.query.from) || defaultFrom;
  const to = parseIsoDate(req.query.to) || now;

  if (from >= to) {
    return res.status(400).json({ message: 'from must be earlier than to.' });
  }

  try {
    const [appointments, totalCustomers, newCustomers] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          salonId,
          startTime: { gte: from, lte: to },
        },
        select: {
          id: true,
          status: true,
          serviceId: true,
          service: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
        },
      }),
      prisma.customer.count({ where: { salonId } }),
      prisma.customer.count({ where: { salonId, createdAt: { gte: from, lte: to } } }),
    ]);

    let revenue = 0;
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;

    const serviceStats = new Map<number, { id: number; name: string; appointments: number; revenue: number }>();

    for (const apt of appointments) {
      if (apt.status === 'COMPLETED') {
        completed += 1;
        revenue += apt.service.price;
      } else if (apt.status === 'CANCELLED') {
        cancelled += 1;
      } else if (apt.status === 'NO_SHOW') {
        noShow += 1;
      }

      const existing = serviceStats.get(apt.service.id) || {
        id: apt.service.id,
        name: apt.service.name,
        appointments: 0,
        revenue: 0,
      };
      existing.appointments += 1;
      if (apt.status === 'COMPLETED') {
        existing.revenue += apt.service.price;
      }
      serviceStats.set(apt.service.id, existing);
    }

    const topServices = Array.from(serviceStats.values())
      .sort((a, b) => b.appointments - a.appointments)
      .slice(0, 5);

    return res.status(200).json({
      from: from.toISOString(),
      to: to.toISOString(),
      metrics: {
        totalAppointments: appointments.length,
        completedAppointments: completed,
        cancelledAppointments: cancelled,
        noShowAppointments: noShow,
        totalCustomers,
        newCustomers,
        revenue,
      },
      topServices,
    });
  } catch (error) {
    console.error('Admin analytics overview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/analytics/presets', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.analyticsPreset.findMany({
      where: { salonId },
      orderBy: { updatedAt: 'desc' },
    });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin analytics preset list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/analytics/presets', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }

  try {
    const item = await prisma.analyticsPreset.create({
      data: {
        salonId,
        name,
        filters: req.body?.filters ?? null,
      },
    });

    return res.status(201).json({ item });
  } catch (error) {
    console.error('Admin analytics preset create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/blacklist', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.blacklistEntry.findMany({
      where: { salonId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin blacklist list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/blacklist', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : null;
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
  const customerId = req.body?.customerId ? Number(req.body.customerId) : null;

  if (!phone && !customerId) {
    return res.status(400).json({ message: 'phone or customerId is required.' });
  }

  try {
    const item = await prisma.blacklistEntry.create({
      data: {
        salonId,
        phone,
        fullName,
        reason,
        customerId: customerId && customerId > 0 ? customerId : null,
        createdById: req.user.userId,
        isActive: true,
      },
    });

    return res.status(201).json({ item });
  } catch (error) {
    console.error('Admin blacklist create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/blacklist/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id.' });
  }

  try {
    const current = await prisma.blacklistEntry.findFirst({ where: { id, salonId } });
    if (!current) {
      return res.status(404).json({ message: 'Blacklist entry not found.' });
    }

    const item = await prisma.blacklistEntry.update({
      where: { id },
      data: {
        ...(req.body?.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
        ...(req.body?.reason !== undefined ? { reason: req.body.reason ? String(req.body.reason).trim() : null } : {}),
      },
    });

    return res.status(200).json({ item });
  } catch (error) {
    console.error('Admin blacklist update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
