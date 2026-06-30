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
  // Yeni: MANUAL kampanyalar müşteri akışında otomatik tetiklenmez —
  // salon kasiyeri checkout ekranından elle uygular. AUTO ise her
  // rezervasyonda preview/commit'te değerlendirilir.
  deliveryMode: 'AUTO' | 'MANUAL';
};

export type CampaignPricingLineInput = {
  serviceId: number;
  listPrice: number;
  isPackageCovered?: boolean;
  // 1 = booker, 2..N = companions. Faz 42 scopes campaigns to the
  // booker only — companion lines pass through with no discount.
  // Optional for back-compat: undefined behaves as 1.
  personIndex?: number;
  // Staff assigned to this line, when known (booking commit path). Used by the
  // optional staff-scope filter (eligibleStaffIds). Undefined/null = unknown →
  // a staff-restricted campaign won't apply (safe).
  staffId?: number | null;
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
  discountKind: DiscountKind | null;
  discountValue: number | null;
};

export type CampaignSkipReasonCode =
  | 'GLOBAL_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'MULTI_SERVICE_NOT_ELIGIBLE'
  | 'BIRTHDAY_NOT_ELIGIBLE'
  | 'WINBACK_NOT_ELIGIBLE'
  | 'FIRST_VISIT_NOT_ELIGIBLE'
  | 'OFF_PEAK_NOT_ELIGIBLE'
  | 'WALLET_EMPTY'
  | 'SERVICE_NOT_ELIGIBLE'
  | 'STAFF_NOT_ELIGIBLE'
  | 'INVALID_DISCOUNT_CONFIG'
  | 'COMPANION_LINE'
  | 'BILL_THRESHOLD_NOT_REACHED'
  | 'MANUAL_ONLY_NOT_TRIGGERED';

export type SkippedCampaignDetail = {
  campaignId: number;
  campaignType: CampaignType;
  campaignName: string;
  reasonCode: CampaignSkipReasonCode;
  reasonLabel: string;
};

/**
 * Türkçe okunabilir gerekçe etiketleri — backend cevabıyla birlikte gönderilir
 * ki frontend "uygun değil" gibi muğlak fallback kullanmasın. Her yeni
 * reasonCode eklendiğinde buraya da Türkçe karşılığı eklenmeli.
 */
export const SKIP_REASON_LABELS_TR: Record<CampaignSkipReasonCode, string> = {
  GLOBAL_LIMIT_REACHED: 'Kampanya kullanım hakkı doldu',
  CUSTOMER_LIMIT_REACHED: 'Bu kampanyayı zaten kullandınız',
  MULTI_SERVICE_NOT_ELIGIBLE: 'En az 2 hizmet gerekli',
  BIRTHDAY_NOT_ELIGIBLE: 'Doğum günü tarih aralığı dışı',
  WINBACK_NOT_ELIGIBLE: 'Geri kazanım koşulu tutmuyor',
  FIRST_VISIT_NOT_ELIGIBLE: 'İlk randevu indirimi geçmiş randevu varken kullanılamaz',
  OFF_PEAK_NOT_ELIGIBLE: 'Uygun saat dışı',
  WALLET_EMPTY: 'Cüzdan bakiyesi yok',
  SERVICE_NOT_ELIGIBLE: 'Bu hizmet kampanyaya dahil değil',
  STAFF_NOT_ELIGIBLE: 'Bu çalışan kampanyaya dahil değil',
  INVALID_DISCOUNT_CONFIG: 'Kampanya ayarı geçersiz',
  COMPANION_LINE: 'Yanınızdaki kişiye kampanya uygulanmaz',
  BILL_THRESHOLD_NOT_REACHED: 'Minimum tutara ulaşılmadı',
  MANUAL_ONLY_NOT_TRIGGERED: 'Bu kampanya salonda elden uygulanır',
};

export type CampaignPricingLineResult = {
  serviceId: number;
  listPrice: number;
  discountTotal: number;
  finalPrice: number;
  appliedCampaigns: AppliedCampaignDetail[];
  skippedCampaigns: SkippedCampaignDetail[];
  packageCovered: boolean;
  // Mirrored from input so the BILL_THRESHOLD aggregate pass can
  // restrict its bill calculation + reward distribution to the
  // booker's lines (Faz 42).
  personIndex?: number;
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
    skippedReasons: Array<{ reasonCode: CampaignSkipReasonCode; count: number; reasonLabel: string }>;
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

/**
 * Salonun saat dilimine göre month/day döndürür. Eski isBirthdayEligible
 * UTC tabanlıydı — bu yüzden lokal gece yarısı sonrası rezervasyonlar
 * "değil" gibi görünüyordu. Bu helper Istanbul wall-clock'a göre çalışır.
 */
function getInTimezoneMonthDay(date: Date, timezone = 'Europe/Istanbul'): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === 'month')?.value || '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value || '1');
  return { month: month - 1, day };
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

// Optional staff-scope filter. If eligibleStaffIds is set, the line's assigned
// staff must be in it. Unknown staffId (preview paths) with a restriction set
// → not eligible (safe: a staff-restricted campaign won't apply blindly).
function isStaffEligibleByScope(config: Record<string, any>, staffId: number | null | undefined): boolean {
  const eligible = toServiceIdSet(config.eligibleStaffIds);
  if (eligible && eligible.size > 0) {
    return staffId != null && eligible.has(Number(staffId));
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
  const dmRaw = String(row.deliveryMode || row.delivery_mode || 'AUTO').trim().toUpperCase();
  return {
    id: Number(row.id),
    salonId: Number(row.salonId),
    name: String(row.name || row.type || `Campaign ${row.id}`),
    type: String(row.type || '').trim().toUpperCase() as CampaignType,
    config: asObject(row.config),
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
    maxGlobalUsage: normalizeUsageLimit(row.maxGlobalUsage),
    maxPerCustomer: normalizeUsageLimit(row.maxPerCustomer),
    deliveryMode: dmRaw === 'MANUAL' ? 'MANUAL' : 'AUTO',
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
        c."id", c."salonId", c."name", c."type", c."config", c."priority",
        c."maxGlobalUsage", c."maxPerCustomer", c."deliveryMode"
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
  /** WELCOME_FIRST_VISIT için: COMPLETED + BOOKED + UPDATED toplamı.
   *  Eski sürüm sadece COMPLETED sayıyordu → müşteri 5 randevu rezerve
   *  edip hiçbirini tamamlamadan her seferinde "ilk randevu" indirimi
   *  alabiliyordu. Bookling/bekleyen rezervasyonları da say. */
  activeOrCompletedCount: number;
  lastAppointmentAt: Date | null;
  birthDate: Date | null;
}> {
  if (!customerId) {
    return { completedCount: 0, activeOrCompletedCount: 0, lastAppointmentAt: null, birthDate: null };
  }

  const [completedCount, activeOrCompletedCount, lastAppointment, customer] = await Promise.all([
    prisma.appointment.count({ where: { salonId, customerId, status: 'COMPLETED' } }),
    // WELCOME_FIRST_VISIT istismarına karşı: CANCELLED ve NO_SHOW da
    // saysın ki bir müşteri "iptal-iptal-iptal" yaparak "yeni müşteri"
    // indirimini sürekli kullanamasın. activeOrCompletedCount artık
    // "müşteri salonu daha önce tanıyor mu?" sorusunun cevabı —
    // BOOKED + COMPLETED + CANCELLED + NO_SHOW + UPDATED dahil.
    prisma.appointment.count({
      where: {
        salonId,
        customerId,
        status: { in: ['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'UPDATED'] },
      },
    }),
    prisma.appointment.findFirst({
      where: { salonId, customerId },
      orderBy: [{ endTime: 'desc' }],
      select: { endTime: true },
    }),
    prisma.customer.findUnique({ where: { id: customerId }, select: { birthDate: true } }),
  ]);

  return {
    completedCount,
    activeOrCompletedCount,
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
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
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

function isBirthdayEligible(
  birthDate: Date | null,
  startTime: Date,
  validDaysAfterBirthday: number,
  validDaysBeforeBirthday: number,
  timezone: string,
): boolean {
  if (!birthDate) return false;
  // Birthday'i salonun saat dilimine göre değerlendir — UTC kullanmak
  // gece yarısı kayması bug'ı yaratıyordu (#9). Salon Istanbul, müşteri
  // 23:30 lokal saatte doğum gününde rezerve ettiyse "evet" demeli.
  const bMonth = birthDate.getUTCMonth();
  const bDay = birthDate.getUTCDate();
  const today = getInTimezoneMonthDay(startTime, timezone);
  // Yıl Istanbul TZ'sinde
  const yearStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric' }).format(startTime);
  const year = Number(yearStr) || new Date().getFullYear();

  // Bu yılki doğum günü — leap-year safe: Şubat 29 + non-leap → Mart 1
  // SİLİNTİLİ değil, kullanıcının niyeti "bana yakın bir tarih"
  let birthdayThisYear: Date;
  if (bMonth === 1 && bDay === 29) {
    // Yıl leap mi?
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    birthdayThisYear = new Date(year, isLeap ? 1 : 2, isLeap ? 29 : 1);
  } else {
    birthdayThisYear = new Date(year, bMonth, bDay);
  }
  const todayWall = new Date(year, today.month, today.day);
  const diffDays = Math.round((todayWall.getTime() - birthdayThisYear.getTime()) / (24 * 60 * 60 * 1000));

  const before = Math.max(0, validDaysBeforeBirthday);
  const after = Math.max(1, validDaysAfterBirthday);
  // diffDays negatif → doğum gününden ÖNCE; -before ≤ diffDays ≤ +after
  return diffDays >= -before && diffDays <= after;
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
  // Mid-loop usage tracking — DB'den okunan başlangıç sayılarına ek
  // olarak, bu booking içinde uygulanan kampanyaları da say. Eski kod
  // sadece DB snapshot'ına bakıyordu → maxPerCustomer=1 olan kampanya
  // 3 hizmetli tek bookingde 3 kez uygulanabiliyordu (#3).
  const runtimeGlobalUsage = new Map<number, number>(usage.global);
  const runtimePerCustomerUsage = new Map<number, number>(usage.perCustomer);
  const incrementRuntimeUsage = (campaignId: number) => {
    runtimeGlobalUsage.set(campaignId, (runtimeGlobalUsage.get(campaignId) || 0) + 1);
    if (input.customerId) {
      runtimePerCustomerUsage.set(campaignId, (runtimePerCustomerUsage.get(campaignId) || 0) + 1);
    }
  };
  // Faz 42: campaigns scope to the booker (personIndex 1) only. Both
  // the eligibility count (how many qualifying services) and the
  // bill threshold below honor that scope — companion lines neither
  // contribute to the threshold nor receive a discount.
  const isMainPersonLine = (line: CampaignPricingLineInput): boolean =>
    (line.personIndex ?? 1) === 1;
  const eligibleServiceCount = input.lines.filter(
    (line) => !line.isPackageCovered && isMainPersonLine(line),
  ).length;
  // Basket total of the booker's chargeable lines (pre-discount list price) —
  // used by the optional per-campaign minimum-spend gate below.
  const eligibleBaseTotal = input.lines
    .filter((line) => !line.isPackageCovered && isMainPersonLine(line))
    .reduce((sum, line) => sum + Math.max(0, Number(line.listPrice || 0)), 0);

  // For MULTI_SERVICE_DISCOUNT campaigns set to discount only the CHEAPEST
  // eligible service ("ikinciye/en ucuza indirim"), precompute that line's
  // index once. Absent/`all` → empty map → discount applies to every eligible
  // line as before (backward-compatible).
  const multiCheapestLineIndex = new Map<number, number>();
  for (const campaign of sortedCampaigns) {
    if (String(campaign.type) !== 'MULTI_SERVICE_DISCOUNT') continue;
    const cfg = (campaign.config || {}) as Record<string, any>;
    if (String(cfg.discountTarget || 'all') !== 'cheapest') continue;
    // "cheapest" targets a single line by price and is meaningless for
    // free_service (which targets a specific rewardServiceId). Fall back to
    // normal free_service handling instead of accidentally suppressing it.
    const rewardType = String(cfg.rewardType || cfg.discountType || '').trim().toLowerCase();
    if (rewardType === 'free_service') continue;
    let bestIdx = -1;
    let bestPrice = Infinity;
    input.lines.forEach((line, idx) => {
      if (line.isPackageCovered || !isMainPersonLine(line)) return;
      if (!isServiceEligibleByScope(cfg, Number(line.serviceId))) return;
      if (!isStaffEligibleByScope(cfg, line.staffId)) return;
      const price = Math.max(0, Number(line.listPrice || 0));
      if (price <= 0) return;
      if (price < bestPrice) {
        bestPrice = price;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) multiCheapestLineIndex.set(campaign.id, bestIdx);
  }

  const weekdayKey = getInTimezoneWeekdayKey(startTime, timezone);
  const minuteOfDay = getInTimezoneMinuteOfDay(startTime, timezone);

  const lines: CampaignPricingLineResult[] = input.lines.map((line, lineIndex) => {
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
        personIndex: line.personIndex,
      };
    }

    // Companion lines: list price stands, every campaign records as
    // skipped with COMPANION_LINE so the UI can surface "this offer
    // only applies to your services" if it wants to.
    if (!isMainPersonLine(line)) {
      return {
        serviceId: Number(line.serviceId),
        listPrice: base,
        discountTotal: 0,
        finalPrice: base,
        appliedCampaigns: [],
        skippedCampaigns: sortedCampaigns.map((campaign) => ({
          campaignId: campaign.id,
          campaignType: campaign.type,
          campaignName: campaign.name,
          reasonCode: 'COMPANION_LINE' as const,
          reasonLabel: SKIP_REASON_LABELS_TR['COMPANION_LINE'],
        })),
        packageCovered,
        personIndex: line.personIndex,
      };
    }

    let running = base;
    const appliedCampaigns: AppliedCampaignDetail[] = [];
    const skippedCampaigns: SkippedCampaignDetail[] = [];
    // Same-CampaignType stacking guard: aynı tip kampanyadan (örn. 2 BIRTHDAY,
    // 2 WELCOME_FIRST_VISIT) sadece İLK eligible olan uygulansın. Yoksa salon
    // yanlışlıkla 2 BIRTHDAY açtıysa müşteri 2x indirim alır → finansal sızıntı.
    // Sıra `sortedCampaigns` zaten priority ASC (l.411), yani en yüksek
    // öncelikli kampanya (düşük number) "kazanır".
    const appliedTypesForThisLine = new Set<string>();
    const skip = (campaign: CampaignRow, reasonCode: CampaignSkipReasonCode) => {
      skippedCampaigns.push({
        campaignId: campaign.id,
        campaignType: campaign.type,
        campaignName: campaign.name,
        reasonCode,
        reasonLabel: SKIP_REASON_LABELS_TR[reasonCode],
      });
    };

    for (const campaign of sortedCampaigns) {
      // Same-type guard — aynı CampaignType'tan bir kampanya bu satıra
      // zaten uygulandıysa diğerlerini sessizce CUSTOMER_LIMIT_REACHED
      // olarak işaretle. Aynı tip 2+ aktif kampanyaya 'priority' (l.411)
      // zaten karar verir; bu sadece kontrolsüz stacking'i kapatır.
      if (appliedTypesForThisLine.has(String(campaign.type))) {
        skip(campaign, 'CUSTOMER_LIMIT_REACHED');
        continue;
      }

      // MANUAL kampanyalar müşteri akışında otomatik tetiklenmez —
      // salon checkout sheet'inde elle uygular (#11).
      if (campaign.deliveryMode === 'MANUAL') {
        skip(campaign, 'MANUAL_ONLY_NOT_TRIGGERED');
        continue;
      }

      if (campaign.maxGlobalUsage !== null) {
        const used = runtimeGlobalUsage.get(campaign.id) || 0;
        if (used >= campaign.maxGlobalUsage) {
          skip(campaign, 'GLOBAL_LIMIT_REACHED');
          continue;
        }
      }
      if (campaign.maxPerCustomer !== null && input.customerId) {
        const usedByCustomer = runtimePerCustomerUsage.get(campaign.id) || 0;
        if (usedByCustomer >= campaign.maxPerCustomer) {
          skip(campaign, 'CUSTOMER_LIMIT_REACHED');
          continue;
        }
      }

      const cfg = campaign.config;
      const type = campaign.type;

      // BILL_THRESHOLD is evaluated AFTER the per-line loop because it
      // depends on the aggregated bill, not the individual line. Skip
      // here so the generic discount fallback below doesn't accidentally
      // apply its rewardValue to every line.
      if (String(type) === 'BILL_THRESHOLD') {
        continue;
      }

      // Optional minimum-spend gate (₺): the campaign only applies if the
      // booker's pre-discount basket total reaches the configured floor.
      // Reduce-only (only ever suppresses a discount). Wallet types
      // (LOYALTY/REFERRAL) are excluded — their reward is the customer's
      // earned credit and shouldn't be gated by a spend floor here.
      if (type !== 'LOYALTY' && type !== 'REFERRAL') {
        const minSpendAmount = Math.max(0, Number(cfg.minSpendAmount || 0));
        if (minSpendAmount > 0 && eligibleBaseTotal < minSpendAmount) {
          skip(campaign, 'BILL_THRESHOLD_NOT_REACHED');
          continue;
        }
      }

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

      // Optional staff-scope filter (eligibleStaffIds). Same campaign types.
      if (
        (type === 'WELCOME_FIRST_VISIT' ||
          type === 'BIRTHDAY' ||
          type === 'WINBACK' ||
          type === 'REFERRAL' ||
          type === 'LOYALTY' ||
          type === 'MULTI_SERVICE_DISCOUNT' ||
          type === 'OFF_PEAK') &&
        !isStaffEligibleByScope(cfg, line.staffId)
      ) {
        skip(campaign, 'STAFF_NOT_ELIGIBLE');
        continue;
      }

      if (type === 'MULTI_SERVICE_DISCOUNT') {
        const minCount = Math.max(2, Number(cfg.minServiceCount || 2));
        if (eligibleServiceCount < minCount) {
          skip(campaign, 'MULTI_SERVICE_NOT_ELIGIBLE');
          continue;
        }
        // Cheapest-only target: this campaign discounts a single line (the
        // cheapest eligible service). Skip every other line.
        const cheapestIndex = multiCheapestLineIndex.get(campaign.id);
        if (cheapestIndex !== undefined && cheapestIndex !== lineIndex) {
          skip(campaign, 'SERVICE_NOT_ELIGIBLE');
          continue;
        }
      }

      if (type === 'BIRTHDAY') {
        const validDaysAfter = Math.max(1, Number(cfg.validDaysAfterBirthday || 7));
        // Yeni: validDaysBeforeBirthday — eskiden sadece sonrası vardı,
        // doğum gününden bir gün önce rezerve edilemiyordu (#10).
        const validDaysBefore = Math.max(0, Number(cfg.validDaysBeforeBirthday || 0));
        if (!isBirthdayEligible(stats.birthDate, startTime, validDaysAfter, validDaysBefore, timezone)) {
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
        // Müşteri zaten bir COMPLETED veya BOOKED randevuya sahipse "ilk
        // ziyaret" değildir. CANCELLED/NO_SHOW sayılmaz (fairness). Eski
        // sürüm sadece COMPLETED'a bakıyordu — müşteri 5 BOOKED rezerve
        // edip hepsinde "ilk ziyaret" indirimi alıyordu (#11).
        if (stats.activeOrCompletedCount > 0) {
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
        // Optional per-day hours: cfg.dayHours = { MON: {start,end}, ... }.
        // When today has an entry, use that window; otherwise fall back to the
        // global startHour/endHour (existing behavior → backward-compatible).
        const dayHours =
          cfg.dayHours && typeof cfg.dayHours === 'object' && !Array.isArray(cfg.dayHours)
            ? (cfg.dayHours as Record<string, any>)
            : null;
        const todayWindow = dayHours?.[weekdayKey];
        const startRaw = todayWindow?.start ?? cfg.startHour;
        const endRaw = todayWindow?.end ?? cfg.endHour;
        const startMinute = toMinute(startRaw) ?? toMinute('12:00')!;
        const endMinute = toMinute(endRaw) ?? toMinute('16:00')!;
        // Gece yarısını aşan pencere desteği (örn. 22:00–02:00): endMinute
        // startMinute'ten KÜÇÜKSE aralık ertesi güne sarar. EŞİTSE sıfır-genişlik
        // (dejenere config, örn. 12:00–12:00) → hiç uygulama (eski davranışla aynı,
        // "her zaman 24 saat" gibi yanlış bir genişlemeyi önler).
        const inOffPeak = endMinute === startMinute
          ? false
          : endMinute > startMinute
            ? (minuteOfDay >= startMinute && minuteOfDay < endMinute)
            : (minuteOfDay >= startMinute || minuteOfDay < endMinute);
        if (!inOffPeak) {
          skip(campaign, 'OFF_PEAK_NOT_ELIGIBLE');
          continue;
        }
      }

      let amount = 0;
      let appliedDiscountKind: DiscountKind | null = null;
      let appliedDiscountValue: number | null = null;
      const rewardType = String(cfg.rewardType || cfg.discountType || cfg.offerType || '').trim().toLowerCase();

      if (type === 'LOYALTY' || type === 'REFERRAL') {
        const walletAmount = walletByCampaign.get(campaign.id) || 0;
        if (walletAmount <= 0) {
          skip(campaign, 'WALLET_EMPTY');
          continue;
        }
        amount = Math.min(running, walletAmount);
      } else if (rewardType === 'free_service') {
        // The free-service picker stores its selection in `rewardServiceIds`
        // (array); older/singular `rewardServiceId` kept as a fallback. Read
        // both so the configured gift service is actually matched (previously
        // only the singular key was checked, which the form never sets → the
        // free-service reward never applied for ANY campaign type).
        const freeServiceIds = Array.isArray(cfg.rewardServiceIds)
          ? cfg.rewardServiceIds.map((id: any) => Number(id))
          : [];
        if (cfg.rewardServiceId != null) {
          freeServiceIds.push(Number(cfg.rewardServiceId));
        }
        if (freeServiceIds.includes(Number(line.serviceId))) {
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
        appliedDiscountKind = kind;
        appliedDiscountValue = value;
        amount = computeDiscount(running, kind, value);
        // Optional reward cap (₺): owner-set ceiling on the discount given by
        // this campaign on this line. Reduce-only; absent/0 = no cap.
        const maxDiscountAmount = Math.max(0, Number(cfg.maxDiscountAmount || 0));
        if (maxDiscountAmount > 0) {
          amount = Math.min(amount, maxDiscountAmount);
        }
      }

      if (amount <= 0) continue;
      running = Math.max(0, running - amount);
      appliedCampaigns.push({
        campaignId: campaign.id,
        campaignType: campaign.type,
        campaignName: campaign.name,
        amount: Number(amount.toFixed(2)),
        discountKind: appliedDiscountKind,
        discountValue: appliedDiscountValue,
      });
      // Aynı tipten 2. kampanyayı engelle — bu satıra zaten X tipi
      // uygulandığını işaretle.
      appliedTypesForThisLine.add(String(campaign.type));
      // Runtime usage: aynı kampanya bu booking'in sonraki satırlarında
      // tekrar tetiklenirse limit kontrolü doğru çalışsın (#3).
      incrementRuntimeUsage(campaign.id);

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
      personIndex: line.personIndex,
    };
  });

  // BILL_THRESHOLD aggregate pass. These campaigns fire when the total
  // bill (after all per-line stacks) exceeds a configured threshold —
  // i.e. they care about the BASKET, not individual services. We split
  // the reward proportionally across non-package-covered lines so the
  // discount appears as a normal line-attached entry; downstream
  // aggregation + persistence keeps working unchanged.
  const billThresholdCampaigns = sortedCampaigns.filter((c) => String(c.type) === 'BILL_THRESHOLD');
  // BILL_THRESHOLD skip'lerini ilk eligible line'a yazıyoruz — eski sürüm
  // sessizce continue'luyordu ve UI hiç skip mesajı görmüyordu (#7).
  const firstMainLine = lines.find((l) => !l.packageCovered && (l.personIndex ?? 1) === 1);
  const skipBillThreshold = (campaign: CampaignRow, reasonCode: CampaignSkipReasonCode) => {
    if (!firstMainLine) return;
    firstMainLine.skippedCampaigns.push({
      campaignId: campaign.id,
      campaignType: campaign.type,
      campaignName: campaign.name,
      reasonCode,
      reasonLabel: SKIP_REASON_LABELS_TR[reasonCode],
    });
  };
  for (const campaign of billThresholdCampaigns) {
    if (campaign.deliveryMode === 'MANUAL') {
      skipBillThreshold(campaign, 'MANUAL_ONLY_NOT_TRIGGERED');
      continue;
    }
    if (campaign.maxGlobalUsage !== null) {
      const used = runtimeGlobalUsage.get(campaign.id) || 0;
      if (used >= campaign.maxGlobalUsage) {
        skipBillThreshold(campaign, 'GLOBAL_LIMIT_REACHED');
        continue;
      }
    }
    if (campaign.maxPerCustomer !== null && input.customerId) {
      const usedByCustomer = runtimePerCustomerUsage.get(campaign.id) || 0;
      if (usedByCustomer >= campaign.maxPerCustomer) {
        skipBillThreshold(campaign, 'CUSTOMER_LIMIT_REACHED');
        continue;
      }
    }

    const cfg = (campaign.config || {}) as Record<string, any>;
    const thresholdAmount = Math.max(0, Number(cfg.thresholdAmount || 0));
    const rewardType = String(cfg.rewardType || cfg.discountType || '').trim().toLowerCase();
    const rewardValue = Number(cfg.rewardValue || cfg.discountValue || 0);
    if (thresholdAmount <= 0 || rewardValue <= 0) {
      skipBillThreshold(campaign, 'INVALID_DISCOUNT_CONFIG');
      continue;
    }

    // Only consider lines that aren't already fully covered (package
    // lines have finalPrice 0 and shouldn't count toward the threshold)
    // AND belong to the booker — companion lines have no campaign
    // entitlement, so they neither push the bill across the threshold
    // nor receive a share of the reward (Faz 42).
    const candidateLines = lines.filter(
      (l) => !l.packageCovered && l.finalPrice > 0 && (l.personIndex ?? 1) === 1,
    );
    const currentTotal = candidateLines.reduce((acc, l) => acc + l.finalPrice, 0);
    if (currentTotal < thresholdAmount) {
      skipBillThreshold(campaign, 'BILL_THRESHOLD_NOT_REACHED');
      continue;
    }
    if (!candidateLines.length) {
      skipBillThreshold(campaign, 'BILL_THRESHOLD_NOT_REACHED');
      continue;
    }

    // Filter by service scope — if the campaign restricts to certain
    // services, only those count for both the threshold and the reward
    // distribution. This keeps the rule "%10 ekstra on Yüz & Cilt
    // appointments over 500₺" working as expected.
    const eligibleForScope = candidateLines.filter((l) => isServiceEligibleByScope(cfg, l.serviceId));
    if (!eligibleForScope.length) {
      skipBillThreshold(campaign, 'SERVICE_NOT_ELIGIBLE');
      continue;
    }
    const eligibleTotal = eligibleForScope.reduce((acc, l) => acc + l.finalPrice, 0);
    if (eligibleTotal < thresholdAmount) {
      skipBillThreshold(campaign, 'BILL_THRESHOLD_NOT_REACHED');
      continue;
    }

    // Optional tiered rewards: a higher bill earns a higher reward. Tier 1 is
    // the base thresholdAmount/rewardValue (entry gate, already checked above);
    // tier 2/3 are optional flat config slots. Pick the highest tier whose
    // threshold the eligible bill reaches. No tiers configured → effective
    // value stays rewardValue → behavior identical to before.
    const tiers = [
      { threshold: thresholdAmount, value: rewardValue },
      { threshold: Number(cfg.tier2Threshold || 0), value: Number(cfg.tier2RewardValue || 0) },
      { threshold: Number(cfg.tier3Threshold || 0), value: Number(cfg.tier3RewardValue || 0) },
    ]
      .filter((tier) => tier.threshold > 0 && tier.value > 0)
      .sort((a, b) => a.threshold - b.threshold);
    let effectiveRewardValue = rewardValue;
    for (const tier of tiers) {
      if (eligibleTotal >= tier.threshold) effectiveRewardValue = tier.value;
    }

    let totalRewardAmount = 0;
    if (rewardType === 'discount_percent') {
      totalRewardAmount = Math.max(0, (eligibleTotal * effectiveRewardValue) / 100);
    } else if (rewardType === 'discount_fixed' || rewardType === 'fixed_amount') {
      totalRewardAmount = Math.min(eligibleTotal, effectiveRewardValue);
    } else {
      // free_service or other unknown — bail out for now. The free
      // service flow lives in the per-line loop and doesn't make sense
      // as a BILL_THRESHOLD aggregate.
      continue;
    }
    // Optional reward cap (₺) on the total bill-threshold reward. Reduce-only.
    const maxBillReward = Math.max(0, Number(cfg.maxDiscountAmount || 0));
    if (maxBillReward > 0) {
      totalRewardAmount = Math.min(totalRewardAmount, maxBillReward);
    }
    if (totalRewardAmount <= 0) continue;

    // Distribute proportionally and update each line's discountTotal /
    // finalPrice / appliedCampaigns so the downstream aggregator picks
    // it up. Keep the campaign's amount rounded to 2dp per line so
    // float drift doesn't show up in the UI.
    let remaining = totalRewardAmount;
    eligibleForScope.forEach((line, idx) => {
      const isLast = idx === eligibleForScope.length - 1;
      const share = isLast
        ? Math.max(0, Number(remaining.toFixed(2)))
        : Math.max(0, Number(((line.finalPrice / eligibleTotal) * totalRewardAmount).toFixed(2)));
      if (share <= 0) return;
      // Cap per-line share to its current finalPrice so we never go
      // negative (e.g. on rounding edge cases).
      const capped = Math.min(line.finalPrice, share);
      line.discountTotal = Number((line.discountTotal + capped).toFixed(2));
      line.finalPrice = Number((line.finalPrice - capped).toFixed(2));
      line.appliedCampaigns.push({
        campaignId: campaign.id,
        campaignType: campaign.type,
        campaignName: campaign.name,
        amount: capped,
        discountKind: rewardType === 'discount_percent' ? 'PERCENT' : 'FIXED',
        discountValue: rewardValue,
      });
      remaining = Number((remaining - capped).toFixed(2));
    });
  }

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
  const skippedReasons = Array.from(skippedReasonMap.entries()).map(([reasonCode, count]) => ({
    reasonCode,
    count,
    reasonLabel: SKIP_REASON_LABELS_TR[reasonCode as CampaignSkipReasonCode] || reasonCode,
  }));

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
    // Idempotency: aynı (salonId, appointmentId, campaignId, serviceId,
    // status) için tek satır — migration unique constraint koyuyor.
    // ON CONFLICT DO NOTHING ile double-submit/retry sessiz atlanır (#1).
    await db.$executeRawUnsafe(
      `
        INSERT INTO "AppointmentCampaignApplication"
          ("salonId", "appointmentId", "customerId", "campaignId", "serviceId", "status", "listPrice", "discountAmount", "finalPrice", "metadata", "appliedAt", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4, $5, 'APPLIED'::"CampaignApplicationStatus", $6, $7, $8, $9::jsonb, NOW(), NOW(), NOW())
        ON CONFLICT ON CONSTRAINT "uq_campaign_app_salon_appt_campaign_service"
        DO NOTHING
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
  // İptal / no-show iptal akışında: önce wallet'tan düşülen tutarları
  // geri ver (LOYALTY/REFERRAL puanı iade — #5), sonra application
  // satırlarını RELEASED'a çek.
  // Tek transaction'da yapıyoruz ki yarıda kalınırsa muhasebe bozulmasın.
  await prisma.$transaction(async (tx) => {
    // 1. Wallet refund — bu randevuda tüketilen LOYALTY/REFERRAL kredisini
    //    consumedAmount'tan geri düş. Sadece henüz RELEASED edilmemiş
    //    APPLIED satırlar üzerinden — idempotent.
    const walletAffected = await tx.$queryRawUnsafe<any[]>(
      `
        SELECT a."campaignId", a."customerId", a."discountAmount", c."type"
        FROM "AppointmentCampaignApplication" a
        INNER JOIN "Campaign" c ON c."id" = a."campaignId"
        WHERE a."salonId" = $1
          AND a."appointmentId" = $2
          AND a."status" = 'APPLIED'::"CampaignApplicationStatus"
          AND c."type" IN ('LOYALTY', 'REFERRAL')
      `,
      input.salonId,
      input.appointmentId,
    );

    for (const row of walletAffected) {
      const customerId = Number(row.customerId || 0);
      const campaignId = Number(row.campaignId || 0);
      const amount = Number(row.discountAmount || 0);
      if (!customerId || !campaignId || amount <= 0) continue;
      await tx.$executeRawUnsafe(
        `
          UPDATE "CustomerCampaignWallet"
          SET "consumedAmount" = GREATEST(COALESCE("consumedAmount", 0) - $1, 0),
              "updatedAt" = NOW()
          WHERE "salonId" = $2 AND "customerId" = $3 AND "campaignId" = $4
        `,
        amount,
        input.salonId,
        customerId,
        campaignId,
      );
    }

    // 2. Application satırlarını RELEASED'a çek (audit izi korunur).
    await tx.$executeRawUnsafe(
      `
        UPDATE "AppointmentCampaignApplication"
        SET "status" = 'RELEASED'::"CampaignApplicationStatus", "releasedAt" = NOW(), "updatedAt" = NOW()
        WHERE "salonId" = $1 AND "appointmentId" = $2 AND "status" = 'APPLIED'::"CampaignApplicationStatus"
      `,
      input.salonId,
      input.appointmentId,
    );
  });
}

export async function consumeWalletBalances(input: {
  salonId: number;
  customerId?: number | null;
  line: CampaignPricingLineResult;
  // tx geçilirse cüzdan tüketimi booking transaction'ının PARÇASI olur → randevu
  // rollback olursa paket/bakiye düşümü de geri alınır (eskiden tx-dışıydı: randevu
  // patlasa bile müşterinin paketinden hak gidiyordu).
  db?: { $executeRawUnsafe: (...args: any[]) => Promise<any> };
}): Promise<void> {
  if (!input.customerId) return;
  const db = input.db ?? prisma;

  for (const app of input.line.appliedCampaigns) {
    if (app.campaignType !== 'LOYALTY' && app.campaignType !== 'REFERRAL') continue;

    await db.$executeRawUnsafe(
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
  // Optional reward validity. When set, the wallet's expiry is set/extended to
  // this instant; when null, any existing expiry is preserved (no expiry on a
  // fresh wallet) → fully backward-compatible.
  expiresAt?: Date | null;
}): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "CustomerCampaignWallet"
        ("salonId", "customerId", "campaignId", "balanceAmount", "consumedAmount", "metadata", "expiresAt", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, 0, $5::jsonb, $6::timestamptz, NOW(), NOW())
      ON CONFLICT ("salonId", "customerId", "campaignId")
      DO UPDATE SET
        "balanceAmount" = COALESCE("CustomerCampaignWallet"."balanceAmount", 0) + EXCLUDED."balanceAmount",
        "updatedAt" = NOW(),
        "metadata" = EXCLUDED."metadata",
        "expiresAt" = COALESCE(EXCLUDED."expiresAt", "CustomerCampaignWallet"."expiresAt")
    `,
    input.salonId,
    input.customerId,
    input.campaignId,
    Number(input.amount),
    JSON.stringify(input.metadata || {}),
    input.expiresAt ? input.expiresAt.toISOString() : null,
  );
}

// Reward validity → absolute expiry instant. config.rewardValidityDays absent or
// <= 0 means "never expires" (returns null), preserving the legacy behavior.
function walletExpiryFromConfig(cfg: Record<string, any> | null | undefined): Date | null {
  const days = Math.max(0, Number(cfg?.rewardValidityDays || 0));
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function processCompletionCampaignRewards(input: {
  salonId: number;
  appointmentId: number;
  customerId?: number | null;
}): Promise<void> {
  if (!input.customerId) return;

  const campaigns = await getActiveCampaigns(input.salonId, new Date());
  const loyalty = campaigns.filter((c) => c.type === 'LOYALTY');

  // Fetch the customer's completed appointments ONCE (with finalPrice so each
  // campaign can apply its own optional minBillThreshold). Stamp counting is
  // then derived per-campaign from this list — supporting:
  //  - "once per day": count DISTINCT completed days (not raw count) so a
  //    customer can't farm stamps with multiple same-day bookings. To stay
  //    idempotent (createOrIncrementWalletCredit is NOT idempotent) the reward
  //    only fires on the day's "representative" completion = smallest-id
  //    completed appointment of that day → exactly one completion per day
  //    passes, order-independent, never double-credits.
  //  - minBillThreshold: only appointments whose bill (finalPrice) reaches the
  //    threshold count as stamps.
  // minBillThreshold absent/0 → no filter → behavior identical to before.
  const anyLoyalty = loyalty.length > 0;
  const timezone = anyLoyalty ? await getSalonTimezone(input.salonId) : 'Europe/Istanbul';
  const completedAppts = anyLoyalty
    ? await prisma.appointment.findMany({
        where: { salonId: input.salonId, customerId: input.customerId, status: 'COMPLETED' },
        select: { id: true, startTime: true, finalPrice: true },
      })
    : [];
  const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const computeStamps = (
    appts: Array<{ id: number; startTime: Date | null; finalPrice: number | null }>
  ) => {
    const days = new Set<string>();
    const minIdByDay = new Map<string, number>();
    let currentDayKey: string | null = null;
    for (const appt of appts) {
      if (!appt.startTime) continue;
      const key = dayKeyFmt.format(new Date(appt.startTime));
      days.add(key);
      const existing = minIdByDay.get(key);
      if (existing === undefined || appt.id < existing) minIdByDay.set(key, appt.id);
      if (appt.id === input.appointmentId) currentDayKey = key;
    }
    return {
      totalCount: appts.length,
      distinctDayCount: days.size,
      isDayRepresentative:
        currentDayKey != null && minIdByDay.get(currentDayKey) === input.appointmentId,
    };
  };

  for (const campaign of loyalty) {
    const cfg = campaign.config;
    const threshold = Math.max(1, Number(cfg.rewardThreshold || 5));
    const rewardValue = Math.max(0, Number(cfg.rewardValue || 0));
    if (rewardValue <= 0) continue;

    const loyaltyExpiresAt = walletExpiryFromConfig(cfg as Record<string, any>);
    const oncePerDay = Boolean((cfg as Record<string, any>).oncePerDay);

    // Optional minimum-bill filter: only appointments whose finalPrice reaches
    // the threshold count as stamps. minBill 0 → all completed appointments
    // (identical to the previous behavior).
    const minBill = Math.max(0, Number((cfg as Record<string, any>).minBillThreshold || 0));
    const qualifyingAppts =
      minBill > 0 ? completedAppts.filter((a) => (a.finalPrice ?? 0) >= minBill) : completedAppts;
    const stamps = computeStamps(qualifyingAppts);

    // MILESTONE MODE: when optional tier2/tier3 (kaç ziyaret → ödül) are set,
    // loyalty switches from "repeating every N visits" to one-time tiered
    // milestones (e.g. 5 ziyaret→100₺, 10→250₺). Tier 1 = base
    // rewardThreshold/rewardValue. Idempotent via the SAME loyaltyRewardCount
    // counter (= number of milestones credited). No tiers → length 1 → mode off
    // → existing repeating logic runs unchanged.
    const milestoneTiers = [
      { visits: threshold, value: rewardValue },
      { visits: Number((cfg as Record<string, any>).tier2Visits || 0), value: Number((cfg as Record<string, any>).tier2RewardValue || 0) },
      { visits: Number((cfg as Record<string, any>).tier3Visits || 0), value: Number((cfg as Record<string, any>).tier3RewardValue || 0) },
    ]
      .filter((tier) => tier.visits > 0 && tier.value > 0)
      .sort((a, b) => a.visits - b.visits);

    if (milestoneTiers.length > 1) {
      let stampCount: number;
      if (oncePerDay) {
        if (!stamps.isDayRepresentative) continue; // optimization; idempotency below is the real guard
        stampCount = stamps.distinctDayCount;
      } else {
        stampCount = stamps.totalCount;
      }

      const reachedMilestones = milestoneTiers.filter((tier) => stampCount >= tier.visits).length;
      if (reachedMilestones <= 0) continue;

      const wallet = await prisma.customerCampaignWallet.findUnique({
        where: {
          salonId_customerId_campaignId: {
            salonId: input.salonId,
            customerId: input.customerId,
            campaignId: campaign.id,
          },
        },
        select: { metadata: true, balanceAmount: true, consumedAmount: true },
      });
      const trackedCount = Number((wallet?.metadata as Record<string, any> | null)?.loyaltyRewardCount);
      // Tracked counter preferred. If absent but the wallet already has credit
      // (e.g. switched from legacy repeating mode), treat all currently-reached
      // milestones as already credited → never retroactively double-pay
      // (salon-safe under-credit at the switch). Fresh/empty wallet → 0.
      let creditedMilestones: number;
      if (Number.isFinite(trackedCount)) {
        creditedMilestones = Math.max(0, trackedCount);
      } else if (((wallet?.balanceAmount || 0) + (wallet?.consumedAmount || 0)) > 0) {
        creditedMilestones = reachedMilestones;
      } else {
        creditedMilestones = 0;
      }
      if (creditedMilestones >= reachedMilestones) continue;

      let milestoneAmount = 0;
      for (let i = creditedMilestones; i < reachedMilestones; i++) {
        milestoneAmount += milestoneTiers[i].value;
      }
      if (milestoneAmount <= 0) continue;

      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: input.customerId,
        campaignId: campaign.id,
        amount: milestoneAmount,
        expiresAt: loyaltyExpiresAt,
        metadata: {
          source: 'LOYALTY_MILESTONE',
          appointmentId: input.appointmentId,
          oncePerDay,
          loyaltyRewardCount: reachedMilestones,
        },
      });
      continue;
    }

    if (oncePerDay) {
      // Skip redundant same-day work; correctness does NOT rely on this — the
      // earned-vs-credited check below is idempotent on its own.
      if (!stamps.isDayRepresentative) continue;

      // Idempotent crediting: how many rewards the customer SHOULD have earned
      // by now (one per `threshold` distinct days) vs how many we've already
      // credited (tracked in wallet metadata). Credit only the difference.
      // Order-independent → the same-day reverse-order double-credit window is
      // closed, and it never over- or under-credits across re-runs.
      const earnedRewards = Math.floor(stamps.distinctDayCount / threshold);
      if (earnedRewards <= 0) continue;

      const wallet = await prisma.customerCampaignWallet.findUnique({
        where: {
          salonId_customerId_campaignId: {
            salonId: input.salonId,
            customerId: input.customerId,
            campaignId: campaign.id,
          },
        },
        select: { metadata: true, balanceAmount: true, consumedAmount: true },
      });
      const trackedRewardCount = Number(
        (wallet?.metadata as Record<string, any> | null)?.loyaltyRewardCount
      );
      // Prefer the tracked counter; if absent (e.g. oncePerDay was enabled on a
      // campaign that already credited via the legacy path), estimate from the
      // wallet's total credited amount so we never re-credit past rewards.
      // Use ceil for the estimate: if rewardValue changed since the legacy
      // credits, this biases toward OVER-estimating past rewards → at worst a
      // one-off under-credit (salon-safe), never an over-credit to the customer.
      const creditedRewards = Number.isFinite(trackedRewardCount)
        ? Math.max(0, trackedRewardCount)
        : Math.ceil(
            Math.max(0, (wallet?.balanceAmount || 0) + (wallet?.consumedAmount || 0)) /
              Math.max(1, rewardValue)
          );
      const owedRewards = earnedRewards - creditedRewards;
      if (owedRewards <= 0) continue;

      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: input.customerId,
        campaignId: campaign.id,
        amount: rewardValue * owedRewards,
        expiresAt: loyaltyExpiresAt,
        metadata: {
          source: 'LOYALTY_THRESHOLD',
          threshold,
          appointmentId: input.appointmentId,
          oncePerDay: true,
          loyaltyRewardCount: earnedRewards,
        },
      });
      continue;
    }

    // Only credit when THIS completion actually earned a stamp (qualifies under
    // minBill). The legacy path is non-idempotent and relies on the modulo
    // boundary being hit exactly once per new stamp; a sub-threshold completion
    // leaves the qualifying count unchanged, so without this guard it would
    // re-trigger the modulo on an unchanged count → spurious double credit.
    // minBill 0 → every appointment qualifies → guard is a no-op (old behavior).
    const currentQualifies = qualifyingAppts.some((a) => a.id === input.appointmentId);
    const completedCount = stamps.totalCount;

    if (currentQualifies && completedCount > 0 && completedCount % threshold === 0) {
      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: input.customerId,
        campaignId: campaign.id,
        amount: rewardValue,
        expiresAt: loyaltyExpiresAt,
        metadata: {
          source: 'LOYALTY_THRESHOLD',
          threshold,
          appointmentId: input.appointmentId,
        },
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

  // Referral anti-abuse: total completed appointments of the just-completed
  // (referred) customer. "Genuinely new" = exactly this one (count === 1).
  const referredCompletedCount = await prisma.appointment.count({
    where: { salonId: input.salonId, customerId: input.customerId, status: 'COMPLETED' },
  });

  for (const row of refRows) {
    const campaignId = Number(row.campaignId);
    const campaignRows = await prisma.$queryRawUnsafe<any[]>(`SELECT "config" FROM "Campaign" WHERE "id" = $1 LIMIT 1`, campaignId);
    const cfg = asObject(campaignRows?.[0]?.config);
    const referredReward = Math.max(0, Number(cfg.referredCustomerRewardValue || cfg.rewardValue || 0));
    const referrerReward = Math.max(0, Number(cfg.referrerRewardValue || cfg.rewardValue || 0));
    const referralExpiresAt = walletExpiryFromConfig(cfg as Record<string, any>);

    // Optional: only reward when the referred customer is genuinely new (no
    // prior completed appointment). Otherwise the referral is invalid → cancel
    // the attribution so it isn't retried. Config absent → no gate.
    if (Boolean((cfg as Record<string, any>).referredMustBeNew) && referredCompletedCount > 1) {
      await prisma.$executeRawUnsafe(
        `UPDATE "CampaignAttribution" SET "status" = 'CANCELLED'::"CampaignAttributionStatus", "updatedAt" = NOW() WHERE "id" = $1 AND "salonId" = $2`,
        Number(row.id),
        input.salonId,
      );
      continue;
    }

    if (referredReward > 0) {
      await createOrIncrementWalletCredit({
        salonId: input.salonId,
        customerId: input.customerId,
        campaignId,
        amount: referredReward,
        expiresAt: referralExpiresAt,
        metadata: { source: 'REFERRAL_REFERRED_COMPLETED', attributionId: Number(row.id) },
      });
    }

    if (referrerReward > 0 && Number(row.referrerCustomerId) > 0) {
      // Optional cap: how many referral rewards a single referrer can earn for
      // this campaign. Counts already-REWARDED attributions (excludes the
      // current one, still REGISTERED/PENDING here). Config absent → no cap.
      const maxPerReferrer = Math.max(0, Number((cfg as Record<string, any>).maxReferralRewardsPerReferrer || 0));
      let referrerUnderCap = true;
      if (maxPerReferrer > 0) {
        const rewardedRows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT COUNT(*)::int AS c FROM "CampaignAttribution"
           WHERE "salonId" = $1 AND "campaignId" = $2 AND "referrerCustomerId" = $3
             AND "status" = 'REWARDED'::"CampaignAttributionStatus"`,
          input.salonId,
          campaignId,
          Number(row.referrerCustomerId),
        );
        referrerUnderCap = Number(rewardedRows?.[0]?.c || 0) < maxPerReferrer;
      }
      if (referrerUnderCap) {
        await createOrIncrementWalletCredit({
          salonId: input.salonId,
          customerId: Number(row.referrerCustomerId),
          campaignId,
          amount: referrerReward,
          expiresAt: referralExpiresAt,
          metadata: { source: 'REFERRAL_REFERRER_COMPLETED', attributionId: Number(row.id), referredCustomerId: input.customerId },
        });
      }
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
          AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
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

export function shouldAutoSendCampaignType(type: string): boolean {
  const normalized = String(type || '').toUpperCase();
  return normalized === 'BIRTHDAY' || normalized === 'WINBACK' || normalized === 'WELCOME_FIRST_VISIT';
}

export function isCampaignManualPreferred(type: string): boolean {
  return isManualOnlyCampaign(String(type || '').toUpperCase());
}
