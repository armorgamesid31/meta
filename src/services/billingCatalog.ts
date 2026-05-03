export type BillingPlanConfig = {
  planKey: string;
  stripePriceId: string;
  label: string;
};

function readPlan(planKey: string, envKey: string, fallbackLabel: string): BillingPlanConfig | null {
  const stripePriceId = String(process.env[envKey] || '').trim();
  if (!stripePriceId) return null;
  return {
    planKey,
    stripePriceId,
    label: fallbackLabel,
  };
}

export function getBillingPlans(): BillingPlanConfig[] {
  return [
    readPlan('temel', 'STRIPE_PRICE_TEMEL', 'Temel'),
    readPlan('profesyonel_plus', 'STRIPE_PRICE_PROFESSIONAL_PLUS', 'Profesyonel+'),
  ].filter((item): item is BillingPlanConfig => Boolean(item));
}

export function getPlanByKey(planKey: string): BillingPlanConfig | null {
  const normalized = String(planKey || '').trim().toLowerCase();
  if (!normalized) return null;
  return getBillingPlans().find((item) => item.planKey === normalized) || null;
}
