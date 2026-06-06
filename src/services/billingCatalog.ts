export type BillingPricingModel = 'flat' | 'tiered';

export type BillingPlanConfig = {
  planKey: string;
  stripePriceId: string;
  label: string;
  /**
   * KURAL 4 — how the recurring price is billed:
   *   'flat'   => fixed price, quantity always 1 (current behavior).
   *   'tiered' => graduated per-seat price (seatPriceId); subscription
   *               quantity = billable seat count (staff count).
   */
  pricingModel: BillingPricingModel;
  /**
   * Tiered (graduated) per-seat price id, only set when a tiered seat price
   * is configured for this plan AND seat billing is enabled. When present,
   * checkout/quantity-sync use this price instead of stripePriceId.
   */
  seatPriceId: string | null;
};

/**
 * Master switch for KURAL 4 seat-based billing. OFF unless
 * SEAT_BILLING_ENABLED === 'true'. While off, every plan reports
 * pricingModel:'flat' and seatPriceId:null, so nothing changes.
 */
export function isSeatBillingEnabled(): boolean {
  return String(process.env.SEAT_BILLING_ENABLED || '').trim().toLowerCase() === 'true';
}

function readPlan(
  planKey: string,
  envKey: string,
  fallbackLabel: string,
  options: { seatPriceEnvKey?: string } = {},
): BillingPlanConfig | null {
  const stripePriceId = String(process.env[envKey] || '').trim();
  if (!stripePriceId) return null;

  const seatPriceId = options.seatPriceEnvKey
    ? String(process.env[options.seatPriceEnvKey] || '').trim() || null
    : null;
  // Only treat the plan as tiered when seat billing is globally enabled AND a
  // seat price id is actually configured — otherwise fall back to flat.
  const tiered = isSeatBillingEnabled() && Boolean(seatPriceId);

  return {
    planKey,
    stripePriceId,
    label: fallbackLabel,
    pricingModel: tiered ? 'tiered' : 'flat',
    seatPriceId: tiered ? seatPriceId : null,
  };
}

export function getBillingPlans(): BillingPlanConfig[] {
  return [
    readPlan('temel', 'STRIPE_PRICE_TEMEL', 'Temel'),
    readPlan('profesyonel_plus', 'STRIPE_PRICE_PROFESSIONAL_PLUS', 'Profesyonel+', {
      seatPriceEnvKey: 'STRIPE_PRICE_PROFESSIONAL_PLUS_SEAT_TIERED',
    }),
    // Kurucu Salon Yıllık: aynı feature paketi, yıllık faturalama, ömür boyu kilit.
    // Seat tiered yok (yıllık peşin = sabit fiyat). Frontend toggle ile seçilir.
    readPlan('profesyonel_plus_annual', 'STRIPE_PRICE_PROFESSIONAL_PLUS_ANNUAL', 'Kedy Yıllık (Kurucu Salon)'),
  ].filter((item): item is BillingPlanConfig => Boolean(item));
}

export function getPlanByKey(planKey: string): BillingPlanConfig | null {
  const normalized = String(planKey || '').trim().toLowerCase();
  if (!normalized) return null;
  return getBillingPlans().find((item) => item.planKey === normalized) || null;
}

/**
 * The price id to actually charge for a plan: the tiered seat price when the
 * plan is tiered (seat billing on), otherwise the flat price. Centralized so
 * checkout + quantity sync agree.
 */
export function getEffectivePriceId(plan: BillingPlanConfig): string {
  return plan.pricingModel === 'tiered' && plan.seatPriceId ? plan.seatPriceId : plan.stripePriceId;
}
