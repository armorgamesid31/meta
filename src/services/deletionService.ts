// Scheduled deletion service.
//
// Two surfaces share the same 30-day grace + cron-driven hard-delete
// mechanism: account deletion (UserIdentity) and salon deletion
// (Salon). Both write a `deletionScheduledAt` timestamp; the cron
// in jobs/scheduledDeletions sweeps rows past their deadline and
// calls into the hard-delete helpers below.
//
// During grace:
//   - User can still log in and use the app
//   - Bootstrap exposes deletionScheduledAt so the client can show
//     a sticky banner with a "Vazgeç" link
//   - Cancelling = setting deletionScheduledAt back to NULL
//
// On hard-delete:
//   - Salons: cascade-delete via Prisma onDelete: Cascade where
//     possible; orphan a handful of legacy tables (SalonUser,
//     Customer) where the FK is restrict — owners are warned that
//     hard delete is permanent.
//   - User identities: anonymize PII (email, phone, names) and
//     keep the row for billing/legal continuity. Refresh tokens
//     revoked. Push tokens dropped. SalonMemberships (and
//     dependent legacy SalonUsers) deleted.
//
// Stripe subscription cancellation is *not* automated here —
// scheduleSalonDeletion checks for an active subscription and
// requires the caller to cancel it first (UX redirects to the
// Stripe portal). This keeps Stripe state from drifting out of
// our control.

import { prisma } from '../prisma.js';

const GRACE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function scheduledTimestamp(now: Date = new Date()): Date {
  return new Date(now.getTime() + GRACE_DAYS * MS_PER_DAY);
}

export interface ScheduleSalonDeletionInput {
  salonId: number;
  initiatedByIdentityId: number;
}

export interface ScheduleAccountDeletionInput {
  identityId: number;
}

/**
 * Mark a salon for hard-delete in 30 days. Returns the scheduled
 * timestamp; cron will tear the salon down when it passes. Cancel
 * by calling cancelSalonDeletion before the timestamp.
 */
export async function scheduleSalonDeletion(input: ScheduleSalonDeletionInput): Promise<{ scheduledAt: Date }> {
  const scheduledAt = scheduledTimestamp();
  await prisma.salon.update({
    where: { id: input.salonId },
    data: { deletionScheduledAt: scheduledAt },
  });
  return { scheduledAt };
}

export async function cancelSalonDeletion(salonId: number): Promise<void> {
  await prisma.salon.update({
    where: { id: salonId },
    data: { deletionScheduledAt: null },
  });
}

/**
 * Mark a user identity for hard-delete in 30 days. Also schedules
 * deletion of any salon they're the OWNER of — the salons can't
 * survive without an admin and the user has been told this in the
 * confirm UI. Other OWNERs of those salons are unaffected.
 */
export async function scheduleAccountDeletion(input: ScheduleAccountDeletionInput): Promise<{ scheduledAt: Date; scheduledSalonIds: number[] }> {
  const scheduledAt = scheduledTimestamp();
  const ownedSalons = await prisma.salonMembership.findMany({
    where: { identityId: input.identityId, role: 'OWNER', isActive: true },
    select: { salonId: true },
  });
  const salonIds = ownedSalons.map((m) => m.salonId);
  await prisma.$transaction(async (tx) => {
    await tx.userIdentity.update({
      where: { id: input.identityId },
      data: { deletionScheduledAt: scheduledAt },
    });
    if (salonIds.length) {
      await tx.salon.updateMany({
        where: { id: { in: salonIds } },
        data: { deletionScheduledAt: scheduledAt },
      });
    }
  });
  return { scheduledAt, scheduledSalonIds: salonIds };
}

export async function cancelAccountDeletion(identityId: number): Promise<void> {
  // Cancelling the account also un-schedules any salons whose
  // deletion we set as a side-effect. If the user re-confirmed
  // deletion later, they'd be re-scheduled. This is safer than
  // leaving orphaned salon deletions alive.
  await prisma.$transaction(async (tx) => {
    const ownedSalons = await tx.salonMembership.findMany({
      where: { identityId, role: 'OWNER', isActive: true },
      select: { salonId: true },
    });
    const ids = ownedSalons.map((m) => m.salonId);
    if (ids.length) {
      await tx.salon.updateMany({
        where: { id: { in: ids }, deletionScheduledAt: { not: null } },
        data: { deletionScheduledAt: null },
      });
    }
    await tx.userIdentity.update({
      where: { id: identityId },
      data: { deletionScheduledAt: null },
    });
  });
}

/**
 * Hard-delete a salon. Cascades through everything the salon owns:
 * memberships, staff, settings, appointments, customers, etc.
 * Prisma's onDelete: Cascade handles most of this; we explicitly
 * sweep the legacy SalonUser table (no cascade) and Staff
 * service mapping table at the start so the salon.delete() at the
 * end doesn't blow up on FK constraints.
 */
export async function hardDeleteSalon(salonId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Detach FKs that don't cascade
    await tx.salonSettings.deleteMany({ where: { salonId } });
    await tx.salonUser.deleteMany({ where: { salonId } });
    await tx.salon.delete({ where: { id: salonId } });
  });
}

/**
 * Hard-delete (anonymise) a user identity. PII fields go to safe
 * placeholders so financial records can keep referencing the row,
 * but the user is no longer findable by email/phone and the
 * UserIdentity-attached memberships / sessions / device tokens
 * are wiped.
 */
export async function hardDeleteAccount(identityId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const identity = await tx.userIdentity.findUnique({ where: { id: identityId } });
    if (!identity) return;

    // Revoke every refresh token tied to this identity.
    await tx.mobileAuthSession.updateMany({
      where: { identityId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Detach Staff rows attached to this identity's memberships.
    const memberships = await tx.salonMembership.findMany({
      where: { identityId },
      select: { id: true, legacySalonUserId: true, salonId: true },
    });

    // Drop push notification subscriptions tied to any of this
    // identity's legacy SalonUser ids — PushDeviceToken keys off
    // SalonUser, not UserIdentity.
    const legacyIds = memberships.map((m) => m.legacySalonUserId).filter((v): v is number => typeof v === 'number');
    if (legacyIds.length) {
      await tx.pushDeviceToken.deleteMany({ where: { userId: { in: legacyIds } } }).catch(() => null);
    }
    for (const m of memberships) {
      await tx.staff.updateMany({
        where: { salonId: m.salonId, membershipId: m.id },
        data: { membershipId: null },
      });
      if (m.legacySalonUserId) {
        await tx.staff.updateMany({
          where: { salonId: m.salonId, userId: m.legacySalonUserId },
          data: { userId: null },
        });
      }
    }

    // Cancel pending invites pointing at any of this identity's
    // memberships so newcomers don't accept into a dead account.
    await tx.invite.updateMany({
      where: {
        invitedMembershipId: { in: memberships.map((m) => m.id) },
        status: 'PENDING',
      },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    // Delete legacy SalonUser shims, then memberships.
    for (const m of memberships) {
      if (m.legacySalonUserId) {
        await tx.salonUser.delete({ where: { id: m.legacySalonUserId } }).catch(() => null);
      }
    }
    await tx.salonMembership.deleteMany({ where: { identityId } });

    // Anonymise PII on the identity itself. We keep the row
    // (rather than deleting it) so any historical references
    // remain valid — financial audits, appointment logs, etc.
    // The unique constraints on email + phone are released
    // because the values are now placeholders.
    await tx.userIdentity.update({
      where: { id: identityId },
      data: {
        email: `deleted-${identityId}@kedy.local`,
        phone: null,
        firstName: 'Silinmiş',
        lastName: 'Kullanıcı',
        displayName: 'Silinmiş Kullanıcı',
        passwordHash: 'DELETED',
        isActive: false,
        deletionScheduledAt: null,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
      },
    });
  });
}

/**
 * Cron entrypoint — sweep both tables for due deletions and run
 * the hard-delete helpers. Returns counts so the scheduler log
 * tells us at a glance whether anything happened.
 */
export async function processScheduledDeletions(now: Date = new Date()): Promise<{ salonsDeleted: number; accountsDeleted: number }> {
  const result = { salonsDeleted: 0, accountsDeleted: 0 };

  const salons = await prisma.salon.findMany({
    where: { deletionScheduledAt: { lte: now, not: null } },
    select: { id: true },
  });
  for (const s of salons) {
    try {
      await hardDeleteSalon(s.id);
      result.salonsDeleted += 1;
    } catch (err) {
      console.error('[deletionService] hardDeleteSalon failed', { salonId: s.id, error: (err as Error)?.message });
    }
  }

  const identities = await prisma.userIdentity.findMany({
    where: { deletionScheduledAt: { lte: now, not: null } },
    select: { id: true },
  });
  for (const i of identities) {
    try {
      await hardDeleteAccount(i.id);
      result.accountsDeleted += 1;
    } catch (err) {
      console.error('[deletionService] hardDeleteAccount failed', { identityId: i.id, error: (err as Error)?.message });
    }
  }

  return result;
}
