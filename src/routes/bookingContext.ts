import { Router } from 'express';
import { prisma } from '../prisma.js';
import { getCampaignTeasersForCustomer } from '../services/campaignPricing.js';
import { BusinessError } from '../lib/errors.js';
import { resolveStaffProfile } from '../services/staffProfileResolver.js';

const router = Router();

// Per-campaign metadata returned alongside the campaigns array. Computed
// from the customer's own state so the booking UI can render
// eligibility-aware cards (hide when not applicable, show progress, etc.)
// without having to duplicate the logic on the client. The shape is a
// map keyed by campaignId; missing entries mean the campaign is shown
// with no extras.
type CampaignMeta = {
  // True when the campaign card should render at all for this customer.
  // Some types (WELCOME_FIRST_VISIT after first visit, BIRTHDAY outside
  // the window, WINBACK when not inactive enough) self-suppress.
  eligible: boolean;
  // Optional one-line condition summary used as the card's subtitle.
  conditionSummary?: string;
  // Type-specific extras — only the keys relevant to the campaign type
  // are populated. The client checks for presence before rendering.
  welcomeUsed?: boolean;
  birthdayWindow?: { daysLeft: number; validityDays: number; openNow: boolean };
  winback?: { daysSinceLastAppt: number; thresholdDays: number; deadline: string | null; daysLeft: number | null };
  offPeak?: { dayNames: string[]; timeStart: string; timeEnd: string };
  multiService?: {
    thresholdCount: number;
    includedNames: string[];
    excludedNames: string[];
    allIncluded: boolean;
  };
  referralStats?: { invitedCount: number; joinedCount: number; walletBalance: number };
  loyalty?: { progress: number; threshold: number; rewardLabel: string; rewardEligibleServiceNames: string[] };
  billThreshold?: { thresholdAmount: number; rewardLabel: string };
};

const TR_DAY_NAMES = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

function formatDayNames(mask: unknown): string[] {
  // dayOfWeekMask: number[] (0-6, 0=Sunday) or [1..7] (1=Monday). Accept both.
  if (!Array.isArray(mask)) return [];
  const idxs = mask
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => (n >= 1 && n <= 7 ? n % 7 : n)) // normalise to 0-6 with 0=Sunday
    .filter((n) => n >= 0 && n <= 6);
  return Array.from(new Set(idxs)).sort().map((i) => TR_DAY_NAMES[i]);
}

function daysFromTodayUntilBirthday(birthDate: Date | null, now: Date): number | null {
  if (!birthDate || !(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisYear = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (thisYear < today) thisYear.setFullYear(now.getFullYear() + 1);
  return Math.round((thisYear.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

async function computeCampaignsMeta(input: {
  salonId: number;
  customer: { id: number; birthDate: Date | null } | null;
  campaigns: Array<{ id: number; type: string; config: any }>;
  appointments: Array<{ id: number; startTime: Date; status: string }>;
  walletByCampaign: Map<number, number>;
  enrolledCampaignIds: Set<number>;
  completedCount: number;
}): Promise<Record<number, CampaignMeta>> {
  const meta: Record<number, CampaignMeta> = {};
  const customer = input.customer;
  const now = new Date();

  // Has the customer ever had a non-cancelled appointment? Reused by
  // WELCOME (suppress after first visit) and WINBACK (need last appt).
  const realAppts = (input.appointments || []).filter(
    (a) => String(a.status || '').toUpperCase() !== 'CANCELLED',
  );
  const hasAnyAppt = realAppts.length > 0;
  const lastApptStart = realAppts.length
    ? realAppts.reduce((max, a) => (new Date(a.startTime) > max ? new Date(a.startTime) : max), new Date(0))
    : null;

  // Resolve every service id mentioned in any campaign config (included /
  // excluded / eligible) once, so we don't query the table per campaign.
  const serviceIdSet = new Set<number>();
  for (const c of input.campaigns) {
    const cfg = (c.config || {}) as Record<string, any>;
    for (const key of ['eligibleServiceIds', 'includedServiceIds', 'excludedServiceIds', 'rewardEligibleServiceIds']) {
      const arr = cfg[key];
      if (Array.isArray(arr)) {
        for (const id of arr) {
          const n = Number(id);
          if (Number.isFinite(n) && n > 0) serviceIdSet.add(n);
        }
      }
    }
  }
  const serviceNames = new Map<number, string>();
  if (serviceIdSet.size > 0) {
    const rows = await prisma.service.findMany({
      where: { id: { in: Array.from(serviceIdSet) }, salonId: input.salonId },
      select: { id: true, name: true },
    });
    for (const row of rows) serviceNames.set(row.id, row.name || '');
  }

  // Pre-fetch referral attribution counts grouped by campaignId. One query
  // per customer (not per campaign) — cheaper and the per-campaign meta
  // just looks up its bucket.
  //
  // The status enum (CampaignAttributionStatus) lives at the Postgres
  // level — passing wrong string labels makes the cast fail and the whole
  // request 500s. Valid values: PENDING / REGISTERED / QUALIFIED /
  // REWARDED / CANCELLED. We treat a referred friend who actually came
  // back (REGISTERED, QUALIFIED, or REWARDED) as "joined"; PENDING /
  // CANCELLED stay invitation-only.
  const referralBuckets = new Map<number, { invited: number; joined: number }>();
  if (customer) {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `
          SELECT "campaignId",
                 COUNT(*) AS "invited",
                 SUM(CASE WHEN "status"::text IN ('REGISTERED', 'QUALIFIED', 'REWARDED') THEN 1 ELSE 0 END) AS "joined"
          FROM "CampaignAttribution"
          WHERE "salonId" = $1 AND "referrerCustomerId" = $2
          GROUP BY "campaignId"
        `,
        input.salonId,
        customer.id,
      );
      for (const r of rows) {
        referralBuckets.set(Number(r.campaignId), {
          invited: Number(r.invited || 0),
          joined: Number(r.joined || 0),
        });
      }
    } catch (err) {
      // Don't fail the whole booking context if attribution counts blow
      // up (e.g. schema drift on the enum). Log and continue with
      // empty buckets so the UI just shows zeros.
      console.warn('[bookingContext] referral attribution stats failed:', err);
    }
  }

  for (const camp of input.campaigns) {
    const cfg = (camp.config || {}) as Record<string, any>;
    const typeKey = String(camp.type || '').toUpperCase();
    const entry: CampaignMeta = { eligible: true };

    if (typeKey === 'WELCOME_FIRST_VISIT') {
      entry.welcomeUsed = hasAnyAppt;
      entry.eligible = !hasAnyAppt;
    } else if (typeKey === 'BIRTHDAY') {
      const validityDays = Math.max(1, Number(cfg.validityDays || 14));
      const daysLeft = daysFromTodayUntilBirthday(customer?.birthDate ?? null, now);
      if (daysLeft === null) {
        // Customer hasn't set a birthday — card hidden, but the client can
        // surface a soft "set your birthday" prompt elsewhere if needed.
        entry.eligible = false;
        entry.birthdayWindow = { daysLeft: 0, validityDays, openNow: false };
      } else {
        // Open the window starting `validityDays` BEFORE the birthday so
        // the customer can book before / on the day.
        const openNow = daysLeft <= validityDays || daysLeft >= 365 - validityDays;
        entry.eligible = openNow;
        entry.birthdayWindow = { daysLeft, validityDays, openNow };
      }
    } else if (typeKey === 'WINBACK') {
      const thresholdDays = Math.max(1, Number(cfg.inactiveDays || 60));
      const validityDays = Math.max(1, Number(cfg.validityDays || 14));
      if (!lastApptStart) {
        entry.eligible = false;
      } else {
        const daysSince = Math.floor((now.getTime() - lastApptStart.getTime()) / (24 * 60 * 60 * 1000));
        const eligible = daysSince >= thresholdDays;
        const deadline = eligible
          ? new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000).toISOString()
          : null;
        entry.eligible = eligible;
        entry.winback = {
          daysSinceLastAppt: daysSince,
          thresholdDays,
          deadline,
          daysLeft: eligible ? validityDays : null,
        };
      }
    } else if (typeKey === 'OFF_PEAK') {
      const dayNames = formatDayNames(cfg.dayOfWeekMask);
      const timeStart = String(cfg.timeStart || '');
      const timeEnd = String(cfg.timeEnd || '');
      entry.offPeak = { dayNames, timeStart, timeEnd };
      entry.conditionSummary = [dayNames.join(' · '), `${timeStart} — ${timeEnd}`]
        .filter(Boolean)
        .join('  ·  ');
    } else if (typeKey === 'MULTI_SERVICE_DISCOUNT') {
      const thresholdCount = Math.max(1, Number(cfg.thresholdServiceCount || 2));
      const included = (Array.isArray(cfg.includedServiceIds) ? cfg.includedServiceIds : [])
        .map((id: any) => serviceNames.get(Number(id)) || '')
        .filter(Boolean);
      const excluded = (Array.isArray(cfg.excludedServiceIds) ? cfg.excludedServiceIds : [])
        .map((id: any) => serviceNames.get(Number(id)) || '')
        .filter(Boolean);
      entry.multiService = {
        thresholdCount,
        includedNames: included,
        excludedNames: excluded,
        allIncluded: included.length === 0,
      };
      entry.conditionSummary = included.length
        ? `Sadece: ${included.slice(0, 3).join(', ')}${included.length > 3 ? ` +${included.length - 3}` : ''}`
        : excluded.length
          ? `Tümü dahil · ${excluded.length} istisna`
          : 'Tüm hizmetlerde geçerli';
    } else if (typeKey === 'REFERRAL') {
      const bucket = referralBuckets.get(camp.id) || { invited: 0, joined: 0 };
      const wallet = input.walletByCampaign.get(camp.id) || 0;
      entry.referralStats = {
        invitedCount: bucket.invited,
        joinedCount: bucket.joined,
        walletBalance: wallet,
      };
    } else if (typeKey === 'LOYALTY') {
      const threshold = Math.max(1, Number(cfg.rewardThreshold || 5));
      const rewardType = String(cfg.rewardType || '').toLowerCase();
      const rewardValue = Number(cfg.rewardValue || 0);
      const freeServiceIds = Array.isArray(cfg.rewardEligibleServiceIds) ? cfg.rewardEligibleServiceIds : [];
      const freeNames = freeServiceIds.map((id: any) => serviceNames.get(Number(id)) || '').filter(Boolean);
      let rewardLabel = '';
      if (rewardType === 'free_service') {
        rewardLabel = freeNames.length ? `${freeNames[0]} hediye` : 'Ücretsiz hizmet';
      } else if (rewardType === 'discount_fixed') {
        rewardLabel = `${rewardValue}₺ indirim`;
      } else if (rewardType === 'discount_percent') {
        rewardLabel = `%${rewardValue} indirim`;
      } else {
        rewardLabel = `${rewardValue}₺ indirim`;
      }
      entry.loyalty = {
        progress: input.completedCount,
        threshold,
        rewardLabel,
        rewardEligibleServiceNames: freeNames,
      };
    } else if (typeKey === 'BILL_THRESHOLD') {
      const thresholdAmount = Math.max(0, Number(cfg.thresholdAmount || 0));
      const rewardType = String(cfg.rewardType || '').toLowerCase();
      const rewardValue = Number(cfg.rewardValue || 0);
      let rewardLabel = '';
      if (rewardType === 'discount_percent') rewardLabel = `%${rewardValue} ekstra indirim`;
      else if (rewardType === 'discount_fixed') rewardLabel = `${rewardValue}₺ ekstra indirim`;
      else if (rewardType === 'free_service') rewardLabel = 'Ücretsiz hizmet';
      else rewardLabel = `${rewardValue}₺ indirim`;
      entry.billThreshold = { thresholdAmount, rewardLabel };
      entry.conditionSummary = `${thresholdAmount}₺ üstü randevuda ${rewardLabel}`;
    }

    meta[camp.id] = entry;
  }

  return meta;
}

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
  // The same token can flip between 200 and 410 within a single browser
  // session (admin extends expiry, customer just logged in via a binding,
  // etc.) so no-store is required — otherwise the browser cache will serve
  // a stale 410 GONE response and the customer lands in "register me"
  // flow even though backend resolution would now return their record.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    throw new BusinessError('VALIDATION_FAILED', 'Token is required', 400);
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
    throw new BusinessError('NOT_FOUND', 'Magic link not found', 404);
  }

  if (magicLink.expiresAt < now || magicLink.status === 'EXPIRED' || magicLink.status === 'REVOKED') {
    throw new BusinessError('GONE', 'Magic link has expired', 410);
  }

  const context = asObject(magicLink.context);
  const salonId = Number.isInteger(magicLink.salonId) && magicLink.salonId > 0
    ? magicLink.salonId
    : Number(context.salonId || 0);

  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new BusinessError('VALIDATION_FAILED', 'Magic link context must contain salonId', 400);
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true },
  });

  if (!salon) {
    throw new BusinessError('NOT_FOUND', 'Salon not found', 404);
  }

  const originChannel = magicLink.channel;
  const originPhone = magicLink.subjectType === 'PHONE' ? magicLink.phone : null;
  const originInstagramId = magicLink.subjectType === 'INSTAGRAM_ID' ? magicLink.phone : null;
  const cachedProfile = await prisma.channelProfileCache.findUnique({
    where: {
      salonId_channel_subjectNormalized: {
        salonId,
        channel: magicLink.channel,
        subjectNormalized: magicLink.subjectNormalized,
      },
    },
    select: { profileName: true },
  });
  const magicContext = asObject(magicLink.context);
  const conversationProfile = typeof magicContext.profileName === 'string' ? magicContext.profileName.trim() : '';
  const originProfileName = cachedProfile?.profileName?.trim() || conversationProfile || null;

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
    customerRating: number | null;
    customerReview: string | null;
    serviceId: number | null;
    serviceName: string | null;
    servicePrice: number | null;
    listPrice: number | null;
    discountTotal: number | null;
    finalPrice: number | null;
    staffName: string | null;
    canUpdate: boolean;
    canCancel: boolean;
    canEvaluate: boolean;
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
  let campaignContext: Awaited<ReturnType<typeof getCampaignTeasersForCustomer>> = {
    active: [],
    wallet: [],
    enrollments: [],
    shareLinks: [],
    completedCount: 0,
  };

  if (customer) {
    let raw: Array<{
      id: number;
      startTime: Date;
      endTime: Date;
      status: string;
      customerRating?: number | null;
      customerReview?: string | null;
      rescheduledFromAppointmentId?: number | null;
      rescheduleBatchId?: string | null;
      listPrice?: number | null;
      discountTotal?: number | null;
      finalPrice?: number | null;
      service?: { id?: number; name: string; price?: number } | null;
      serviceId?: number;
      servicePrice?: number;
      staff?:
        | {
            name: string | null;
            firstName?: string | null;
            lastName?: string | null;
            membership?: { identity?: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null } | null;
          }
        | null;
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
          customerRating: true,
          customerReview: true,
          listPrice: true,
          discountTotal: true,
          finalPrice: true,
          rescheduledFromAppointmentId: true,
          rescheduleBatchId: true,
          service: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
          staff: {
            select: {
              name: true,
              firstName: true,
              lastName: true,
              membership: {
                select: {
                  identity: {
                    select: { firstName: true, lastName: true, displayName: true },
                  },
                },
              },
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
          customerRating: true,
          customerReview: true,
          listPrice: true,
          discountTotal: true,
          finalPrice: true,
          service: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
          staff: {
            select: {
              name: true,
              firstName: true,
              lastName: true,
              membership: {
                select: {
                  identity: {
                    select: { firstName: true, lastName: true, displayName: true },
                  },
                },
              },
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
        customerRating: item.customerRating ?? null,
        customerReview: item.customerReview ?? null,
        serviceId: item.service?.id || null,
        serviceName: item.service?.name || null,
        servicePrice: typeof item.service?.price === 'number' ? item.service.price : null,
        listPrice: typeof item.listPrice === 'number' ? item.listPrice : null,
        discountTotal: typeof item.discountTotal === 'number' ? item.discountTotal : null,
        finalPrice: typeof item.finalPrice === 'number' ? item.finalPrice : null,
        staffName:
          resolveStaffProfile(
            item.staff as any,
            (item.staff as any)?.membership?.identity ?? null,
          ).name || null,
        canUpdate: isFuture && ['BOOKED', 'CONFIRMED'].includes(String(item.status || '').toUpperCase()),
        canCancel: isFuture && ['BOOKED', 'CONFIRMED', 'UPDATED'].includes(String(item.status || '').toUpperCase()),
        canEvaluate: !isFuture && String(item.status || '').toUpperCase() === 'COMPLETED',
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

    campaignContext = await getCampaignTeasersForCustomer({
      salonId,
      customerId: customer.id,
    });
  } else {
    campaignContext = await getCampaignTeasersForCustomer({
      salonId,
      customerId: null,
    });
  }

  const customerGender = customer?.gender
    ? (customer.gender as 'male' | 'female' | 'other')
    : null;
  const customerLanguage = context.language || context.lang || null;
  const resolvedPhone = customer?.phone || originPhone || '';
  const identityLinked = Boolean(binding?.customerId || magicLink.usedByCustomerId || magicLink.identitySession?.customerId);

  // Per-campaign customer-aware metadata. The booking UI uses this to
  // hide cards that don't apply (welcome already used, birthday far
  // away, winback ineligible) and to render type-specific extras
  // without duplicating eligibility logic on the client.
  const walletByCampaign = new Map<number, number>();
  for (const w of campaignContext.wallet) {
    walletByCampaign.set(Number(w.campaignId), Number(w.availableAmount || 0));
  }
  const enrolledCampaignIds = new Set(
    campaignContext.enrollments.map((e) => Number(e.campaignId)),
  );
  const campaignsMeta = await computeCampaignsMeta({
    salonId,
    customer: customer ? { id: customer.id, birthDate: (customer as any).birthDate || null } : null,
    campaigns: campaignContext.active.map((c) => ({ id: c.id, type: c.type, config: c.config })),
    appointments: appointments.map((a) => ({ id: a.id, startTime: a.startTime as any, status: a.status })),
    walletByCampaign,
    enrolledCampaignIds,
    completedCount: campaignContext.completedCount,
  });

  res.status(200).json({
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    customerPhone: resolvedPhone,
    customerGender,
    customerLanguage,
    customerBirthDate: (customer as any)?.birthDate ? new Date((customer as any).birthDate).toISOString() : null,
    originChannel,
    originPhone,
    originDisplayPhone: originPhone,
    originProfileName,
    originInstagramId,
    salonId,
    salonName: salon.name,
    isKnownCustomer,
    identityLinked,
    identitySessionId: magicLink.identitySessionId,
    appointments,
    activePackages,
    campaigns: campaignContext.active,
    campaignsMeta,
    campaignWallet: campaignContext.wallet,
    campaignEnrollments: campaignContext.enrollments,
    campaignShareLinks: campaignContext.shareLinks,
    completedCount: campaignContext.completedCount,
  });
});

export default router;
