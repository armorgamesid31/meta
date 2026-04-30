import { CampaignType } from '@prisma/client';

export const CAMPAIGN_TYPES: CampaignType[] = [
  'BIRTHDAY',
  'WINBACK',
  'WELCOME_FIRST_VISIT',
  'LOYALTY',
  'MULTI_SERVICE_DISCOUNT',
  'OFF_PEAK',
  'REFERRAL',
];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeServiceScopeList(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const normalized = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  if (normalized.length !== value.length) {
    return null;
  }

  return Array.from(new Set(normalized));
}

export function normalizeCampaignType(value: unknown): CampaignType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  const canonical = normalized === 'OFF_PEAK_FILL' ? 'OFF_PEAK' : normalized;
  return CAMPAIGN_TYPES.includes(canonical as CampaignType) ? (canonical as CampaignType) : null;
}

export function normalizePositiveLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

export function parseCampaignConfig(value: unknown): Record<string, unknown> {
  return asObject(value);
}

export function validateCampaignConfig(type: CampaignType, rawConfig: unknown): { ok: true; config: Record<string, unknown> } | { ok: false; message: string } {
  const config = { ...parseCampaignConfig(rawConfig) };
  const num = (v: unknown) => Number(v);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const requirePositive = (field: string): number | null => {
    const value = num(config[field]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  };

  if (type === 'WELCOME_FIRST_VISIT' || type === 'WINBACK' || type === 'BIRTHDAY' || type === 'MULTI_SERVICE_DISCOUNT' || type === 'OFF_PEAK') {
    const discountType = str(config.discountType) || str(config.offerType) || str(config.rewardType);
    const discountValue = requirePositive('discountValue') || requirePositive('offerValue') || requirePositive('rewardValue');
    if (!discountType || !['discount_percent', 'discount_fixed', 'fixed_amount', 'free_service'].includes(discountType)) {
      return { ok: false, message: 'config discount/offer type is invalid.' };
    }
    if (!discountValue) {
      return { ok: false, message: 'config discount/offer value must be a positive number.' };
    }
  }

  if (type === 'WINBACK') {
    const inactiveDays = requirePositive('inactiveDaysThreshold');
    if (!inactiveDays) {
      return { ok: false, message: 'config.inactiveDaysThreshold must be a positive number.' };
    }
  }

  if (type === 'MULTI_SERVICE_DISCOUNT') {
    const minServiceCount = requirePositive('minServiceCount');
    if (!minServiceCount || minServiceCount < 2) {
      return { ok: false, message: 'config.minServiceCount must be at least 2.' };
    }
  }

  if (type === 'OFF_PEAK') {
    const startHour = str(config.startHour);
    const endHour = str(config.endHour);
    if (!/^\d{2}:\d{2}$/.test(startHour) || !/^\d{2}:\d{2}$/.test(endHour)) {
      return { ok: false, message: 'config.startHour and config.endHour must be HH:mm.' };
    }
  }

  if (type === 'LOYALTY' || type === 'REFERRAL') {
    const rewardType = str(config.rewardType);
    const rewardValue = requirePositive('rewardValue');
    if (!rewardType || (rewardType !== 'discount_fixed' && rewardType !== 'discount_percent')) {
      return { ok: false, message: 'config.rewardType must be discount_fixed or discount_percent.' };
    }
    if (!rewardValue) {
      return { ok: false, message: 'config.rewardValue must be a positive number.' };
    }
  }

  if (
    type === 'WELCOME_FIRST_VISIT' ||
    type === 'BIRTHDAY' ||
    type === 'WINBACK' ||
    type === 'REFERRAL' ||
    type === 'LOYALTY' ||
    type === 'MULTI_SERVICE_DISCOUNT' ||
    type === 'OFF_PEAK'
  ) {
    const eligible = normalizeServiceScopeList(config.eligibleServiceIds);
    if (eligible === null) {
      return { ok: false, message: 'config.eligibleServiceIds must be an array of positive service ids.' };
    }

    const excluded = normalizeServiceScopeList(config.excludedServiceIds);
    if (excluded === null) {
      return { ok: false, message: 'config.excludedServiceIds must be an array of positive service ids.' };
    }

    const excludedSet = new Set<number>(excluded);
    const filteredEligible = eligible.filter((serviceId) => !excludedSet.has(serviceId));

    config.eligibleServiceIds = filteredEligible;
    config.excludedServiceIds = excluded;
  }

  return { ok: true, config };
}
