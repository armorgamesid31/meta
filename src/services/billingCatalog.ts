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
    readPlan('launch', 'STRIPE_PRICE_LAUNCH', 'Launch'),
    readPlan('studio', 'STRIPE_PRICE_STUDIO', 'Studio'),
    readPlan('signature', 'STRIPE_PRICE_SIGNATURE', 'Signature'),
  ].filter((item): item is BillingPlanConfig => Boolean(item));
}

export function getPlanByKey(planKey: string): BillingPlanConfig | null {
  const normalized = String(planKey || '').trim().toLowerCase();
  if (!normalized) return null;
  return getBillingPlans().find((item) => item.planKey === normalized) || null;
}

