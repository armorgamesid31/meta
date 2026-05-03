import { Router } from 'express';
import { createSubscriptionCheckoutSession } from '../services/stripeBilling.js';
import { getPlanByKey } from '../services/billingCatalog.js';

const router = Router();

router.post('/checkout/session', async (req: any, res: any) => {
  const planKey = String(req.body?.planKey || '').trim().toLowerCase();
  const ownerName = String(req.body?.ownerName || '').trim();
  const ownerEmail = String(req.body?.ownerEmail || '').trim().toLowerCase();
  const ownerPhone = String(req.body?.ownerPhone || '').trim();
  const salonNameDraft = String(req.body?.salonNameDraft || '').trim();
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

export default router;

