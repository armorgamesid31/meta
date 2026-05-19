/**
 * Setup Center REST surface (salon-facing).
 *
 *   GET    /api/setup-center                       single payload for the dashboard
 *   POST   /api/setup-center/channel-status        WA/IG self-declared state
 *   POST   /api/setup-center/booking-link-tested   one-shot "I opened my booking page" event
 *   POST   /api/setup-center/import-decision       imported|no_data_to_import
 *   POST   /api/setup-center/recheck-bonus         idempotent auto-grant attempt
 *
 * All routes require authenticateToken (mounted in server.ts). They run
 * regardless of access status so the salon can complete setup even
 * during GRACE/PAYMENT_REQUIRED — there's no point gating these.
 *
 * Stripe payment-method handoff and full subscription activation live
 * in routes/billing.ts; this file only flips paymentMethodOnFile when
 * the Stripe webhook fires.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import {
  computeSetupCenterSnapshot,
} from '../services/onboarding/progress.js';
import {
  getAccessSnapshot,
} from '../services/onboarding/access.js';
import {
  setChannelStatus,
  markBookingLinkTested,
  setImportDecision,
  tryGrantBonus,
} from '../services/onboarding/lifecycle.js';
import {
  CHANNEL_STATUS_VALUES,
  APPOINTMENT_IMPORT_DECISIONS,
} from '../onboarding/criteria.js';

const router = Router();

router.use(authenticateToken);

// -----------------------------------------------------------------------------
// GET /api/setup-center — single payload the dashboard renders from
// -----------------------------------------------------------------------------

router.get('/', async (req: any, res: any) => {
  const salonId = Number(req.user?.salonId || 0);
  if (!salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kimliği çözülemedi.', 401);
  }

  const [snapshot, access] = await Promise.all([
    computeSetupCenterSnapshot(salonId),
    getAccessSnapshot(salonId),
  ]);

  // Pull the raw channel state too so the UI can pre-fill the modal.
  const salon = await req.prisma?.salon?.findUnique?.({ where: { id: salonId } });
  // ^ req.prisma is not exposed; just re-read via prisma below.

  res.json({
    inScope: snapshot.inScope,
    offer: snapshot.offer
      ? {
          key: snapshot.offer.key,
          label: snapshot.offer.label,
          heroCopy: snapshot.offer.heroCopy,
          setupPeriodDays: snapshot.offer.setupPeriodDays,
          bonusPeriodDays: snapshot.offer.bonusPeriodDays,
          gracePeriodDays: snapshot.offer.gracePeriodDays,
          requiresPaymentMethodForBonus: snapshot.offer.requiresPaymentMethodForBonus,
          defaultPlanKey: snapshot.offer.defaultPlanKey,
        }
      : null,
    access,
    progress: {
      percent: snapshot.progressPercent,
      bonusEligible: snapshot.bonusEligible,
      criteria: snapshot.evaluations,
      missingCriteria: snapshot.missingCriteria,
    },
  });
});

// -----------------------------------------------------------------------------
// POST /api/setup-center/channel-status
// -----------------------------------------------------------------------------

const channelStatusSchema = z.object({
  channel: z.enum(['whatsapp', 'instagram']),
  status: z.enum(CHANNEL_STATUS_VALUES),
  note: z.string().max(280).optional(),
});

router.post('/channel-status', async (req: any, res: any) => {
  const salonId = Number(req.user?.salonId || 0);
  const identityId = Number(req.user?.identityId || 0);
  if (!salonId || !identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Oturum eksik.', 401);
  }
  const parsed = channelStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz kanal durumu.', 400, {
      issues: parsed.error.issues,
    });
  }

  try {
    await setChannelStatus(salonId, { type: 'salon', identityId }, parsed.data);
  } catch (err: any) {
    if (err?.message === 'CHANNEL_NOT_REALLY_CONNECTED') {
      throw new BusinessError(
        'CHANNEL_NOT_REALLY_CONNECTED',
        '"Bağlandı" durumunu seçebilmek için önce WhatsApp/Instagram entegrasyonunu tamamlamalısın.',
        409,
      );
    }
    throw err;
  }

  // Best-effort: maybe this was the last missing criterion.
  await tryGrantBonus(salonId, { type: 'salon', identityId }).catch(() => null);

  const snapshot = await computeSetupCenterSnapshot(salonId);
  res.json({
    ok: true,
    progress: {
      percent: snapshot.progressPercent,
      bonusEligible: snapshot.bonusEligible,
    },
  });
});

// -----------------------------------------------------------------------------
// POST /api/setup-center/booking-link-tested  (idempotent)
// -----------------------------------------------------------------------------

router.post('/booking-link-tested', async (req: any, res: any) => {
  const salonId = Number(req.user?.salonId || 0);
  const identityId = Number(req.user?.identityId || 0);
  if (!salonId || !identityId) throw new BusinessError('UNAUTHORIZED', 'Oturum eksik.', 401);

  await markBookingLinkTested(salonId, { type: 'salon', identityId });
  await tryGrantBonus(salonId, { type: 'salon', identityId }).catch(() => null);
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// POST /api/setup-center/import-decision
// -----------------------------------------------------------------------------

const importDecisionSchema = z.object({
  decision: z.enum(APPOINTMENT_IMPORT_DECISIONS),
});

router.post('/import-decision', async (req: any, res: any) => {
  const salonId = Number(req.user?.salonId || 0);
  const identityId = Number(req.user?.identityId || 0);
  if (!salonId || !identityId) throw new BusinessError('UNAUTHORIZED', 'Oturum eksik.', 401);

  const parsed = importDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz karar.', 400, {
      issues: parsed.error.issues,
    });
  }
  await setImportDecision(salonId, { type: 'salon', identityId }, parsed.data.decision);
  await tryGrantBonus(salonId, { type: 'salon', identityId }).catch(() => null);
  res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// POST /api/setup-center/recheck-bonus — manual trigger after Stripe redirect, etc.
// -----------------------------------------------------------------------------

router.post('/recheck-bonus', async (req: any, res: any) => {
  const salonId = Number(req.user?.salonId || 0);
  const identityId = Number(req.user?.identityId || 0);
  if (!salonId || !identityId) throw new BusinessError('UNAUTHORIZED', 'Oturum eksik.', 401);

  const result = await tryGrantBonus(salonId, { type: 'salon', identityId });
  const snapshot = await computeSetupCenterSnapshot(salonId);
  res.json({ ok: true, result, progress: { percent: snapshot.progressPercent, bonusEligible: snapshot.bonusEligible } });
});

export default router;
