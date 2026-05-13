/**
 * Plan-based feature flag catalog.
 *
 * Frontend (mobile app) reads `features: string[]` from the bootstrap
 * response to decide which UI surfaces to render. Keep keys stable —
 * removing one is a breaking change for older app builds.
 *
 * Plan keys here match `SalonSubscription.planKey` values produced by the
 * billing flow (`src/services/billingCatalog.ts`):
 *   - 'temel'             -> Temel plan (entry tier)
 *   - 'profesyonel_plus'  -> Profesyonel+ plan (everything in Temel + advanced)
 */

const TEMEL_FEATURES: readonly string[] = [
  'salon_management',
  'online_booking',
  'whatsapp_connect',
  'whatsapp_reminders',
  'whatsapp_share',
  'basic_reports',
  'team_management',
  'customer_crm',
];

const PRO_PLUS_EXTRA_FEATURES: readonly string[] = [
  'whatsapp_interactive_buttons',
  'whatsapp_location_button',
  'whatsapp_ai_assistant',
  'instagram_ai_assistant',
  'noshow_automation',
  'waitlist_automation',
  'birthday_automation',
  'satisfaction_survey',
  'google_review_automation',
  'advanced_reports',
  'priority_support',
];

const PRO_PLUS_FEATURES: readonly string[] = [
  ...TEMEL_FEATURES,
  ...PRO_PLUS_EXTRA_FEATURES,
];

export type PlanKey = 'temel' | 'profesyonel_plus';

function normalizePlanKey(planKey: string | null | undefined): PlanKey {
  const normalized = String(planKey || '').trim().toLowerCase();
  if (normalized === 'profesyonel_plus' || normalized === 'pro_plus' || normalized === 'professional_plus') {
    return 'profesyonel_plus';
  }
  // Default fallback: Temel (safe degrade — gives the minimum feature set).
  return 'temel';
}

/**
 * Returns the feature catalog for the given plan key.
 *
 * Unknown / empty plan keys fall back to the Temel feature set so the
 * mobile UI is never blank for legacy or in-trial salons.
 */
export function getFeaturesForPlan(planKey: string | null | undefined): string[] {
  const plan = normalizePlanKey(planKey);
  if (plan === 'profesyonel_plus') {
    return [...PRO_PLUS_FEATURES];
  }
  return [...TEMEL_FEATURES];
}

/**
 * Convenience: returns true if the given plan grants `featureKey`.
 */
export function planHasFeature(planKey: string | null | undefined, featureKey: string): boolean {
  return getFeaturesForPlan(planKey).includes(featureKey);
}
