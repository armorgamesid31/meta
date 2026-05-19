/**
 * Setup Center progress computation.
 *
 * Pure aggregation over Prisma — no side effects. Callers:
 *   - GET /api/setup-center (build the dashboard payload)
 *   - lifecycle.tryGrantBonus (decide whether to auto-grant)
 *   - admin endpoints (show admin the same view as the salon)
 *
 * Designed to be cheap (one parallelized SELECT batch per call) so the
 * setup-center page can call it on every load without caching.
 */

import { prisma } from '../../prisma.js';
import {
  evaluateCriteria,
  isBonusEligible,
  computeProgressPercent,
  type CriteriaContext,
  type CriterionEvaluation,
} from '../../onboarding/criteria.js';
import { getOffer, type AcquisitionOffer } from '../../onboarding/offers.js';

export interface SetupCenterSnapshot {
  salonId: number;
  offer: AcquisitionOffer | null;
  /** True when the offer is a real one (not LEGACY_*). */
  inScope: boolean;
  evaluations: CriterionEvaluation[];
  progressPercent: number;
  bonusEligible: boolean;
  missingCriteria: CriterionEvaluation[];
}

export async function loadCriteriaContext(salonId: number): Promise<CriteriaContext | null> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      logoUrl: true,
      channelOnboardingState: true,
      paymentMethodOnFile: true,
      bookingLinkTestedAt: true,
      appointmentImportDecision: true,
      onboardingStatus: true,
      offerKey: true,
    },
  });
  if (!salon) return null;
  const offer = getOffer(salon.offerKey);
  if (!offer) return null;

  const [serviceCount, staffCount, staffServiceCount, appointmentCount, activeChannelBindings] =
    await Promise.all([
      prisma.service.count({ where: { salonId, isActive: { not: false } } }),
      prisma.staff.count({ where: { salonId } }),
      prisma.staffService.count({
        // StaffService uses lowercased `isactive` in its column name +
        // capitalized `Staff` relation per the upstream schema (see
        // prisma/schema.prisma:StaffService).
        where: { Staff: { salonId }, isactive: { not: false } as any },
      }),
      prisma.appointment.count({ where: { salonId } }),
      prisma.salonChannelBinding.findMany({ where: { salonId, isActive: true } }),
    ]);

  return {
    salon,
    serviceCount,
    staffCount,
    staffServiceCount,
    appointmentCount,
    activeChannelBindings,
    offer,
  };
}

export async function computeSetupCenterSnapshot(salonId: number): Promise<SetupCenterSnapshot> {
  const ctx = await loadCriteriaContext(salonId);
  if (!ctx) {
    return {
      salonId,
      offer: null,
      inScope: false,
      evaluations: [],
      progressPercent: 0,
      bonusEligible: false,
      missingCriteria: [],
    };
  }
  const evaluations = evaluateCriteria(ctx.offer.bonusCriteriaSet, ctx);
  return {
    salonId,
    offer: ctx.offer,
    inScope: true,
    evaluations,
    progressPercent: computeProgressPercent(evaluations),
    bonusEligible: isBonusEligible(evaluations),
    missingCriteria: evaluations.filter((e) => !e.completed),
  };
}
