/**
 * KURAL 3 — Referral reward payout.
 *
 * Semantics (kurucu kararı 2026-06-06):
 *   - At signup, attachReferredSalon() links the referred salon and creates
 *     a single PENDING ReferralReward for the REFERRER. Invite = QUALIFIED.
 *   - The reward only becomes real when the REFERRED salon pays its FIRST
 *     real invoice (invoice.paid, amount_paid>0, billing_reason ∈
 *     {subscription_create, subscription_cycle}). At that point we attach
 *     a 100%-off / 2-month coupon (STRIPE_COUPON_REFERRAL_2M) to the
 *     referrer's Stripe subscription. Reward → APPLIED, invite → REWARDED.
 *   - If the referrer has no Stripe subscription yet (no card), the reward
 *     stays PENDING and firstPaymentAt is recorded; we retry the apply when
 *     the referrer's subscription is created (deferred apply hook in
 *     stripeBilling customer.subscription.created).
 *
 * DOUBLE-PAYOUT IMPOSSIBLE BY CONSTRUCTION:
 *   - ReferralReward has @@unique([referralInviteId, salonId]) → only one
 *     reward row can ever exist per (invite, beneficiary).
 *   - We only apply when reward.appliedAt IS NULL (guarded read), and stamp
 *     appliedAt + invite.firstPaymentAppliedAt in the SAME transaction.
 *   - The Stripe coupon attach uses a deterministic Idempotency-Key.
 *   - Callers run inside the webhook's StripeWebhookEvent idempotency gate.
 */

import { prisma } from '../prisma.js';
import { getStripe } from './onboarding/billing.js';

const REFERRAL_COUPON_ENV = 'STRIPE_COUPON_REFERRAL_2M';

function referralCouponId(): string | null {
  const id = String(process.env[REFERRAL_COUPON_ENV] || '').trim();
  return id || null;
}

export type ReferralBillingReason = string | null | undefined;

/**
 * True only for invoices that represent a genuine subscription payment:
 * the very first charge after the trial (subscription_create) or a normal
 * renewal (subscription_cycle). Excludes one-off / manual / update invoices.
 */
export function isFirstPaymentInvoice(input: {
  amountPaid: number;
  billingReason: ReferralBillingReason;
}): boolean {
  if (!(input.amountPaid > 0)) return false;
  const reason = String(input.billingReason || '');
  return reason === 'subscription_create' || reason === 'subscription_cycle';
}

/**
 * Called from the invoice.paid webhook branch. Resolves the referred salon
 * from the Stripe customer/subscription, records firstPaymentAt (idempotent),
 * then attempts to apply the reward to the referrer.
 *
 * No-op (returns handled:false) when the paying salon was never referred.
 */
export async function handleFirstPaidInvoice(input: {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  amountPaid: number;
  billingReason: ReferralBillingReason;
}): Promise<
  | { handled: false; reason: 'not_first_payment' | 'salon_not_found' | 'not_referred' }
  | { handled: true; inviteId: number; applied: boolean; applyReason: ApplyReason }
> {
  if (!isFirstPaymentInvoice({ amountPaid: input.amountPaid, billingReason: input.billingReason })) {
    return { handled: false, reason: 'not_first_payment' };
  }

  // Resolve the paying (referred) salon from its subscription row.
  const payingSub = await prisma.salonSubscription.findFirst({
    where: {
      OR: [
        input.stripeSubscriptionId ? { stripeSubscriptionId: input.stripeSubscriptionId } : undefined,
        input.stripeCustomerId ? { stripeCustomerId: input.stripeCustomerId } : undefined,
      ].filter(Boolean) as any,
    },
    select: { salonId: true },
  });
  if (!payingSub) return { handled: false, reason: 'salon_not_found' };

  const invite = await prisma.referralInvite.findUnique({
    where: { referredSalonId: payingSub.salonId },
    select: { id: true, firstPaymentAt: true },
  });
  if (!invite) return { handled: false, reason: 'not_referred' };

  // Record firstPaymentAt once (idempotent: only set if still null).
  if (!invite.firstPaymentAt) {
    await prisma.referralInvite.updateMany({
      where: { id: invite.id, firstPaymentAt: null },
      data: { firstPaymentAt: new Date() },
    });
  }

  const apply = await applyReferralReward(invite.id);
  return { handled: true, inviteId: invite.id, applied: apply.applied, applyReason: apply.reason };
}

export type ApplyReason =
  | 'already_applied'
  | 'no_coupon_configured'
  | 'reward_missing'
  | 'referrer_no_subscription'
  | 'applied';

/**
 * Attach the referral coupon to the referrer's Stripe subscription and mark
 * the reward APPLIED. Idempotent and safe to call repeatedly (e.g. once at
 * first-payment time, and again when the referrer's subscription appears).
 *
 * Returns applied:false with a reason when nothing was (or needed to be)
 * done — notably 'referrer_no_subscription' means "leave PENDING, retry later".
 */
export async function applyReferralReward(inviteId: number): Promise<{
  applied: boolean;
  reason: ApplyReason;
}> {
  const invite = await prisma.referralInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      referrerSalonId: true,
      firstPaymentAt: true,
      firstPaymentAppliedAt: true,
      rewards: {
        select: { id: true, salonId: true, status: true, appliedAt: true },
      },
    },
  });
  if (!invite) return { applied: false, reason: 'reward_missing' };

  // Guard 1: already applied -> never pay out twice.
  if (invite.firstPaymentAppliedAt) {
    return { applied: false, reason: 'already_applied' };
  }
  // Only apply once the referred salon has actually paid.
  if (!invite.firstPaymentAt) {
    return { applied: false, reason: 'reward_missing' };
  }

  const reward = invite.rewards.find((r) => r.salonId === invite.referrerSalonId);
  if (!reward) return { applied: false, reason: 'reward_missing' };
  // Guard 2: reward row already marked applied.
  if (reward.appliedAt || reward.status === 'APPLIED') {
    return { applied: false, reason: 'already_applied' };
  }

  const couponId = referralCouponId();
  if (!couponId) {
    // Misconfiguration: don't silently mark applied. Leave PENDING + log.
    console.error('[referralReward] STRIPE_COUPON_REFERRAL_2M not configured; leaving reward PENDING', {
      inviteId,
    });
    return { applied: false, reason: 'no_coupon_configured' };
  }

  // Find the REFERRER's Stripe subscription. No subscription => the referrer
  // hasn't added a card yet; keep the reward PENDING and retry later.
  const referrerSub = await prisma.salonSubscription.findFirst({
    where: { salonId: invite.referrerSalonId, stripeSubscriptionId: { not: null } },
    select: { id: true, stripeSubscriptionId: true },
    orderBy: { id: 'desc' },
  });
  if (!referrerSub?.stripeSubscriptionId) {
    return { applied: false, reason: 'referrer_no_subscription' };
  }

  const stripe = getStripe();

  // Read existing discounts so we don't clobber a live promo; append the
  // referral coupon only if it isn't already on the subscription.
  const subscription = await stripe.subscriptions.retrieve(referrerSub.stripeSubscriptionId);
  const existingDiscounts = Array.isArray((subscription as any).discounts)
    ? ((subscription as any).discounts as Array<string | { coupon?: string | { id?: string } }>)
    : [];
  const existingCouponIds = new Set(
    existingDiscounts
      .map((d) => {
        if (typeof d === 'string') return null; // discount id, coupon unknown here
        const c = d?.coupon;
        if (!c) return null;
        return typeof c === 'string' ? c : c.id || null;
      })
      .filter(Boolean) as string[],
  );

  if (!existingCouponIds.has(couponId)) {
    const keepExisting = existingDiscounts
      .map((d) => {
        if (typeof d === 'string') return null; // can't re-specify by discount id reliably
        const c = d?.coupon;
        const cid = typeof c === 'string' ? c : c?.id || null;
        return cid ? { coupon: cid } : null;
      })
      .filter(Boolean) as Array<{ coupon: string }>;

    await stripe.subscriptions.update(
      referrerSub.stripeSubscriptionId,
      { discounts: [...keepExisting, { coupon: couponId }] },
      { idempotencyKey: `referralReward:${invite.id}:${couponId}` },
    );
  }

  // Stamp DB state in one transaction. updateMany with the appliedAt:null /
  // firstPaymentAppliedAt:null predicates makes a concurrent second apply a
  // no-op even if it raced past the guards above.
  const now = new Date();
  await prisma.$transaction([
    prisma.referralReward.updateMany({
      where: { id: reward.id, appliedAt: null },
      data: { status: 'APPLIED', appliedAt: now, stripeCouponId: couponId },
    }),
    prisma.referralInvite.updateMany({
      where: { id: invite.id, firstPaymentAppliedAt: null },
      data: { status: 'REWARDED', firstPaymentAppliedAt: now },
    }),
  ]);

  return { applied: true, reason: 'applied' };
}

/**
 * Deferred-apply hook: called when ANY salon's subscription is created.
 * If that salon is a REFERRER with a PENDING reward whose referred salon
 * already paid (firstPaymentAt set), apply it now. No-op otherwise.
 */
export async function tryApplyPendingRewardsForReferrer(referrerSalonId: number): Promise<void> {
  const invites = await prisma.referralInvite.findMany({
    where: {
      referrerSalonId,
      firstPaymentAt: { not: null },
      firstPaymentAppliedAt: null,
    },
    select: { id: true },
  });
  for (const inv of invites) {
    try {
      await applyReferralReward(inv.id);
    } catch (err) {
      console.error('[referralReward] deferred apply failed', {
        inviteId: inv.id,
        error: err instanceof Error ? err.message : err,
      });
    }
  }
}
