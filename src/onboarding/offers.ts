/**
 * Acquisition offer registry.
 *
 * An "offer" is a named bundle of (period lengths, criteria set, default
 * plan, payment requirements). Every salon that signs up is stamped with
 * an offerKey on its Salon row and the lifecycle service reads the
 * matching offer to decide what to do at each tick.
 *
 * Adding a new offer (e.g. for a Black Friday promo) means:
 *   1. Append a new entry below.
 *   2. Optionally add a new criteria set in ./criteria.ts.
 *   3. Either change DEFAULT_OFFER_KEY or branch on referral code /
 *      query string at /api/auth/register-salon to assign it.
 *
 * Existing salons that came in via the old pay-first marketing checkout
 * are stamped with offerKey='LEGACY_*' (see migration backfill). The
 * lifecycle service treats LEGACY_* as a no-op.
 */

import type { CriteriaSetKey } from './criteria.js';

export interface AcquisitionOffer {
  /** Stable identifier persisted on Salon.offerKey. Never reuse. */
  readonly key: string;
  /** Human-readable label for admin tools. */
  readonly label: string;
  /** Marketing-facing one-liner shown in the Setup Center header. */
  readonly heroCopy: string;
  /** Free setup window in days (e.g. 14). */
  readonly setupPeriodDays: number;
  /** Bonus window granted when bonus criteria are met (e.g. 30). */
  readonly bonusPeriodDays: number;
  /** Soft grace period after setup/bonus ends before paywall (e.g. 7). */
  readonly gracePeriodDays: number;
  /**
   * When true, the bonus criterion `payment_method_on_file` is included.
   * The bonus cannot be auto-granted until the salon has either added a
   * payment method (Stripe SetupIntent) or started a trial subscription.
   */
  readonly requiresPaymentMethodForBonus: boolean;
  /** Plan that becomes ACTIVE_PAID after the trial. */
  readonly defaultPlanKey: 'temel' | 'profesyonel_plus';
  /** Criteria set evaluated for bonus eligibility. */
  readonly bonusCriteriaSet: CriteriaSetKey;
}

export const DEFAULT_OFFER_KEY = 'STANDARD_2026_06' as const;

const OFFERS: Record<string, AcquisitionOffer> = {
  // Aktif kampanya (2026-06): 15 gün kurulum + kurulum tamamlanınca +15 gün = toplam 30.
  STANDARD_2026_06: {
    key: 'STANDARD_2026_06',
    label: '15 gün kurulum + 15 gün bonus + 7 gün grace',
    heroCopy:
      '15 gün ücretsiz. Kurulumu 15 gün içinde tamamlarsan +15 gün daha ücretsiz — toplam 30 gün. Kart sorulmaz. Kurucu Salon kampanyası: ilk 500 salon 999 TL/ay (sonra 1.999 TL).',
    setupPeriodDays: 15,
    bonusPeriodDays: 15,
    gracePeriodDays: 7,
    // Kurucu kararı (2026-06-06, "A"): bonus için KART ŞARTI YOK — kurulum
    // tamamlanınca kart eklenmemiş olsa bile +15 gün verilir (agresif penetrasyon).
    requiresPaymentMethodForBonus: false,
    defaultPlanKey: 'profesyonel_plus',
    bonusCriteriaSet: 'STANDARD_V1_BONUS',
  },
  // Eski kampanya — SİLME: bu offerKey ile damgalı mevcut salonlar 14+30 sözleşmesinde.
  STANDARD_2026_05: {
    key: 'STANDARD_2026_05',
    label: '14 gün kurulum + 30 gün bonus + 7 gün grace',
    heroCopy:
      '14 gün ücretsiz kurulum dönemi. Kurulumu tamamlarsan +1 ay daha ücretsiz aktif kullanım kazanırsın.',
    setupPeriodDays: 14,
    bonusPeriodDays: 30,
    gracePeriodDays: 7,
    requiresPaymentMethodForBonus: true,
    defaultPlanKey: 'profesyonel_plus',
    bonusCriteriaSet: 'STANDARD_V1_BONUS',
  },
};

/**
 * Look up an offer by key. Returns null for legacy offers (LEGACY_*) and
 * unknown keys — callers should treat null as "out of scope, leave salon
 * alone".
 */
export function getOffer(offerKey: string | null | undefined): AcquisitionOffer | null {
  if (!offerKey) return null;
  if (offerKey.startsWith('LEGACY_')) return null;
  return OFFERS[offerKey] || null;
}

/**
 * Resolve the default offer for new signups. Centralized so we can swap
 * default campaigns without editing every call site.
 */
export function getDefaultOffer(): AcquisitionOffer {
  const offer = OFFERS[DEFAULT_OFFER_KEY];
  if (!offer) {
    throw new Error(`DEFAULT_OFFER_MISSING:${DEFAULT_OFFER_KEY}`);
  }
  return offer;
}

export function listOffers(): AcquisitionOffer[] {
  return Object.values(OFFERS);
}
