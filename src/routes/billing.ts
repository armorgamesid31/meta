import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { prisma } from '../prisma.js';
import { createPortalSession } from '../services/stripeBilling.js';
import { ensureSalonReferralCode } from '../services/referralService.js';

const router = Router();

router.get('/subscription/summary', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    return res.status(401).json({ message: 'Unauthorized.' });
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
    return res.status(401).json({ message: 'Unauthorized.' });
  }
  const subscription = await prisma.salonSubscription.findFirst({
    where: { salonId: req.user.salonId },
    orderBy: { id: 'desc' },
  });
  if (!subscription?.stripeCustomerId) {
    return res.status(404).json({ message: 'Stripe customer not found for this salon.' });
  }
  const returnUrl = String(req.body?.returnUrl || process.env.BILLING_PORTAL_RETURN_URL || '').trim();
  if (!returnUrl) {
    return res.status(400).json({ message: 'returnUrl is required.' });
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
    return res.status(401).json({ message: 'Unauthorized.' });
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
