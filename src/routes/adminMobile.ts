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

const TONE_VALUES = new Set(['friendly', 'professional', 'balanced']);
const ANSWER_LENGTH_VALUES = new Set(['short', 'medium', 'detailed']);
const EMOJI_USAGE_VALUES = new Set(['off', 'low', 'normal']);
const BOOKING_GUIDANCE_VALUES = new Set(['low', 'medium', 'high']);
const HANDOVER_THRESHOLD_VALUES = new Set(['early', 'balanced', 'late']);

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
        faqAnswers,
      },
      create: {
        salonId,
        tone,
        answerLength,
        emojiUsage,
        bookingGuidance,
        handoverThreshold,
        faqAnswers,
      },
      select: {
        tone: true,
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
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
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({ items: services });
  } catch (error) {
    console.error('Admin services list error:', error);
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

  if (!name || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ message: 'name, duration and price are required.' });
  }

  try {
    const service = await prisma.service.create({
      data: {
        salonId,
        name,
        duration: Math.round(duration),
        price,
        category,
        description,
        requiresSpecialist,
      },
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
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
        profileImageUrl: true,
      },
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({ items: staff });
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

  try {
    const staff = await prisma.staff.create({
      data: {
        salonId,
        name,
        title: typeof req.body?.title === 'string' ? req.body.title.trim() : null,
        bio: typeof req.body?.bio === 'string' ? req.body.bio.trim() : null,
        phone: typeof req.body?.phone === 'string' ? req.body.phone.trim() : null,
        profileImageUrl: typeof req.body?.profileImageUrl === 'string' ? req.body.profileImageUrl.trim() : null,
      },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        profileImageUrl: true,
      },
    });

    return res.status(201).json({ item: staff });
  } catch (error) {
    console.error('Admin staff create error:', error);
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
    const campaign = await prisma.campaign.create({
      data: {
        salonId,
        name,
        type,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : null,
        config: req.body?.config ?? null,
        isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
        startsAt: req.body?.startsAt ? new Date(req.body.startsAt) : null,
        endsAt: req.body?.endsAt ? new Date(req.body.endsAt) : null,
      },
    });

    return res.status(201).json({ item: campaign });
  } catch (error) {
    console.error('Admin campaign create error:', error);
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
