/**
 * Stripe glue for the Setup Center / free-trial flow.
 *
 * The marketing-checkout flow in services/stripeBilling.ts handles
 * "owner pays up front, salon gets provisioned afterwards". This file
 * handles the new "owner signs up free, adds a payment method during
 * the trial, gets charged when the trial ends" flow.
 *
 * Two key Stripe primitives in play:
 *   1. Customer  — created lazily on first billing action; we cache the
 *                  id on SalonSubscription.stripeCustomerId.
 *   2. Subscription with trial_end — created the moment a payment
 *                  method is attached. Stripe does NOT charge until
 *                  trial_end (which we set to the salon's bonus end
 *                  date or grace end date, whichever applies). When
 *                  the trial ends, Stripe's standard subscription
 *                  webhook flow takes over.
 *
 * Why not SetupIntent + later manual subscription creation?
 *   - It would require us to write our own "trial ended, charge now"
 *     cron, duplicating Stripe's existing trial machinery.
 *   - Subscription with trial_end is the Stripe-blessed pattern for
 *     "card-on-file but no charge yet". See:
 *     https://docs.stripe.com/billing/subscriptions/trials
 *
 * The owner sees the same outcome: card collected, no charge until
 * the trial ends.
 */

import Stripe from 'stripe';
import { prisma } from '../../prisma.js';
import { getPlanByKey, getEffectivePriceId } from '../billingCatalog.js';
import { getOffer } from '../../onboarding/offers.js';

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secret) throw new Error('STRIPE_SECRET_KEY_MISSING');
  stripeClient = new Stripe(secret);
  return stripeClient;
}

/**
 * Return the most relevant trial end date for the given salon:
 * - If bonus is already granted, use setupBonusEndsAt.
 * - Otherwise use setupPeriodEndsAt.
 * - If neither is set, fall back to +14d from now (defensive).
 */
export function pickTrialEnd(salon: {
  setupPeriodEndsAt: Date | null;
  setupBonusEndsAt: Date | null;
}): Date {
  const now = new Date();
  if (salon.setupBonusEndsAt && salon.setupBonusEndsAt > now) {
    return salon.setupBonusEndsAt;
  }
  if (salon.setupPeriodEndsAt && salon.setupPeriodEndsAt > now) {
    return salon.setupPeriodEndsAt;
  }
  return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
}

async function ensureStripeCustomer(salonId: number): Promise<string> {
  const existing = await prisma.salonSubscription.findFirst({
    where: { salonId, stripeCustomerId: { not: null } },
    select: { stripeCustomerId: true },
  });
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      name: true,
      slug: true,
      memberships: {
        where: { isActive: true, role: 'OWNER' },
        include: { identity: { select: { email: true, phone: true } } },
        take: 1,
      },
    },
  });
  if (!salon) throw new Error('BILLING_SALON_NOT_FOUND');
  const owner = salon.memberships[0]?.identity;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: salon.name,
    email: owner?.email || undefined,
    phone: owner?.phone || undefined,
    metadata: {
      salonId: String(salonId),
      salonSlug: salon.slug || '',
    },
  });
  return customer.id;
}

/**
 * Create a Stripe Checkout Session for "add payment method (start
 * subscription with trial_end)". Used by the in-app billing CTA.
 *
 * The session is in mode: 'subscription' but with a future trial_end,
 * so the owner is asked to enter a card NOW but gets charged ONLY when
 * the trial expires.
 */
export async function createTrialSubscriptionCheckout(input: {
  salonId: number;
  successUrl: string;
  cancelUrl: string;
  /**
   * Opsiyonel: hangi plan key ile checkout açılacak ('profesyonel_plus'
   * veya 'profesyonel_plus_annual'). Verilmezse offer.defaultPlanKey
   * kullanılır. Kurucu Salon yıllık toggle'ı buradan akar.
   */
  planKeyOverride?: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: {
      id: true,
      offerKey: true,
      setupPeriodEndsAt: true,
      setupBonusEndsAt: true,
      campaignTier: true,
      campaignLockedMonthlyPriceId: true,
      campaignLockedAnnualPriceId: true,
    },
  });
  if (!salon) throw new Error('BILLING_SALON_NOT_FOUND');
  const offer = getOffer(salon.offerKey);
  if (!offer) throw new Error('BILLING_OFFER_OUT_OF_SCOPE');

  const planKey = (input.planKeyOverride || offer.defaultPlanKey).trim().toLowerCase();
  const plan = getPlanByKey(planKey);
  if (!plan) {
    throw new Error(`BILLING_PLAN_NOT_CONFIGURED:${planKey}`);
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(input.salonId);
  const trialEnd = pickTrialEnd(salon);

  // Kurucu Salon tier override: profesyonel_plus / profesyonel_plus_annual
  // için, salonun damgalanmış tier price id'si varsa onu kullan. Aksi
  // halde mevcut env (STRIPE_PRICE_PROFESSIONAL_PLUS / _ANNUAL) fallback.
  // tier1-3 = flat fixed amount (seat billing yok), tier4 = mevcut
  // profesyonel_plus (tiered seat billing açıksa tiered, yoksa flat).
  const isAnnual = planKey === 'profesyonel_plus_annual';
  const isMonthlyProfPlus = planKey === 'profesyonel_plus';
  const lockedPriceId = isAnnual
    ? salon.campaignLockedAnnualPriceId
    : isMonthlyProfPlus
      ? salon.campaignLockedMonthlyPriceId
      : null;
  // tier1-3 salonları seat billing'e KONULMAZ — flat quantity:1, sabit fiyat.
  // tier4 ise mevcut profesyonel_plus davranışını korur (seat tiered olabilir).
  const isCampaignFlatTier =
    salon.campaignTier === 'tier1' ||
    salon.campaignTier === 'tier2' ||
    salon.campaignTier === 'tier3';

  // KURAL 4: when the plan is tiered (seat billing on), charge the tiered
  // seat price with an initial quantity = billable seat count (raw staff
  // count, floored at 1). Otherwise keep the flat price at quantity 1.
  // computeBillableSeats is inlined here (prisma.staff.count) to avoid a
  // module cycle with seatBilling.ts (which imports getStripe from here).
  //
  // Kurucu Salon tier1-3 override: tier4'ten alt tier'larda flat fiyat —
  // seat tiered kullanılmaz (lockedPriceId zaten flat price id'sidir).
  let effectivePriceId: string;
  let initialQuantity: number;
  if (lockedPriceId) {
    effectivePriceId = lockedPriceId;
    if (isCampaignFlatTier) {
      initialQuantity = 1;
    } else {
      // tier4: planın pricingModel'ine bak. Eğer tiered seat billing
      // açıksa effectivePriceId'i seat price ile değiştir; yoksa flat.
      // lockedPriceId tier4 için zaten STRIPE_PRICE_PROFESSIONAL_PLUS
      // (flat) — seat tiered envaltında configure edildiyse onu seç.
      if (plan.pricingModel === 'tiered' && plan.seatPriceId) {
        effectivePriceId = plan.seatPriceId;
        initialQuantity = Math.max(
          1,
          await prisma.staff.count({ where: { salonId: input.salonId } }),
        );
      } else {
        initialQuantity = 1;
      }
    }
  } else {
    effectivePriceId = getEffectivePriceId(plan);
    initialQuantity =
      plan.pricingModel === 'tiered'
        ? Math.max(1, await prisma.staff.count({ where: { salonId: input.salonId } }))
        : 1;
  }

  // Stripe rejects trial_end < now + 48h with status 400 — that should
  // only happen if grace already expired, in which case we shouldn't
  // offer trial at all. Detect and fall through to immediate-charge.
  const minTrialEnd = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const useTrial = trialEnd > minTrialEnd;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: effectivePriceId, quantity: initialQuantity }],
    subscription_data: useTrial
      ? {
          trial_end: Math.floor(trialEnd.getTime() / 1000),
          // Don't cancel at trial end — let the customer be charged on
          // the recurring invoice. Owner can cancel via marketing site
          // billing portal if they don't want to continue.
          trial_settings: {
            end_behavior: { missing_payment_method: 'cancel' },
          },
        }
      : undefined,
    payment_method_collection: 'always',
    success_url: input.successUrl.includes('?')
      ? `${input.successUrl}&session_id={CHECKOUT_SESSION_ID}`
      : `${input.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
    locale: 'tr',
    metadata: {
      salonId: String(input.salonId),
      flow: 'trial_subscription',
      offerKey: offer.key,
    },
  });

  // Persist a "pending" subscription row so the webhook can match by salonId.
  await prisma.salonSubscription.upsert({
    where: {
      // No natural unique on salonId — find-or-create via salonId+status
      // is easier: use stripeCustomerId (which is unique).
      stripeCustomerId: customerId,
    },
    update: { planKey: plan.planKey, status: 'trial_checkout_pending' },
    create: {
      salonId: input.salonId,
      stripeCustomerId: customerId,
      planKey: plan.planKey,
      status: 'trial_checkout_pending',
    },
  });

  return { checkoutUrl: session.url || '', sessionId: session.id };
}

/**
 * Create a Stripe Billing Portal session so the owner can manage their
 * card / cancel / update plan. We deliberately route ALL subscription
 * management through Stripe's hosted portal — there is no in-app UI.
 */
export async function createBillingPortalForSalon(input: {
  salonId: number;
  returnUrl: string;
}): Promise<string> {
  const sub = await prisma.salonSubscription.findFirst({
    where: { salonId: input.salonId, stripeCustomerId: { not: null } },
    select: { stripeCustomerId: true },
  });
  if (!sub?.stripeCustomerId) {
    throw new Error('BILLING_NO_STRIPE_CUSTOMER');
  }
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: input.returnUrl,
  });
  return session.url;
}

/**
 * KURAL 2 — "kurulum tamamlandı → Stripe trial_end uzat".
 *
 * When the bonus is granted (or any time the DB trial clock moves out),
 * the salon's Stripe subscription trial_end may be stale: the trial
 * subscription was created at card-attach time with trial_end =
 * setupPeriodEndsAt, but the bonus pushes the real "no charge until"
 * date out to setupBonusEndsAt. If we don't sync, Stripe charges the
 * card while the salon still has free DB access — a live-money bug.
 *
 * IDEMPOTENT & SAFE-BY-CONSTRUCTION:
 *   1. No trial subscription on Stripe yet  -> no-op (DB clock governs).
 *   2. Subscription not in 'trialing' status -> no-op (never touch an
 *      active / past_due / canceled subscription).
 *   3. Read Stripe's REAL current trial_end. Only ever EXTEND it
 *      (target > current). Never shorten — shortening could trigger an
 *      early charge. Equal/smaller target -> no-op.
 *   4. Floor the target at now + 49h (Stripe rejects trial_end < ~48h).
 *   5. Idempotency-Key derived from (subscriptionId, target epoch) so a
 *      retry with the same target is a guaranteed no-op on Stripe's side.
 *
 * Best-effort: callers invoke this as `void syncTrialEndToStripe(id).catch(...)`.
 * Never throws into the caller's critical path.
 */
export async function syncTrialEndToStripe(salonId: number): Promise<{
  synced: boolean;
  reason:
    | 'no_subscription'
    | 'not_trialing'
    | 'target_not_greater'
    | 'below_min_floor'
    | 'extended';
  trialEnd?: Date;
}> {
  const sub = await prisma.salonSubscription.findFirst({
    where: { salonId, stripeSubscriptionId: { not: null } },
    select: { stripeSubscriptionId: true },
    orderBy: { id: 'desc' },
  });
  if (!sub?.stripeSubscriptionId) {
    return { synced: false, reason: 'no_subscription' };
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { setupPeriodEndsAt: true, setupBonusEndsAt: true },
  });
  if (!salon) return { synced: false, reason: 'no_subscription' };

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

  // Only ever touch a subscription that Stripe still considers a trial.
  if (subscription.status !== 'trialing') {
    return { synced: false, reason: 'not_trialing' };
  }

  const target = pickTrialEnd(salon);
  const targetEpoch = Math.floor(target.getTime() / 1000);

  // Stripe rejects trial_end < now + 48h. Keep a 49h safety margin; if the
  // computed target is already inside that window there is nothing useful to
  // extend to (the salon is at/near paywall) — leave Stripe alone.
  const minEpoch = Math.floor((Date.now() + 49 * 60 * 60 * 1000) / 1000);
  if (targetEpoch < minEpoch) {
    return { synced: false, reason: 'below_min_floor' };
  }

  // NEVER shorten. Only extend when the DB target is strictly later than
  // what Stripe currently has. Equal target on a retry => no-op.
  const currentTrialEnd = Number(subscription.trial_end || 0);
  if (targetEpoch <= currentTrialEnd) {
    return { synced: false, reason: 'target_not_greater' };
  }

  await stripe.subscriptions.update(
    sub.stripeSubscriptionId,
    {
      trial_end: targetEpoch,
      // Don't generate a proration invoice for the trial shift.
      proration_behavior: 'none',
    },
    {
      // Deterministic key: same (sub, target) => Stripe dedupes the retry.
      idempotencyKey: `trialend:${sub.stripeSubscriptionId}:${targetEpoch}`,
    },
  );

  return { synced: true, reason: 'extended', trialEnd: target };
}

export { getStripe };
