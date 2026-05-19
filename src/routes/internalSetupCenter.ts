/**
 * Internal admin endpoints for Setup Center / trial bookkeeping.
 *
 *   GET    /internal/setup-center/salons/:id       per-salon snapshot + event log
 *   POST   /internal/setup-center/salons/:id/grant-bonus
 *   POST   /internal/setup-center/salons/:id/revoke-bonus
 *   POST   /internal/setup-center/salons/:id/extend-period
 *   POST   /internal/setup-center/run-transitions   manually trigger the daily cron
 *
 * Guarded by X-Internal-API-Key. Use these from support tooling /
 * curl. A salon-admin UI can come later as a separate workstream.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { BusinessError } from '../lib/errors.js';
import { computeSetupCenterSnapshot } from '../services/onboarding/progress.js';
import { getAccessSnapshot } from '../services/onboarding/access.js';
import {
  grantBonus,
  revokeBonus,
  extendPeriod,
  processStatusTransitions,
  type EventActor,
} from '../services/onboarding/lifecycle.js';

const router = Router();

function readSalonId(req: any): number {
  const id = Number(req.params?.id || 0);
  if (!id) throw new BusinessError('VALIDATION_FAILED', 'Geçerli salon id gerekli.', 400);
  return id;
}

function readAdminActor(req: any): EventActor {
  const headerAdmin = String(req.headers['x-admin-id'] || '').trim();
  return { type: 'admin', adminId: headerAdmin || 'internal' };
}

// -----------------------------------------------------------------------------
// GET snapshot + recent events
// -----------------------------------------------------------------------------

router.get('/salons/:id', async (req: any, res: any) => {
  const salonId = readSalonId(req);
  const [snapshot, access, events, salon] = await Promise.all([
    computeSetupCenterSnapshot(salonId),
    getAccessSnapshot(salonId),
    prisma.salonOnboardingEvent.findMany({
      where: { salonId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        slug: true,
        offerKey: true,
        setupAccessStatus: true,
        paymentMethodOnFile: true,
        setupPeriodStartedAt: true,
        setupPeriodEndsAt: true,
        setupBonusGrantedAt: true,
        setupBonusEndsAt: true,
        setupGracePeriodEndsAt: true,
        setupBonusGrantedBy: true,
      },
    }),
  ]);
  res.json({ salon, snapshot, access, events });
});

// -----------------------------------------------------------------------------
// POST grant-bonus
// -----------------------------------------------------------------------------

const grantSchema = z.object({
  reason: z.string().min(3).max(500),
  bonusDays: z.number().int().positive().max(365).optional(),
});

router.post('/salons/:id/grant-bonus', async (req: any, res: any) => {
  const salonId = readSalonId(req);
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz istek.', 400, {
      issues: parsed.error.issues,
    });
  }
  const result = await grantBonus(salonId, readAdminActor(req), parsed.data.reason, {
    bonusDays: parsed.data.bonusDays,
  });
  res.json({ ok: true, result });
});

// -----------------------------------------------------------------------------
// POST revoke-bonus
// -----------------------------------------------------------------------------

const revokeSchema = z.object({
  reason: z.string().min(3).max(500),
});

router.post('/salons/:id/revoke-bonus', async (req: any, res: any) => {
  const salonId = readSalonId(req);
  const parsed = revokeSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz istek.', 400, {
      issues: parsed.error.issues,
    });
  }
  const result = await revokeBonus(salonId, readAdminActor(req), parsed.data.reason);
  res.json({ ok: true, result });
});

// -----------------------------------------------------------------------------
// POST extend-period
// -----------------------------------------------------------------------------

const extendSchema = z.object({
  days: z.number().int().positive().max(365),
  reason: z.string().min(3).max(500),
});

router.post('/salons/:id/extend-period', async (req: any, res: any) => {
  const salonId = readSalonId(req);
  const parsed = extendSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz istek.', 400, {
      issues: parsed.error.issues,
    });
  }
  const result = await extendPeriod(salonId, readAdminActor(req), {
    days: parsed.data.days,
    reason: parsed.data.reason,
  });
  res.json({ ok: true, result });
});

// -----------------------------------------------------------------------------
// POST run-transitions  (manual trigger of the daily cron)
// -----------------------------------------------------------------------------

router.post('/run-transitions', async (_req: any, res: any) => {
  const result = await processStatusTransitions();
  res.json({ ok: true, result });
});

export default router;
