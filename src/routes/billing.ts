import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { prisma } from '../prisma.js';
import { createPortalSession } from '../services/stripeBilling.js';
import {
  createTrialSubscriptionCheckout,
  createBillingPortalForSalon,
} from '../services/onboarding/billing.js';
import { ensureSalonReferralCode } from '../services/referralService.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

/**
 * Setup-Center flow: create a Stripe Checkout Session that collects a
 * card AND starts a subscription with trial_end set to the salon's
 * bonus/setup period end. This is the in-app "ödeme yöntemi ekle" CTA.
 * The owner is redirected to Stripe-hosted checkout, completes it, and
 * lands back on `returnUrl` where we poll /api/setup-center to surface
 * the bonus celebration.
 *
 * Subscription management itself (cancel / update card / etc.) lives
 * exclusively in the Stripe-hosted billing portal — see the
 * /subscription/portal-link route below. Per product decision: there
 * is no in-app subscription management UI.
 */
router.post('/trial-subscription/checkout', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const successUrl = String(req.body?.successUrl || '').trim();
  const cancelUrl = String(req.body?.cancelUrl || '').trim();
  // Kurucu Salon: frontend Aylık/Yıllık toggle ile geçer. Sadece bilinen
  // plan key'leri kabul edilir — diğerleri offer.defaultPlanKey'e düşer.
  const rawPlanKey = String(req.body?.planKey || '').trim().toLowerCase();
  const planKeyOverride =
    rawPlanKey === 'profesyonel_plus' || rawPlanKey === 'profesyonel_plus_annual'
      ? rawPlanKey
      : undefined;
  if (!successUrl || !cancelUrl) {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'successUrl ve cancelUrl gerekli.',
      400,
    );
  }
  try {
    const result = await createTrialSubscriptionCheckout({
      salonId: Number(req.user.salonId),
      successUrl,
      cancelUrl,
      planKeyOverride,
    });
    return res.json(result);
  } catch (error: any) {
    if (error?.message === 'BILLING_OFFER_OUT_OF_SCOPE') {
      throw new BusinessError(
        'BILLING_OFFER_OUT_OF_SCOPE',
        'Bu salon mevcut deneme/abonelik teklifinin kapsamında değil. Lütfen destek ile iletişime geç.',
        409,
      );
    }
    if (error?.message?.startsWith('BILLING_PLAN_NOT_CONFIGURED')) {
      throw new BusinessError(
        'BILLING_PLAN_NOT_CONFIGURED',
        'Plan henüz Stripe tarafında yapılandırılmamış. Lütfen yöneticiyle iletişime geç.',
        503,
      );
    }
    throw error;
  }
});

/**
 * Convenience: open the billing portal for the current salon without
 * needing the marketing site to round-trip. Same destination as
 * `/subscription/portal-link`, but reads the customer id internally.
 */
router.post('/portal-link', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const returnUrl = String(req.body?.returnUrl || process.env.BILLING_PORTAL_RETURN_URL || '').trim();
  if (!returnUrl) {
    throw new BusinessError('VALIDATION_FAILED', 'returnUrl is required.', 400);
  }
  try {
    const url = await createBillingPortalForSalon({
      salonId: Number(req.user.salonId),
      returnUrl,
    });
    return res.json({ url });
  } catch (error: any) {
    if (error?.message === 'BILLING_NO_STRIPE_CUSTOMER') {
      throw new BusinessError(
        'BILLING_NO_STRIPE_CUSTOMER',
        'Bu salon için kayıtlı bir ödeme yöntemi yok. Önce kart bilgisini ekle.',
        404,
      );
    }
    throw error;
  }
});

router.get('/subscription/summary', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const subscription = await prisma.salonSubscription.findFirst({
    where: { salonId: req.user.salonId },
    orderBy: { id: 'desc' },
  });
  if (!subscription) {
    return res.status(200).json({ subscription: null });
  }
  return res.status(200).json({
    subscription: {
      planKey: subscription.planKey,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
  });
});

router.post('/subscription/portal-link', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const subscription = await prisma.salonSubscription.findFirst({
    where: { salonId: req.user.salonId },
    orderBy: { id: 'desc' },
  });
  if (!subscription?.stripeCustomerId) {
    throw new BusinessError('NOT_FOUND', 'Stripe customer not found for this salon.', 404);
  }
  const returnUrl = String(req.body?.returnUrl || process.env.BILLING_PORTAL_RETURN_URL || '').trim();
  if (!returnUrl) {
    throw new BusinessError('VALIDATION_FAILED', 'returnUrl is required.', 400);
  }

  try {
    const url = await createPortalSession({
      stripeCustomerId: subscription.stripeCustomerId,
      returnUrl,
    });
    return res.status(200).json({ url });
  } catch (error: any) {
    console.error('Create portal session error:', error);
    return res.status(500).json({ message: error?.message || 'Unable to create portal link.' });
  }
});

router.get('/referrals/me', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const salonId = Number(req.user.salonId);
  const referralCode = await ensureSalonReferralCode(salonId);

  const [qualifiedCount, rewardedCount, pendingRewardCount] = await Promise.all([
    prisma.referralInvite.count({ where: { referrerSalonId: salonId, status: 'QUALIFIED' } }),
    prisma.referralInvite.count({ where: { referrerSalonId: salonId, status: 'REWARDED' } }),
    prisma.referralReward.count({ where: { salonId, status: 'PENDING' } }),
  ]);

  return res.status(200).json({
    referralCode,
    qualifiedCount,
    rewardedCount,
    pendingRewardCount,
  });
});

export default router;
