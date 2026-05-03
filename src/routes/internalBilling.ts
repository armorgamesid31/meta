import { Router } from 'express';
import { createSubscriptionCheckoutSession } from '../services/stripeBilling.js';
import { getPlanByKey } from '../services/billingCatalog.js';
import { prisma } from '../prisma.js';

const router = Router();

function requireInternalApiKey(req: any, res: any): boolean {
  const configured = String(process.env.INTERNAL_API_KEY || process.env.N8N_INTERNAL_API_KEY || '').trim();
  if (!configured) return true;
  const token = String(req.headers['x-internal-api-key'] || '').trim();
  if (token !== configured) {
    res.status(401).json({ message: 'Unauthorized internal access.' });
    return false;
  }
  return true;
}

router.post('/checkout/session', async (req: any, res: any) => {
  if (!requireInternalApiKey(req, res)) {
    return;
  }
  const planKey = String(req.body?.planKey || '').trim().toLowerCase();
  const ownerName = String(req.body?.ownerName || '').trim();
  const ownerEmail = String(req.body?.ownerEmail || '').trim().toLowerCase();
  const ownerPhone = String(req.body?.ownerPhone || '').trim();
  const salonNameDraft = String(req.body?.salonNameDraft || '').trim();
  const referralCode = String(req.body?.referralCode || '').trim().toUpperCase();
  const locale = String(req.body?.locale || 'tr').trim().toLowerCase();
  const successUrl = String(req.body?.successUrl || '').trim();
  const cancelUrl = String(req.body?.cancelUrl || '').trim();

  if (!planKey || !ownerName || !ownerEmail || !ownerPhone || !successUrl || !cancelUrl) {
    return res.status(400).json({ message: 'planKey, ownerName, ownerEmail, ownerPhone, successUrl and cancelUrl are required.' });
  }
  if (!getPlanByKey(planKey)) {
    return res.status(404).json({ message: 'Unknown planKey.' });
  }

  try {
    const session = await createSubscriptionCheckoutSession({
      planKey,
      ownerName,
      ownerEmail,
      ownerPhone,
      salonNameDraft,
      referralCode,
      locale,
      successUrl,
      cancelUrl,
    });
    return res.status(200).json(session);
  } catch (error: any) {
    console.error('Create checkout session error:', error);
    return res.status(500).json({ message: error?.message || 'Unable to create checkout session.' });
  }
});

router.get('/checkout/attempts', async (req: any, res: any) => {
  if (!requireInternalApiKey(req, res)) {
    return;
  }
  const status = String(req.query?.status || '').trim().toUpperCase();
  const ownerEmail = String(req.query?.ownerEmail || '').trim().toLowerCase();
  const limitRaw = Number(req.query?.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50;

  const attempts = await prisma.stripeCheckoutAttempt.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(ownerEmail ? { ownerEmail } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return res.status(200).json({ attempts });
});

export default router;
