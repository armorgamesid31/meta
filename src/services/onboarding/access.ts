/**
 * Access control helpers tied to SalonAccessStatus.
 *
 * The rule is simple: SETUP_PERIOD / BONUS_PERIOD / GRACE_PERIOD /
 * ACTIVE_PAID = full access; PAYMENT_REQUIRED / SUSPENDED / CANCELLED =
 * blocked except for billing & setup-center endpoints (so the user can
 * actually pay and get unblocked).
 *
 * The middleware here is intentionally narrow — it does NOT replace the
 * existing permission checks in middleware/access.ts. It runs after
 * authenticateToken and only blocks based on the access status.
 */

import { SalonAccessStatus } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { BusinessError } from '../../lib/errors.js';

export const ACTIVE_STATUSES: readonly SalonAccessStatus[] = [
  SalonAccessStatus.SETUP_PERIOD,
  SalonAccessStatus.BONUS_PERIOD,
  SalonAccessStatus.GRACE_PERIOD,
  SalonAccessStatus.ACTIVE_PAID,
] as const;

const BLOCKED_STATUSES: readonly SalonAccessStatus[] = [
  SalonAccessStatus.PAYMENT_REQUIRED,
  SalonAccessStatus.SUSPENDED,
  SalonAccessStatus.CANCELLED,
] as const;

export function isAccessActive(status: SalonAccessStatus): boolean {
  return (ACTIVE_STATUSES as readonly SalonAccessStatus[]).includes(status);
}

export function isAccessBlocked(status: SalonAccessStatus): boolean {
  return (BLOCKED_STATUSES as readonly SalonAccessStatus[]).includes(status);
}

/**
 * Snapshot read for the bootstrap response. The mobile/admin app uses
 * this to render the right banner ("setup ends in 3 days", "grace
 * started, add payment method", "subscription required to continue").
 */
export interface AccessSnapshot {
  status: SalonAccessStatus;
  offerKey: string | null;
  setupPeriodStartedAt: string | null;
  setupPeriodEndsAt: string | null;
  setupBonusGrantedAt: string | null;
  setupBonusEndsAt: string | null;
  setupGracePeriodEndsAt: string | null;
  paymentMethodOnFile: boolean;
  daysLeftInCurrentWindow: number | null;
  blocking: boolean;
  blockingReason: 'payment_required' | 'suspended' | 'cancelled' | null;
}

function daysBetween(future: Date | null | undefined, now: Date): number | null {
  if (!future) return null;
  const ms = future.getTime() - now.getTime();
  if (ms < 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export async function getAccessSnapshot(salonId: number, now: Date = new Date()): Promise<AccessSnapshot | null> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      offerKey: true,
      setupAccessStatus: true,
      setupPeriodStartedAt: true,
      setupPeriodEndsAt: true,
      setupBonusGrantedAt: true,
      setupBonusEndsAt: true,
      setupGracePeriodEndsAt: true,
      paymentMethodOnFile: true,
    },
  });
  if (!salon) return null;

  let daysLeft: number | null = null;
  switch (salon.setupAccessStatus) {
    case SalonAccessStatus.SETUP_PERIOD:
      daysLeft = daysBetween(salon.setupPeriodEndsAt, now);
      break;
    case SalonAccessStatus.BONUS_PERIOD:
      daysLeft = daysBetween(salon.setupBonusEndsAt, now);
      break;
    case SalonAccessStatus.GRACE_PERIOD:
      daysLeft = daysBetween(salon.setupGracePeriodEndsAt, now);
      break;
    default:
      daysLeft = null;
  }

  const blocking = isAccessBlocked(salon.setupAccessStatus);
  let blockingReason: AccessSnapshot['blockingReason'] = null;
  if (salon.setupAccessStatus === SalonAccessStatus.PAYMENT_REQUIRED) blockingReason = 'payment_required';
  else if (salon.setupAccessStatus === SalonAccessStatus.SUSPENDED) blockingReason = 'suspended';
  else if (salon.setupAccessStatus === SalonAccessStatus.CANCELLED) blockingReason = 'cancelled';

  return {
    status: salon.setupAccessStatus,
    offerKey: salon.offerKey,
    setupPeriodStartedAt: salon.setupPeriodStartedAt?.toISOString() || null,
    setupPeriodEndsAt: salon.setupPeriodEndsAt?.toISOString() || null,
    setupBonusGrantedAt: salon.setupBonusGrantedAt?.toISOString() || null,
    setupBonusEndsAt: salon.setupBonusEndsAt?.toISOString() || null,
    setupGracePeriodEndsAt: salon.setupGracePeriodEndsAt?.toISOString() || null,
    paymentMethodOnFile: salon.paymentMethodOnFile,
    daysLeftInCurrentWindow: daysLeft,
    blocking,
    blockingReason,
  };
}

/**
 * Express middleware that blocks requests when the salon is in a
 * paywalled state. Must run AFTER authenticateToken (so req.salonId is
 * populated) and BEFORE the route handler.
 *
 * Salons in PAYMENT_REQUIRED can still reach paths that allow them to
 * resolve the block — billing checkout, setup-center read, auth refresh
 * — by mounting this middleware selectively rather than globally.
 */
export async function requireActiveAccess(req: any, _res: any, next: any): Promise<void> {
  try {
    const salonId = Number(req.user?.salonId || req.salonId || 0);
    if (!salonId) {
      throw new BusinessError('UNAUTHORIZED', 'Salon kimliği çözülemedi.', 401);
    }
    const snapshot = await getAccessSnapshot(salonId);
    if (!snapshot) {
      throw new BusinessError('NOT_FOUND', 'Salon bulunamadı.', 404);
    }
    if (snapshot.blocking) {
      throw new BusinessError('PAYMENT_REQUIRED', 'Aboneliğin aktif değil.', 402, {
        accessStatus: snapshot.status,
        blockingReason: snapshot.blockingReason,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
}
