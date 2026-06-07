import { prisma } from '../prisma.js';

// ─────────────────────────────────────────────────────────────────────
// Platform access — cross-tenant Kedy staff (admin / technical support).
//
// An ordinary account reaches a salon through a SalonMembership. A
// *platform* account instead carries UserIdentity.platformRole and may
// enter ANY active salon without a membership. This module is the single
// source of truth for "is this account a platform operator, and what may
// it do" so the login route, the auth middleware, and refresh rotation
// all agree.
//
// Design note (orchestrator decision): both tiers currently grant the
// SAME effective access. PLATFORM_SUPPORT exists so we can later narrow
// it (e.g. read-only) by editing ONLY this file — the rest of the code
// branches on "is platform", not on the specific tier.
// ─────────────────────────────────────────────────────────────────────

export const PLATFORM_ROLES = ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}

// The salon-scoped role a platform operator assumes once inside a salon.
// OWNER bypasses every per-salon permission check (see accessControl
// getEffectivePermissionSet → roles.includes('OWNER')), so the operator
// gets full access without a SalonMembership or any seeded role rows.
export const PLATFORM_EFFECTIVE_ROLE = 'OWNER';

// AccessAuditLog.action values for platform events (kept here so the
// audit dashboard and any alerting can match on stable strings).
export const PLATFORM_AUDIT_ACTION_ENTER = 'platform.salon.enter';

// Authoritative check, read straight from the DB. We deliberately do NOT
// trust the JWT's platformRole claim for authorization on its own: a token
// minted before the flag was revoked (or the account deactivated) must stop
// working immediately, so every privileged path re-reads the live value.
export async function getActivePlatformRole(
  identityId: number,
): Promise<PlatformRole | null> {
  if (!identityId || !Number.isInteger(identityId) || identityId <= 0) return null;
  const identity = await prisma.userIdentity.findUnique({
    where: { id: identityId },
    select: { isActive: true, platformRole: true },
  });
  if (!identity || identity.isActive !== true) return null;
  return isPlatformRole(identity.platformRole) ? (identity.platformRole as PlatformRole) : null;
}

// Confirms a salon may be entered by a platform operator: it must exist,
// be ACTIVE (not PENDING/SUSPENDED), and not be scheduled for deletion.
// Returns a light salon summary for the response, or null if off-limits.
export async function resolveEnterableSalon(salonId: number): Promise<
  { id: number; name: string; slug: string | null; logoUrl: string | null } | null
> {
  if (!salonId || !Number.isInteger(salonId) || salonId <= 0) return null;
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      status: true,
      deletionScheduledAt: true,
    },
  });
  if (!salon) return null;
  if (salon.status !== 'ACTIVE') return null;
  if (salon.deletionScheduledAt) return null;
  return { id: salon.id, name: salon.name, slug: salon.slug, logoUrl: salon.logoUrl };
}
