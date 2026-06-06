/**
 * KURAL 4 — seat-based (per-employee) billing for profesyonel_plus.
 *
 * Model (kurucu kararı 2026-06-06): tiered single-price (M1), graduated:
 *   tier1: up_to 5 employees  -> flat 999 TRY/month
 *   tier2: each extra employee -> +150 TRY/month
 * The Stripe price is graduated, so we only ever set the subscription
 * QUANTITY = billable seat count and Stripe computes the tier math.
 *
 * "Employee" = raw prisma.staff.count({ where:{ salonId } }) (kurucu kararı).
 *
 * SAFETY — highest mis-billing risk of the four rules, so:
 *   - Globally gated by SEAT_BILLING_ENABLED (isSeatBillingEnabled()).
 *     OFF => every helper is a no-op.
 *   - Only ever touches a subscription that is ALREADY on the tiered seat
 *     price. Never migrates a flat subscription to tiered (that only
 *     happens at checkout with the tiered price selected).
 *   - "Read real Stripe quantity, compare to target, equal => do nothing."
 *   - proration_behavior: 'create_prorations'.
 *   - Deterministic Idempotency-Key on the update.
 *   - Best-effort callers: void syncSubscriptionQuantity(id).catch(...).
 */

import { prisma } from '../prisma.js';
import { getStripe } from './onboarding/billing.js';
import { getPlanByKey, isSeatBillingEnabled } from './billingCatalog.js';

/**
 * Billable seat count for a salon = raw staff count, floored at 1 (Stripe
 * subscription quantity must be >= 1; a 0-staff salon still owes tier1 flat).
 */
export async function computeBillableSeats(salonId: number): Promise<number> {
  const count = await prisma.staff.count({ where: { salonId } });
  return Math.max(1, count);
}

export type SyncSeatReason =
  | 'disabled'
  | 'no_subscription'
  | 'plan_not_tiered'
  | 'subscription_not_on_seat_price'
  | 'quantity_unchanged'
  | 'updated';

/**
 * Reconcile the salon's Stripe subscription quantity with its billable seat
 * count. Idempotent + no-op unless seat billing is enabled, the plan is
 * tiered, and the live subscription is on the tiered seat price.
 */
export async function syncSubscriptionQuantity(salonId: number): Promise<{
  synced: boolean;
  reason: SyncSeatReason;
  quantity?: number;
}> {
  if (!isSeatBillingEnabled()) {
    return { synced: false, reason: 'disabled' };
  }

  const sub = await prisma.salonSubscription.findFirst({
    where: { salonId, stripeSubscriptionId: { not: null } },
    select: { stripeSubscriptionId: true, planKey: true },
    orderBy: { id: 'desc' },
  });
  if (!sub?.stripeSubscriptionId) {
    return { synced: false, reason: 'no_subscription' };
  }

  const plan = getPlanByKey(sub.planKey);
  if (!plan || plan.pricingModel !== 'tiered' || !plan.seatPriceId) {
    return { synced: false, reason: 'plan_not_tiered' };
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

  // Locate the subscription item that carries the tiered seat price. If the
  // live subscription isn't on the seat price (e.g. still flat), do nothing:
  // changing quantity on a flat price would mis-bill.
  const seatItem = subscription.items.data.find((it) => it.price?.id === plan.seatPriceId);
  if (!seatItem) {
    return { synced: false, reason: 'subscription_not_on_seat_price' };
  }

  const targetQty = await computeBillableSeats(salonId);
  const currentQty = Number(seatItem.quantity || 0);
  if (currentQty === targetQty) {
    return { synced: false, reason: 'quantity_unchanged' };
  }

  await stripe.subscriptions.update(
    sub.stripeSubscriptionId,
    {
      items: [{ id: seatItem.id, quantity: targetQty }],
      proration_behavior: 'create_prorations',
    },
    { idempotencyKey: `seatqty:${seatItem.id}:${targetQty}` },
  );

  return { synced: true, reason: 'updated', quantity: targetQty };
}
