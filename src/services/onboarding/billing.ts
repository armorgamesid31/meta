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
import { getPlanByKey } from '../billingCatalog.js';
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
function pickTrialEnd(salon: {
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
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const salon = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: {
      id: true,
      offerKey: true,
      setupPeriodEndsAt: true,
      setupBonusEndsAt: true,
    },
  });
  if (!salon) throw new Error('BILLING_SALON_NOT_FOUND');
  const offer = getOffer(salon.offerKey);
  if (!offer) throw new Error('BILLING_OFFER_OUT_OF_SCOPE');

  const plan = getPlanByKey(offer.defaultPlanKey);
  if (!plan) {
    throw new Error(`BILLING_PLAN_NOT_CONFIGURED:${offer.defaultPlanKey}`);
  }

  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(input.salonId);
  const trialEnd = pickTrialEnd(salon);

  // Stripe rejects trial_end < now + 48h with status 400 — that should
  // only happen if grace already expired, in which case we shouldn't
  // offer trial at all. Detect and fall through to immediate-charge.
  const minTrialEnd = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const useTrial = trialEnd > minTrialEnd;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
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

export { getStripe };
