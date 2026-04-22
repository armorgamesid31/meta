import { prisma } from '../prisma.js';

export const CUSTOMER_RISK_POLICY_AUTOMATION_KEY = 'customer_risk_policy';

export type CustomerRiskPolicy = {
  autoBanEnabled: boolean;
  noShowThreshold: number;
  blockBookingWhenBanned: boolean;
};

export const DEFAULT_CUSTOMER_RISK_POLICY: CustomerRiskPolicy = {
  autoBanEnabled: false,
  noShowThreshold: 3,
  blockBookingWhenBanned: true,
};

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return fallback;
  return rounded;
}

function parseCustomerRiskPolicy(config: unknown): CustomerRiskPolicy {
  const raw = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  return {
    autoBanEnabled: toBoolean(raw.autoBanEnabled, DEFAULT_CUSTOMER_RISK_POLICY.autoBanEnabled),
    noShowThreshold: toPositiveInt(raw.noShowThreshold, DEFAULT_CUSTOMER_RISK_POLICY.noShowThreshold),
    blockBookingWhenBanned: toBoolean(raw.blockBookingWhenBanned, DEFAULT_CUSTOMER_RISK_POLICY.blockBookingWhenBanned),
  };
}

export async function getSalonCustomerRiskPolicy(salonId: number): Promise<CustomerRiskPolicy> {
  const rule = await prisma.automationRule.findUnique({
    where: {
      salonId_key: {
        salonId,
        key: CUSTOMER_RISK_POLICY_AUTOMATION_KEY,
      },
    },
    select: {
      config: true,
      isEnabled: true,
    },
  });

  const parsed = parseCustomerRiskPolicy(rule?.config);
  if (!rule) return parsed;

  // Keep compatibility with rule-level enable switch.
  if (rule.isEnabled === false) {
    return {
      ...parsed,
      autoBanEnabled: false,
    };
  }

  return parsed;
}

export async function upsertSalonCustomerRiskPolicy(
  salonId: number,
  input: Partial<CustomerRiskPolicy>,
): Promise<CustomerRiskPolicy> {
  const current = await getSalonCustomerRiskPolicy(salonId);
  const next: CustomerRiskPolicy = {
    autoBanEnabled: input.autoBanEnabled ?? current.autoBanEnabled,
    noShowThreshold: toPositiveInt(input.noShowThreshold, current.noShowThreshold),
    blockBookingWhenBanned: input.blockBookingWhenBanned ?? current.blockBookingWhenBanned,
  };

  await prisma.automationRule.upsert({
    where: {
      salonId_key: {
        salonId,
        key: CUSTOMER_RISK_POLICY_AUTOMATION_KEY,
      },
    },
    update: {
      isEnabled: true,
      config: next as any,
      name: 'Customer Risk Policy',
      description: 'No-show based auto ban and booking block policy.',
    },
    create: {
      salonId,
      key: CUSTOMER_RISK_POLICY_AUTOMATION_KEY,
      name: 'Customer Risk Policy',
      description: 'No-show based auto ban and booking block policy.',
      config: next as any,
      isEnabled: true,
    },
  });

  return next;
}
