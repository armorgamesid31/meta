/**
 * Setup Center lifecycle — the state machine that drives every salon
 * through SETUP_PERIOD -> BONUS_PERIOD -> GRACE_PERIOD -> ACTIVE_PAID
 * or -> PAYMENT_REQUIRED.
 *
 * Two entry points:
 *   - startSetupPeriod(): called once from /api/auth/register-salon
 *     immediately after the Salon row is created.
 *   - processStatusTransitions(): called by the daily cron and on
 *     demand to advance any salon whose timer has elapsed.
 *
 * Plus two operational helpers (`tryGrantBonus`, `revokeBonus`,
 * `extendPeriod`, `activatePaid`) that the REST endpoints use to react
 * to user / admin / Stripe events.
 *
 * Every state transition emits a row in SalonOnboardingEvent so support
 * can answer "why is this salon in GRACE_PERIOD?" without spelunking
 * through logs.
 */

import { Prisma, SalonAccessStatus } from '@prisma/client';
import { prisma } from '../../prisma.js';
import {
  getDefaultOffer,
  getOffer,
  DEFAULT_OFFER_KEY,
  type AcquisitionOffer,
} from '../../onboarding/offers.js';
import { computeSetupCenterSnapshot } from './progress.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type EventActor =
  | { type: 'system' }
  | { type: 'salon'; identityId: number }
  | { type: 'admin'; adminId: string };

function actorTuple(actor: EventActor): { actorType: string; actorId: string | null } {
  if (actor.type === 'system') return { actorType: 'system', actorId: null };
  if (actor.type === 'salon') return { actorType: 'salon', actorId: String(actor.identityId) };
  return { actorType: 'admin', actorId: actor.adminId };
}

async function logEvent(
  tx: Prisma.TransactionClient | typeof prisma,
  salonId: number,
  eventType: string,
  actor: EventActor,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { actorType, actorId } = actorTuple(actor);
  await tx.salonOnboardingEvent.create({
    data: {
      salonId,
      eventType,
      actorType,
      actorId,
      payload: (payload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
  });
}

// -----------------------------------------------------------------------------
// 1. Period start (called from register-salon)
// -----------------------------------------------------------------------------

/**
 * Stamp a freshly created salon with offer + period dates. Idempotent:
 * if the salon already has setupPeriodStartedAt, nothing happens.
 */
export async function startSetupPeriod(
  salonId: number,
  options: { offerKey?: string } = {},
): Promise<void> {
  const offerKey = options.offerKey || DEFAULT_OFFER_KEY;
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new Error(`LIFECYCLE_INVALID_OFFER:${offerKey}`);
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, setupPeriodStartedAt: true, offerKey: true },
  });
  if (!salon) throw new Error('LIFECYCLE_SALON_NOT_FOUND');
  if (salon.setupPeriodStartedAt) {
    return; // idempotent
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + offer.setupPeriodDays * MS_PER_DAY);

  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: {
        offerKey: offer.key,
        setupPeriodStartedAt: now,
        setupPeriodEndsAt: endsAt,
        setupAccessStatus: SalonAccessStatus.SETUP_PERIOD,
      },
    });
    await logEvent(tx, salonId, 'period_started', { type: 'system' }, {
      offerKey: offer.key,
      setupPeriodDays: offer.setupPeriodDays,
      bonusPeriodDays: offer.bonusPeriodDays,
      gracePeriodDays: offer.gracePeriodDays,
      endsAt: endsAt.toISOString(),
    });
  });
}

// -----------------------------------------------------------------------------
// 2. Bonus grant / revoke
// -----------------------------------------------------------------------------

export interface GrantBonusResult {
  granted: boolean;
  reason: 'already_granted' | 'not_eligible' | 'offer_missing' | 'granted_now';
  bonusEndsAt?: Date;
}

/**
 * Attempt to auto-grant the bonus if all criteria are met. Safe to call
 * from any endpoint that mutates a criterion-relevant field (POST
 * channel-status, POST import-decision, etc.). No-op if already
 * granted or not yet eligible.
 */
export async function tryGrantBonus(
  salonId: number,
  actor: EventActor,
): Promise<GrantBonusResult> {
  const snapshot = await computeSetupCenterSnapshot(salonId);
  if (!snapshot.inScope || !snapshot.offer) {
    return { granted: false, reason: 'offer_missing' };
  }
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { setupBonusGrantedAt: true, setupAccessStatus: true },
  });
  if (!salon) return { granted: false, reason: 'offer_missing' };
  if (salon.setupBonusGrantedAt) {
    return { granted: false, reason: 'already_granted' };
  }
  if (!snapshot.bonusEligible) {
    return { granted: false, reason: 'not_eligible' };
  }

  return doGrantBonus(salonId, snapshot.offer, actor, {
    eligibilityProof: snapshot.evaluations.map((e) => ({
      key: e.key,
      completed: e.completed,
      currentValue: e.currentValue,
    })),
  });
}

/**
 * Force-grant the bonus regardless of criteria. Used by admin tooling.
 * Still idempotent against an already-granted bonus.
 */
export async function grantBonus(
  salonId: number,
  actor: EventActor,
  reason: string,
  options: { bonusDays?: number } = {},
): Promise<GrantBonusResult> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { offerKey: true, setupBonusGrantedAt: true },
  });
  if (!salon) return { granted: false, reason: 'offer_missing' };
  const offer = getOffer(salon.offerKey);
  if (!offer) return { granted: false, reason: 'offer_missing' };
  if (salon.setupBonusGrantedAt) {
    return { granted: false, reason: 'already_granted' };
  }
  return doGrantBonus(salonId, offer, actor, {
    manualReason: reason,
    overrideBonusDays: options.bonusDays,
  });
}

async function doGrantBonus(
  salonId: number,
  offer: AcquisitionOffer,
  actor: EventActor,
  payload: Record<string, unknown>,
  options: { overrideBonusDays?: number } = {},
): Promise<GrantBonusResult> {
  const overrideDays =
    (payload as { overrideBonusDays?: number }).overrideBonusDays ?? options.overrideBonusDays;
  const bonusDays = overrideDays && overrideDays > 0 ? overrideDays : offer.bonusPeriodDays;
  const now = new Date();
  // Bonus is added on top of whatever's left of the setup period — we
  // do NOT cut the setup period short. Owner gets full 14 + 30 = 44 days
  // even if they finish criteria on day 1.
  const salonRow = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { setupPeriodEndsAt: true },
  });
  const baseEnd = salonRow?.setupPeriodEndsAt && salonRow.setupPeriodEndsAt > now
    ? salonRow.setupPeriodEndsAt
    : now;
  const bonusEndsAt = new Date(baseEnd.getTime() + bonusDays * MS_PER_DAY);

  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: {
        setupBonusEligibleAt: now,
        setupBonusGrantedAt: now,
        setupBonusEndsAt: bonusEndsAt,
        setupBonusGrantedBy: actor.type === 'admin' ? `admin:${actor.adminId}` : 'auto',
        // We stay in SETUP_PERIOD while the original 14d is running.
        // The cron flips us to BONUS_PERIOD when setupPeriodEndsAt passes.
        // This keeps the UI honest: "14 days + 30 day bonus" instead of
        // collapsing into a single bigger trial.
      },
    });
    await logEvent(tx, salonId, 'bonus_granted', actor, {
      ...payload,
      bonusDays,
      bonusEndsAt: bonusEndsAt.toISOString(),
      offerKey: offer.key,
    });
  });
  return { granted: true, reason: 'granted_now', bonusEndsAt };
}

export async function revokeBonus(
  salonId: number,
  actor: EventActor,
  reason: string,
): Promise<{ revoked: boolean }> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { setupBonusGrantedAt: true },
  });
  if (!salon?.setupBonusGrantedAt) return { revoked: false };

  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: {
        setupBonusGrantedAt: null,
        setupBonusEndsAt: null,
        setupBonusGrantedBy: null,
        setupBonusEligibleAt: null,
      },
    });
    await logEvent(tx, salonId, 'bonus_revoked', actor, { reason });
  });
  return { revoked: true };
}

// -----------------------------------------------------------------------------
// 3. Period extend (admin)
// -----------------------------------------------------------------------------

export async function extendPeriod(
  salonId: number,
  actor: EventActor,
  options: { days: number; reason: string },
): Promise<{ extended: boolean; newEndsAt?: Date; field?: string }> {
  if (options.days <= 0) return { extended: false };
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      setupAccessStatus: true,
      setupPeriodEndsAt: true,
      setupBonusEndsAt: true,
      setupGracePeriodEndsAt: true,
    },
  });
  if (!salon) return { extended: false };

  // Extend whichever clock is currently running. Falls back to the
  // setup period if the salon hasn't crossed any boundary yet.
  let field: 'setupPeriodEndsAt' | 'setupBonusEndsAt' | 'setupGracePeriodEndsAt';
  let currentEnd: Date | null;
  if (salon.setupAccessStatus === SalonAccessStatus.GRACE_PERIOD) {
    field = 'setupGracePeriodEndsAt';
    currentEnd = salon.setupGracePeriodEndsAt;
  } else if (salon.setupAccessStatus === SalonAccessStatus.BONUS_PERIOD) {
    field = 'setupBonusEndsAt';
    currentEnd = salon.setupBonusEndsAt;
  } else {
    field = 'setupPeriodEndsAt';
    currentEnd = salon.setupPeriodEndsAt;
  }

  const base = currentEnd && currentEnd > new Date() ? currentEnd : new Date();
  const newEndsAt = new Date(base.getTime() + options.days * MS_PER_DAY);

  await prisma.$transaction(async (tx) => {
    await tx.salon.update({ where: { id: salonId }, data: { [field]: newEndsAt } });
    await logEvent(tx, salonId, 'period_extended', actor, {
      field,
      days: options.days,
      reason: options.reason,
      newEndsAt: newEndsAt.toISOString(),
    });
  });
  return { extended: true, newEndsAt, field };
}

// -----------------------------------------------------------------------------
// 4. Subscription activation (called from Stripe webhook)
// -----------------------------------------------------------------------------

export async function activatePaid(
  salonId: number,
  actor: EventActor,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: { setupAccessStatus: SalonAccessStatus.ACTIVE_PAID },
    });
    await logEvent(tx, salonId, 'paid_activated', actor, payload);
  });
}

// -----------------------------------------------------------------------------
// 5. Daily status transition tick
// -----------------------------------------------------------------------------

export interface StatusTransitionResult {
  scanned: number;
  toBonus: number;
  toGrace: number;
  toPaymentRequired: number;
}

/**
 * Walk every in-scope salon and advance its access status if the
 * relevant deadline has passed. Idempotent — running it twice in a row
 * is a no-op.
 *
 * Transition map:
 *   SETUP_PERIOD, has bonus, setupPeriodEndsAt < now -> BONUS_PERIOD
 *   SETUP_PERIOD, no bonus,  setupPeriodEndsAt < now -> GRACE_PERIOD
 *   BONUS_PERIOD,            setupBonusEndsAt  < now -> GRACE_PERIOD
 *   GRACE_PERIOD,            setupGracePeriodEndsAt < now -> PAYMENT_REQUIRED
 *
 * ACTIVE_PAID / SUSPENDED / CANCELLED salons are never touched by this
 * cron — they're managed by Stripe webhooks and admin actions.
 */
export async function processStatusTransitions(now: Date = new Date()): Promise<StatusTransitionResult> {
  const result: StatusTransitionResult = {
    scanned: 0,
    toBonus: 0,
    toGrace: 0,
    toPaymentRequired: 0,
  };

  const candidates = await prisma.salon.findMany({
    where: {
      setupAccessStatus: {
        in: [
          SalonAccessStatus.SETUP_PERIOD,
          SalonAccessStatus.BONUS_PERIOD,
          SalonAccessStatus.GRACE_PERIOD,
        ],
      },
    },
    select: {
      id: true,
      offerKey: true,
      setupAccessStatus: true,
      setupPeriodEndsAt: true,
      setupBonusEndsAt: true,
      setupBonusGrantedAt: true,
      setupGracePeriodEndsAt: true,
    },
  });
  result.scanned = candidates.length;

  for (const s of candidates) {
    const offer = getOffer(s.offerKey);
    if (!offer) continue;

    try {
      if (
        s.setupAccessStatus === SalonAccessStatus.SETUP_PERIOD &&
        s.setupPeriodEndsAt &&
        s.setupPeriodEndsAt < now
      ) {
        if (s.setupBonusGrantedAt && s.setupBonusEndsAt && s.setupBonusEndsAt > now) {
          await prisma.$transaction(async (tx) => {
            await tx.salon.update({
              where: { id: s.id },
              data: { setupAccessStatus: SalonAccessStatus.BONUS_PERIOD },
            });
            await logEvent(tx, s.id, 'access_status_changed', { type: 'system' }, {
              from: 'SETUP_PERIOD',
              to: 'BONUS_PERIOD',
            });
          });
          result.toBonus++;
        } else {
          const graceEnds = new Date(now.getTime() + offer.gracePeriodDays * MS_PER_DAY);
          await prisma.$transaction(async (tx) => {
            await tx.salon.update({
              where: { id: s.id },
              data: {
                setupAccessStatus: SalonAccessStatus.GRACE_PERIOD,
                setupGracePeriodEndsAt: graceEnds,
              },
            });
            await logEvent(tx, s.id, 'grace_started', { type: 'system' }, {
              from: 'SETUP_PERIOD',
              endsAt: graceEnds.toISOString(),
              reason: 'setup_period_expired_without_bonus',
            });
          });
          result.toGrace++;
        }
        continue;
      }

      if (
        s.setupAccessStatus === SalonAccessStatus.BONUS_PERIOD &&
        s.setupBonusEndsAt &&
        s.setupBonusEndsAt < now
      ) {
        const graceEnds = new Date(now.getTime() + offer.gracePeriodDays * MS_PER_DAY);
        await prisma.$transaction(async (tx) => {
          await tx.salon.update({
            where: { id: s.id },
            data: {
              setupAccessStatus: SalonAccessStatus.GRACE_PERIOD,
              setupGracePeriodEndsAt: graceEnds,
            },
          });
          await logEvent(tx, s.id, 'grace_started', { type: 'system' }, {
            from: 'BONUS_PERIOD',
            endsAt: graceEnds.toISOString(),
            reason: 'bonus_period_expired',
          });
        });
        result.toGrace++;
        continue;
      }

      if (
        s.setupAccessStatus === SalonAccessStatus.GRACE_PERIOD &&
        s.setupGracePeriodEndsAt &&
        s.setupGracePeriodEndsAt < now
      ) {
        await prisma.$transaction(async (tx) => {
          await tx.salon.update({
            where: { id: s.id },
            data: { setupAccessStatus: SalonAccessStatus.PAYMENT_REQUIRED },
          });
          await logEvent(tx, s.id, 'access_status_changed', { type: 'system' }, {
            from: 'GRACE_PERIOD',
            to: 'PAYMENT_REQUIRED',
            reason: 'grace_expired',
          });
        });
        result.toPaymentRequired++;
        continue;
      }
    } catch (error) {
      console.error('[lifecycle] transition failed', { salonId: s.id, error });
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// 6. Direct-action helpers used by setup-center endpoints
// -----------------------------------------------------------------------------

/**
 * Idempotently set a channel's self-declared status. Validates that
 * "connected" can only be set if a real SalonChannelBinding row exists.
 */
export async function setChannelStatus(
  salonId: number,
  actor: EventActor,
  input: {
    channel: 'whatsapp' | 'instagram';
    status: 'connected' | 'pending_verification' | 'no_account_yet';
    note?: string;
  },
): Promise<void> {
  if (input.status === 'connected') {
    const channelKey = input.channel.toUpperCase();
    const binding = await prisma.salonChannelBinding.findFirst({
      where: { salonId, channel: channelKey as any, isActive: true },
    });
    if (!binding) {
      throw new Error('CHANNEL_NOT_REALLY_CONNECTED');
    }
  }
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { channelOnboardingState: true },
  });
  const current = (salon?.channelOnboardingState as Record<string, unknown> | null) || {};
  const next = {
    ...current,
    [input.channel]: {
      status: input.status,
      note: input.note?.trim() || null,
      declaredAt: new Date().toISOString(),
    },
  };
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: { channelOnboardingState: next as Prisma.InputJsonValue },
    });
    await logEvent(tx, salonId, 'channel_status_updated', actor, {
      channel: input.channel,
      status: input.status,
    });
  });
}

export async function markBookingLinkTested(salonId: number, actor: EventActor): Promise<void> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { bookingLinkTestedAt: true },
  });
  if (salon?.bookingLinkTestedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: { bookingLinkTestedAt: new Date() },
    });
    await logEvent(tx, salonId, 'booking_link_tested', actor, {});
  });
}

export async function setImportDecision(
  salonId: number,
  actor: EventActor,
  decision: 'imported' | 'no_data_to_import',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: {
        appointmentImportDecision: decision,
        appointmentImportDecidedAt: new Date(),
      },
    });
    await logEvent(tx, salonId, 'import_decision', actor, { decision });
  });
}

export async function setPaymentMethodOnFile(
  salonId: number,
  actor: EventActor,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: { paymentMethodOnFile: true, paymentMethodAddedAt: new Date() },
    });
    await logEvent(tx, salonId, 'payment_method_attached', actor, payload);
  });
}

export { DEFAULT_OFFER_KEY };
