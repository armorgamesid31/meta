import { CampaignType } from '@prisma/client';
import { prisma } from '../prisma.js';

type DiscountKind = 'PERCENT' | 'FIXED';

type CampaignRow = {
  id: number;
  salonId: number;
  name: string;
  type: CampaignType;
  config: Record<string, any>;
  priority: number;
  maxGlobalUsage: number | null;
  maxPerCustomer: number | null;
};

export type CampaignPricingLineInput = {
  serviceId: number;
  listPrice: number;
  isPackageCovered?: boolean;
};

export type CampaignPricingInput = {
  salonId: number;
  customerId?: number | null;
  startTime: Date;
  lines: CampaignPricingLineInput[];
};

export type AppliedCampaignDetail = {
  campaignId: number;
  campaignType: CampaignType;
  campaignName: string;
  amount: number;
};

export type SkippedCampaignDetail = {
  campaignId: number;
  campaignType: CampaignType;
  campaignName: string;
  reasonCode:
    | 'GLOBAL_LIMIT_REACHED'
    | 'CUSTOMER_LIMIT_REACHED'
    | 'MULTI_SERVICE_NOT_ELIGIBLE'
    | 'BIRTHDAY_NOT_ELIGIBLE'
    | 'WINBACK_NOT_ELIGIBLE'
    | 'FIRST_VISIT_NOT_ELIGIBLE'
    | 'OFF_PEAK_NOT_ELIGIBLE'
    | 'WALLET_EMPTY'
    | 'SERVICE_NOT_ELIGIBLE'
    | 'INVALID_DISCOUNT_CONFIG';
};

export type CampaignPricingLineResult = {
  serviceId: number;
  listPrice: number;
  discountTotal: number;
  finalPrice: number;
  appliedCampaigns: AppliedCampaignDetail[];
  skippedCampaigns: SkippedCampaignDetail[];
  packageCovered: boolean;
};

export type CampaignPricingResult = {
  currency: 'TRY';
  subtotal: number;
  discountTotal: number;
  finalTotal: number;
  lines: CampaignPricingLineResult[];
  appliedCampaigns: AppliedCampaignDetail[];
  evaluationMeta: {
    snapshotVersion: number;
    skippedReasons: Array<{ reasonCode: SkippedCampaignDetail['reasonCode']; count: number }>;
  };
};

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function parseDiscountKind(config: Record<string, any>): DiscountKind {
  const raw = String(config.discountType || config.rewardType || config.offerType || '').trim().toLowerCase();
  if (raw.includes('percent')) return 'PERCENT';
  return 'FIXED';
}

function parseDiscountValue(config: Record<string, any>): number {
  const raw = Number(config.discountValue ?? config.rewardValue ?? config.offerValue ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

function discountTypeOrder(kind: DiscountKind): number {
  return kind === 'PERCENT' ? 0 : 1;
}

function getInTimezoneWeekdayKey(date: Date, timezone = 'Europe/Istanbul'): string {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const map: Record<string, string> = {
    Mon: 'MON',
    Tue: 'TUE',
    Wed: 'WED',
    Thu: 'THU',
    Fri: 'FRI',
    Sat: 'SAT',
    Sun: 'SUN',
  };
  return map[short] || 'MON';
}

function getInTimezoneMinuteOfDay(date: Date, timezone = 'Europe/Istanbul'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value || '0');
  return h * 60 + m;
}

function toMinute(value: unknown): number | null {
  const raw = String(value || '').trim();
  const [h, m] = raw.split(':').map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function toServiceIdSet(value: unknown): Set<number> | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return null;

  const ids = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  if (ids.length !== value.length) return null;
  return new Set(ids);
}

function isServiceEligibleByScope(config: Record<string, any>, serviceId: number): boolean {
  const excluded = toServiceIdSet(config.excludedServiceIds);
  if (excluded?.has(serviceId)) {
    return false;
  }

  const eligible = toServiceIdSet(config.eligibleServiceIds);
  if (eligible && eligible.size > 0) {
    return eligible.has(serviceId);
  }

  return true;
}

function normalizeUsageLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function normalizeCampaignRow(row: any): CampaignRow {
  return {
    id: Number(row.id),
    salonId: Number(row.salonId),
    name: String(row.name || row.type || `Campaign ${row.id}`),
    type: String(row.type || '').trim().toUpperCase() as CampaignType,
    config: asObject(row.config),
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
    maxGlobalUsage: normalizeUsageLimit(row.maxGlobalUsage),
    maxPerCustomer: normalizeUsageLimit(row.maxPerCustomer),
  };
}

async function getSalonTimezone(salonId: number): Promise<string> {
  const row = await prisma.salonSettings.findUnique({ where: { salonId }, select: { timezone: true } });
  return row?.timezone || 'Europe/Istanbul';
}

async function getActiveCampaigns(salonId: number, now: Date): Promise<CampaignRow[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT
        c."id", c."salonId", c."name", c."type", c."config", c."priority", c."maxGlobalUsage", c."maxPerCustomer"
      FROM "Campaign" c
      WHERE c."salonId" = $1
        AND c."isActive" = true
        AND (c."startsAt" IS NULL OR c."startsAt" <= $2)
        AND (c."endsAt" IS NULL OR c."endsAt" >= $2)
      ORDER BY c."priority" ASC, c."id" ASC
    `,
    salonId,
    now,
  );
  return rows.map(normalizeCampaignRow);
}

async function getUsageMap(salonId: number, customerId: number | null | undefined): Promise<{
  global: Map<number, number>;
  perCustomer: Map<number, number>;
}> {
  const globalRows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "campaignId", COUNT(*)::int AS "count"
      FROM "AppointmentCampaignApplication"
      WHERE "salonId" = $1 AND "status" = 'APPLIED'::"CampaignApplicationStatus"
      GROUP BY "campaignId"
    `,
    salonId,
  );

  const global = new Map<number, number>();
  for (const row of globalRows) {
    global.set(Number(row.campaignId), Number(row.count || 0));
  }

  const perCustomer = new Map<number, number>();
  if (customerId) {
    const customerRows = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "campaignId", COUNT(*)::int AS "count"
        FROM "AppointmentCampaignApplication"
        WHERE "salonId" = $1 AND "customerId" = $2 AND "status" = 'APPLIED'::"CampaignApplicationStatus"
        GROUP BY "campaignId"
      `,
      salonId,
      customerId,
    );
    for (const row of customerRows) {
      perCustomer.set(Number(row.campaignId), Number(row.count || 0));
    }
  }

  return { global, perCustomer };
}

async function getCustomerStats(salonId: number, customerId: number | null | undefined): Promise<{
  completedCount: number;
  lastAppointmentAt: Date | null;
  birthDate: Date | null;
}> {
  if (!customerId) {
    return { completedCount: 0, lastAppointmentAt: null, birthDate: null };
  }

  const [completedCount, lastAppointment, customer] = await Promise.all([
    prisma.appointment.count({ where: { salonId, customerId, status: 'COMPLETED' } }),
    prisma.appointment.findFirst({
      where: { salonId, customerId },
      orderBy: [{ endTime: 'desc' }],
      select: { endTime: true },
    }),
    prisma.customer.findUnique({ where: { id: customerId }, select: { birthDate: true } }),
  ]);

  return {
    completedCount,
    lastAppointmentAt: lastAppointment?.endTime || null,
    birthDate: customer?.birthDate || null,
  };
}

async function getWalletBalanceMap(salonId: number, customerId: number | null | undefined): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!customerId) return out;

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "campaignId", GREATEST("balanceAmount" - "consumedAmount", 0) AS "available"
      FROM "CustomerCampaignWallet"
      WHERE "salonId" = $1 AND "customerId" = $2
    `,
    salonId,
    customerId,
  );

  for (const row of rows) {
    out.set(Number(row.campaignId), Number(row.available || 0));
  }
  return out;
}

function computeDiscount(base: number, kind: DiscountKind, value: number): number {
  if (base <= 0 || value <= 0) return 0;
  if (kind === 'PERCENT') {
    return Math.min(base, (base * value) / 100);
  }
  return Math.min(base, value);
}

function aggregateApplied(applied: AppliedCampaignDetail[]): AppliedCampaignDetail[] {
  const byId = new Map<number, AppliedCampaignDetail>();
  for (const item of applied) {
    const existing = byId.get(item.campaignId);
    if (!existing) {
      byId.set(item.campaignId, { ...item });
      continue;
    }
    existing.amount += item.amount;
  }
  return Array.from(byId.values()).sort((a, b) => b.amount - a.amount);
}

function isBirthdayEligible(birthDate: Date | null, startTime: Date, validDaysAfterBirthday: number): boolean {
  if (!birthDate) return false;
  const bMonth = birthDate.getUTCMonth();
  const bDay = birthDate.getUTCDate();
  const year = startTime.getUTCFullYear();
  const birthdayThisYear = new Date(Date.UTC(year, bMonth, bDay, 0, 0, 0));
  const diffMs = startTime.getTime() - birthdayThisYear.getTime();
  if (diffMs < 0) return false;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDays <= Math.max(1, validDaysAfterBirthday);
}

function buildCampaignComparator(rowA: CampaignRow, rowB: CampaignRow): number {
  if (rowA.priority !== rowB.priority) return rowA.priority - rowB.priority;
  const aKind = parseDiscountKind(rowA.config);
  const bKind = parseDiscountKind(rowB.config);
  const kindDiff = discountTypeOrder(aKind) - discountTypeOrder(bKind);
  if (kindDiff !== 0) return kindDiff;
  return rowA.id - rowB.id;
}

function isManualOnlyCampaign(type: string): boolean {
  return type === 'LOYALTY' || type === 'MULTI_SERVICE_DISCOUNT' || type === 'OFF_PEAK' || type === 'REFERRAL';
}

export async function previewCampaignPricing(input: CampaignPricingInput): Promise<CampaignPricingResult> {
  const startTime = input.startTime;
  const now = new Date();
  const [campaigns, usage, stats, walletByCampaign, timezone] = await Promise.all([
    getActiveCampaigns(input.salonId, now),
    getUsageMap(input.salonId, input.customerId),
    getCustomerStats(input.salonId, input.customerId),
    getWalletBalanceMap(input.salonId, input.customerId),
    getSalonTimezone(input.salonId),
  ]);

  const sortedCampaigns = [...campaigns].sort(buildCampaignComparator);
  const eligibleServiceCount = input.lines.filter((line) => !line.isPackageCovered).length;
  const weekdayKey = getInTimezoneWeekdayKey(startTime, timezone);
  const minuteOfDay = getInTimezoneMinuteOfDay(startTime, timezone);

  const lines: CampaignPricingLineResult[] = input.lines.map((line) => {
    const base = Math.max(0, Number(line.listPrice || 0));
    const packageCovered = Boolean(line.isPackageCovered);
    if (packageCovered || base <= 0) {
      return {
        serviceId: Number(line.serviceId),
        listPrice: base,
        discountTotal: 0,
        finalPrice: 0,
        appliedCampaigns: [],
        skippedCampaigns: [],
        packageCovered,
      };
    }

    let running = base;
    const appliedCampaigns: AppliedCampaignDetail[] = [];
    const skippedCampaigns: SkippedCampaignDetail[] = [];
    const skip = (campaign: CampaignRow, reasonCode: SkippedCampaignDetail['reasonCode']) => {
      skippedCampaigns.push({
        campaignId: campaign.id,
        campaignType: campaign.type,
        campaignName: campaign.name,
        reasonCode,
      });
    };

    for (const campaign of sortedCampaigns) {
      if (campaign.maxGlobalUsage !== null) {
        const used = usage.global.get(campaign.id) || 0;
        if (used >= campaign.maxGlobalUsage) {
          skip(campaign, 'GLOBAL_LIMIT_REACHED');
          continue;
        }
      }
      if (campaign.maxPerCustomer !== null && input.customerId) {
        const usedByCustomer = usage.perCustomer.get(campaign.id) || 0;
        if (usedByCustomer >= campaign.maxPerCustomer) {
          skip(campaign, 'CUSTOMER_LIMIT_REACHED');
          continue;
        }
      }

      const cfg = campaign.config;
      const type = campaign.type;

      if (
        (type === 'WELCOME_FIRST_VISIT' ||
          type === 'BIRTHDAY' ||
          type === 'WINBACK' ||
          type === 'REFERRAL' ||
          type === 'LOYALTY' ||
          type === 'MULTI_SERVICE_DISCOUNT' ||
          type === 'OFF_PEAK') &&
        !isServiceEligibleByScope(cfg, Number(line.serviceId))
      ) {
        skip(campaign, 'SERVICE_NOT_ELIGIBLE');
        continue;
      }

      if (type === 'MULTI_SERVICE_DISCOUNT') {
        const minCount = Math.max(2, Number(cfg.minServiceCount || 2));
        if (eligibleServiceCount < minCount) {
          skip(campaign, 'MULTI_SERVICE_NOT_ELIGIBLE');
          continue;
        }
      }

      if (type === 'BIRTHDAY') {
        const validDays = Math.max(1, Number(cfg.validDaysAfterBirthday || 7));
        if (!isBirthdayEligible(stats.birthDate, startTime, validDays)) {
          skip(campaign, 'BIRTHDAY_NOT_ELIGIBLE');
          continue;
        }
      }

      if (type === 'WINBACK') {
        const threshold = Math.max(1, Number(cfg.inactiveDaysThreshold || 30));
        if (!stats.lastAppointmentAt) {
          skip(campaign, 'WINBACK_NOT_ELIGIBLE');
          continue;
        }
        const diffDays = Math.floor((startTime.getTime() - stats.lastAppointmentAt.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays < threshold) {
          skip(campaign, 'WINBACK_NOT_ELIGIBLE');
          continue;
        }
      }

      if (type === 'WELCOME_FIRST_VISIT') {
        if (stats.completedCount > 0) {
          skip(campaign, 'FIRST_VISIT_NOT_ELIGIBLE');
          continue;
        }
      }

      if (type === 'OFF_PEAK') {
        const weekdays = Array.isArray(cfg.weekdays) ? cfg.weekdays.map((w: any) => String(w).toUpperCase()) : ['MON', 'TUE', 'WED', 'THU'];
        if (!weekdays.includes(weekdayKey)) {
          skip(campaign, 'OFF_PEAK_NOT_ELIGIBLE');
          continue;
        }
        const startMinute = toMinute(cfg.startHour) ?? toMinute('12:00')!;
        const endMinute = toMinute(cfg.endHour) ?? toMinute('16:00')!;
        if (!(minuteOfDay >= startMinute && minuteOfDay < endMinute)) {
          skip(campaign, 'OFF_PEAK_NOT_ELIGIBLE');
          continue;
        }
      }

      let amount = 0;
      const rewardType = String(cfg.rewardType || cfg.discountType || cfg.offerType || '').trim().toLowerCase();

      if (type === 'LOYALTY' || type === 'REFERRAL') {
        const walletAmount = walletByCampaign.get(campaign.id) || 0;
        if (walletAmount <= 0) {
          skip(campaign, 'WALLET_EMPTY');
          continue;
        }
        amount = Math.min(running, walletAmount);
      } else if (rewardType === 'free_service') {
        if (Number(cfg.rewardServiceId) === Number(line.serviceId)) {
          amount = running;
        } else {
          skip(campaign, 'SERVICE_NOT_ELIGIBLE');
          continue;
        }
      } else {
        const kind = parseDiscountKind(cfg);
        const value = parseDiscountValue(cfg);
        if (value <= 0) {
          skip(campaign, 'INVALID_DISCOUNT_CONFIG');
          continue;
        }
        amount = computeDiscount(running, kind, value);
      }

      if (amount <= 0) continue;
      running = Math.max(0, running - amount);
      appliedCampaigns.push({
        campaignId: campaign.id,
        campaignType: campaign.type,
        campaignName: campaign.name,
        amount: Number(amount.toFixed(2)),
      });

      if (running <= 0) break;
    }

    const discountTotal = Number((base - running).toFixed(2));
    return {
      serviceId: Number(line.serviceId),
      listPrice: base,
      discountTotal,
      finalPrice: Number(running.toFixed(2)),
      appliedCampaigns,
      skippedCampaigns,
      packageCovered,
    };
  });

  const subtotal = Number(lines.reduce((acc, line) => acc + line.listPrice, 0).toFixed(2));
  const discountTotal = Number(lines.reduce((acc, line) => acc + line.discountTotal, 0).toFixed(2));
  const finalTotal = Number(lines.reduce((acc, line) => acc + line.finalPrice, 0).toFixed(2));
  const appliedCampaigns = aggregateApplied(lines.flatMap((line) => line.appliedCampaigns));
  const skippedReasonMap = new Map<SkippedCampaignDetail['reasonCode'], number>();
  for (const line of lines) {
    for (const skipped of line.skippedCampaigns) {
      skippedReasonMap.set(skipped.reasonCode, (skippedReasonMap.get(skipped.reasonCode) || 0) + 1);
    }
  }
  const skippedReasons = Array.from(skippedReasonMap.entries()).map(([reasonCode, count]) => ({ reasonCode, count }));

  return {
    currency: 'TRY',
    subtotal,
    discountTotal,
    finalTotal,
    lines,
    appliedCampaigns,
    evaluationMeta: {
      snapshotVersion: 1,
      skippedReasons,
    },
  };
}

export async function persistAppointmentCampaignApplication(input: {
  salonId: number;
  appointmentId: number;
  customerId?: number | null;
  serviceId?: number | null;
  line: CampaignPricingLineResult;
  db?: {
    $executeRawUnsafe: (...args: any[]) => Promise<any>;
  };
}): Promise<void> {
  if (!input.line.appliedCampaigns.length) {
    return;
  }
  const db = input.db ?? prisma;

  for (const campaign of input.line.appliedCampaigns) {
    await db.$executeRawUnsafe(
      `
        INSERT INTO "AppointmentCampaignApplication"
          ("salonId", "appointmentId", "customerId", "campaignId", "serviceId", "status", "listPrice", "discountAmount", "finalPrice", "metadata", "appliedAt", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4, $5, 'APPLIED'::"CampaignApplicationStatus", $6, $7, $8, $9::jsonb, NOW(), NOW(), NOW())
      `,
      input.salonId,
      input.appointmentId,
      input.customerId || null,
      campaign.campaignId,
      input.serviceId || null,
      Number(input.line.listPrice || 0),
      Number(campaign.amount || 0),
      Number(input.line.finalPrice || 0),
      JSON.stringify({ campaignType: campaign.campaignType, campaignName: campaign.campaignName }),
    );
  }
}

export async function releaseAppointmentCampaignApplications(input: {
  salonId: number;
  appointmentId: number;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
      UPDATE "AppointmentCampaignApplication"
      SET "status" = 'RELEASED'::"CampaignApplicationStatus", "releasedAt" = NOW(), "updatedAt" = NOW()
      WHERE "salonId" = $1 AND "appointmentId" = $2 AND "status" = 'APPLIED'::"CampaignApplicationStatus"
    `,
    input.salonId,
    input.appointmentId,
  );
}

export async function consumeWalletBalances(input: {
  salonId: number;
  customerId?: number | null;
  line: CampaignPricingLineResult;
}): Promise<void> {
  if (!input.customerId) return;

  for (const app of input.line.appliedCampaigns) {
    if (app.campaignType !== 'LOYALTY' && app.campaignType !== 'REFERRAL') continue;

    await prisma.$executeRawUnsafe(
      `
        UPDATE "CustomerCampaignWallet"
        SET "consumedAmount" = COALESCE("consumedAmount", 0) + $1, "updatedAt" = NOW()
        WHERE "salonId" = $2 AND "customerId" = $3 AND "campaignId" = $4
      `,
      Number(app.amount || 0),
      input.salonId,
      input.customerId,
      app.campaignId,
    );
  }
}

export async function createOrIncrementWalletCredit(input: {
  salonId: number;
  customerId: number;
  campaignId: number;
  amount: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "CustomerCampaignWallet"
        ("salonId", "customerId", "campaignId", "balanceAmount", "consumedAmount", "metadata", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, 0, $5::jsonb, NOW(), NOW())
      ON CONFLICT ("salonId", "customerId", "campaignId")
      DO UPDATE SET
        "balanceAmount" = COALESCE("CustomerCampaignWallet"."balanceAmount", 0) + EXCLUDED."balanceAmount",
        "updatedAt" = NOW(),
        "metadata" = EXCLUDED."metadata"
    `,
    input.salonId,
    input.customerId,
    input.campaignId,
    Number(input.amount),
    JSON.stringify(input.metadata || {}),
  );
}

export async function processCompletionCampaignRewards(input: {
  salonId: number;
  appointmentId: number;
  customerId?: number | null;
}): Promise<void> {
  if (!input.customerId) return;

  const campaigns = await getActiveCampaigns(input.salonId, new Date());
  const loyalty = campaigns.filter((c) => c.type === 'LOYALTY');
  for (const campaign of loyalty) {
    const cfg = campaign.config;
    const threshold = Math.max(1, Number(cfg.rewardThreshold || 5));
    const rewardValue = Math.max(0, Number(cfg.rewardValue || 0));
    if (rewardValue <= 0) continue;

    const completedCount = await prisma.appointment.count({
      where: {
        salonId: input.salonId,
        customerId: input.customerId,
        status: 'COMPLETED',
      },
    });

    if (completedCount > 0 && completedCount % threshold === 0) {
      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: input.customerId,
        campaignId: campaign.id,
        amount: rewardValue,
        metadata: { source: 'LOYALTY_THRESHOLD', threshold, appointmentId: input.appointmentId },
      });
    }
  }

  const refRows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT a."id", a."campaignId", a."referrerCustomerId"
      FROM "CampaignAttribution" a
      INNER JOIN "Campaign" c ON c."id" = a."campaignId"
      WHERE a."salonId" = $1
        AND a."referredCustomerId" = $2
        AND a."status" IN ('REGISTERED'::"CampaignAttributionStatus", 'PENDING'::"CampaignAttributionStatus")
        AND c."type" = 'REFERRAL'
    `,
    input.salonId,
    input.customerId,
  );

  for (const row of refRows) {
    const campaignId = Number(row.campaignId);
    const campaignRows = await prisma.$queryRawUnsafe<any[]>(`SELECT "config" FROM "Campaign" WHERE "id" = $1 LIMIT 1`, campaignId);
    const cfg = asObject(campaignRows?.[0]?.config);
    const referredReward = Math.max(0, Number(cfg.referredCustomerRewardValue || cfg.rewardValue || 0));
    const referrerReward = Math.max(0, Number(cfg.referrerRewardValue || cfg.rewardValue || 0));

    if (referredReward > 0) {
      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: input.customerId,
        campaignId,
        amount: referredReward,
        metadata: { source: 'REFERRAL_REFERRED_COMPLETED', attributionId: Number(row.id) },
      });
    }

    if (referrerReward > 0 && Number(row.referrerCustomerId) > 0) {
      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: Number(row.referrerCustomerId),
        campaignId,
        amount: referrerReward,
        metadata: { source: 'REFERRAL_REFERRER_COMPLETED', attributionId: Number(row.id), referredCustomerId: input.customerId },
      });
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE "CampaignAttribution"
        SET "status" = 'REWARDED'::"CampaignAttributionStatus", "completedAt" = NOW(), "firstAppointmentId" = COALESCE("firstAppointmentId", $3), "updatedAt" = NOW()
        WHERE "id" = $1 AND "salonId" = $2
      `,
      Number(row.id),
      input.salonId,
      input.appointmentId,
    );
  }
}

export async function getCampaignTeasersForCustomer(input: {
  salonId: number;
  customerId?: number | null;
}): Promise<{
  active: Array<{ id: number; name: string; type: string; deliveryMode: 'AUTO' | 'MANUAL'; startsAt: string | null; endsAt: string | null; priority: number; config: any }>;
  wallet: Array<{ campaignId: number; availableAmount: number }>;
  enrollments: Array<{ campaignId: number; status: string; enrolledAt: string | null }>;
  shareLinks: Array<{ campaignId: number; token: string; status: string; expiresAt: string | null }>;
  completedCount: number;
}> {
  const activeRows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "id", "name", "type", "deliveryMode", "startsAt", "endsAt", "priority", "config"
      FROM "Campaign"
      WHERE "salonId" = $1 AND "isActive" = true
      ORDER BY "priority" ASC, "id" ASC
    `,
    input.salonId,
  );

  let completedCount = 0;
  if (input.customerId) {
    completedCount = await prisma.appointment.count({
      where: {
        salonId: input.salonId,
        customerId: input.customerId,
        status: 'COMPLETED',
      },
    });
  }

  if (!input.customerId) {
    return {
      active: activeRows.map((r) => ({
        id: Number(r.id),
        name: String(r.name || ''),
        type: String(r.type || ''),
        deliveryMode: String(r.deliveryMode || 'MANUAL').toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
        startsAt: r.startsAt ? new Date(r.startsAt).toISOString() : null,
        endsAt: r.endsAt ? new Date(r.endsAt).toISOString() : null,
        priority: Number(r.priority || 100),
        config: asObject(r.config),
      })),
      wallet: [],
      enrollments: [],
      shareLinks: [],
      completedCount: 0,
    };
  }

  const [walletRows, enrollmentRows, shareRows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "campaignId", GREATEST("balanceAmount" - "consumedAmount", 0) AS "available"
        FROM "CustomerCampaignWallet"
        WHERE "salonId" = $1 AND "customerId" = $2
      `,
      input.salonId,
      input.customerId,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "campaignId", "status", "enrolledAt"
        FROM "CustomerCampaignEnrollment"
        WHERE "salonId" = $1 AND "customerId" = $2
      `,
      input.salonId,
      input.customerId,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "campaignId", "token", "status", "expiresAt"
        FROM "CampaignShareLink"
        WHERE "salonId" = $1 AND "customerId" = $2
      `,
      input.salonId,
      input.customerId,
    ),
  ]);

  return {
    active: activeRows.map((r) => ({
      id: Number(r.id),
      name: String(r.name || ''),
      type: String(r.type || ''),
      deliveryMode: String(r.deliveryMode || 'MANUAL').toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL',
      startsAt: r.startsAt ? new Date(r.startsAt).toISOString() : null,
      endsAt: r.endsAt ? new Date(r.endsAt).toISOString() : null,
      priority: Number(r.priority || 100),
      config: asObject(r.config),
    })),
    wallet: walletRows.map((row) => ({ campaignId: Number(row.campaignId), availableAmount: Number(row.available || 0) })),
    enrollments: enrollmentRows.map((row) => ({
      campaignId: Number(row.campaignId),
      status: String(row.status || ''),
      enrolledAt: row.enrolledAt ? new Date(row.enrolledAt).toISOString() : null,
    })),
    shareLinks: shareRows.map((row) => ({
      campaignId: Number(row.campaignId),
      token: String(row.token || ''),
      status: String(row.status || ''),
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    })),
    completedCount,
  };
}

export async function upsertReferralEnrollment(input: {
  salonId: number;
  customerId: number;
  campaignId: number;
}): Promise<{ campaignId: number; shareToken: string }> {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "CustomerCampaignEnrollment"
        ("salonId", "customerId", "campaignId", "status", "source", "enrolledAt", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, 'ENROLLED'::"CampaignEnrollmentStatus", 'CUSTOMER_BOOKING', NOW(), NOW(), NOW())
      ON CONFLICT ("salonId", "customerId", "campaignId")
      DO UPDATE SET "status" = 'ENROLLED'::"CampaignEnrollmentStatus", "updatedAt" = NOW()
    `,
    input.salonId,
    input.customerId,
    input.campaignId,
  );

  const token = `${input.salonId}_${input.campaignId}_${input.customerId}_${Math.random().toString(36).slice(2, 10)}`;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "CampaignShareLink"
        ("salonId", "campaignId", "customerId", "token", "status", "lastSharedAt", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, 'ACTIVE'::"CampaignShareLinkStatus", NOW(), NOW(), NOW())
      ON CONFLICT ("salonId", "campaignId", "customerId")
      DO UPDATE SET "token" = COALESCE("CampaignShareLink"."token", EXCLUDED."token"), "status" = 'ACTIVE'::"CampaignShareLinkStatus", "lastSharedAt" = NOW(), "updatedAt" = NOW()
    `,
    input.salonId,
    input.campaignId,
    input.customerId,
    token,
  );

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "token"
      FROM "CampaignShareLink"
      WHERE "salonId" = $1 AND "campaignId" = $2 AND "customerId" = $3
      LIMIT 1
    `,
    input.salonId,
    input.campaignId,
    input.customerId,
  );

  return {
    campaignId: input.campaignId,
    shareToken: String(rows?.[0]?.token || token),
  };
}

export async function registerReferralAttributionFromToken(input: {
  salonId: number;
  referredCustomerId: number;
  token: string;
}): Promise<void> {
  const shareRows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "id", "campaignId", "customerId"
      FROM "CampaignShareLink"
      WHERE "salonId" = $1 AND "token" = $2 AND "status" = 'ACTIVE'::"CampaignShareLinkStatus"
      LIMIT 1
    `,
    input.salonId,
    input.token,
  );

  const share = shareRows?.[0];
  if (!share) return;

  if (Number(share.customerId) === input.referredCustomerId) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "CampaignAttribution"
        ("salonId", "campaignId", "shareLinkId", "referrerCustomerId", "referredCustomerId", "status", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, $5, 'REGISTERED'::"CampaignAttributionStatus", NOW(), NOW())
      ON CONFLICT DO NOTHING
    `,
    input.salonId,
    Number(share.campaignId),
    Number(share.id),
    Number(share.customerId),
    input.referredCustomerId,
  );
}

export async function getCampaignsForAutoSend(salonId: number): Promise<Array<{ id: number; name: string; type: string }>> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT "id", "name", "type"
      FROM "Campaign"
      WHERE "salonId" = $1
        AND "isActive" = true
        AND "deliveryMode" = 'AUTO'::"CampaignDeliveryMode"
        AND "type" IN ('BIRTHDAY', 'WINBACK', 'WELCOME_FIRST_VISIT')
    `,
    salonId,
  );
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name || ''), type: String(row.type || '') }));
}

export async function listCampaignsForSend(salonId: number, campaignId: number): Promise<Array<{ customerId: number; name: string | null }>> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      SELECT DISTINCT c."id" AS "customerId", c."name"
      FROM "Customer" c
      LEFT JOIN "CustomerCampaignEnrollment" e
        ON e."salonId" = c."salonId" AND e."customerId" = c."id" AND e."campaignId" = $2
      WHERE c."salonId" = $1
        AND (e."status" = 'ENROLLED'::"CampaignEnrollmentStatus" OR e."id" IS NULL)
      ORDER BY c."id" DESC
      LIMIT 1000
    `,
    salonId,
    campaignId,
  );
  return rows.map((row) => ({ customerId: Number(row.customerId), name: row.name || null }));
}

export function shouldAutoSendCampaignType(type: string): boolean {
  const normalized = String(type || '').toUpperCase();
  return normalized === 'BIRTHDAY' || normalized === 'WINBACK' || normalized === 'WELCOME_FIRST_VISIT';
}

export function isCampaignManualPreferred(type: string): boolean {
  return isManualOnlyCampaign(String(type || '').toUpperCase());
}
