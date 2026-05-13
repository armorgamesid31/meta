import { Router } from 'express';
import { prisma } from '../prisma.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

/**
 * GET /api/checkout/activation?session_id=cs_xxx
 *
 * Public endpoint. The Stripe checkout session id is treated as a
 * bearer-grade secret (Stripe-generated, ~60+ char opaque token), so we do
 * not require auth here. The marketing success page calls this with the
 * session_id provided by Stripe's {CHECKOUT_SESSION_ID} template
 * substitution and renders the activation code to the new owner.
 *
 * Response shape:
 *   - 200 { code, expiresAt }   when webhook has finished provisioning
 *   - 200 { pending: true }     when row exists but completedAt is null
 *                               (webhook still in flight — frontend polls)
 *   - 404                        unknown session_id
 */
router.get('/activation', async (req: any, res: any) => {
  const sessionId = String(req.query?.session_id || '').trim();
  if (!sessionId) {
    throw new BusinessError('VALIDATION_FAILED', 'session_id is required.', 400);
  }

  const attempt = await prisma.stripeCheckoutAttempt.findFirst({
    where: { stripeCheckoutSessionId: sessionId },
    select: {
      activationCode: true,
      status: true,
      completedAt: true,
      expiresAt: true,
    },
  });

  if (!attempt) {
    throw new BusinessError('NOT_FOUND', 'Checkout session not found.', 404);
  }

  if (!attempt.completedAt || !attempt.activationCode) {
    return res.status(200).json({ pending: true });
  }

  return res.status(200).json({
    code: attempt.activationCode,
    expiresAt: attempt.expiresAt,
  });
});

export default router;
