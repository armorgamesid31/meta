/**
 * Profile resolver for Staff rows after the cross-salon profile
 * migration.
 *
 * Background: profile fields (firstName, lastName, displayName /
 * name, gender, profileImageUrl) used to live on each per-salon
 * Staff record, which meant a user who owned multiple salons saw
 * a different profile per salon. They were migrated onto
 * UserIdentity (Phase 1, additive — old Staff columns still
 * exist as a fallback for Phase 6's cleanup migration).
 *
 * Read paths must now join Staff → membership → UserIdentity
 * and feed both rows through `resolveStaffProfile()`. For
 * staff that have a linked membership/identity, Identity wins.
 * For orphan staff (admin-created walk-in workers with no
 * account), Identity is absent and the resolver falls back to
 * the Staff columns — they have no identity to read from.
 *
 * Keep this file small and dependency-free; it's imported by
 * routes, services, and template-context resolvers.
 */

export type StaffProfileShape = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  gender?: string | null;
  profileImageUrl?: string | null;
};

export type IdentityProfileShape = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  gender?: string | null;
  profileImageUrl?: string | null;
};

/** Minimal shape a query must `include` for the resolver to find
 *  the identity row. The relation name on Staff is
 *  `membership` (PascalCase in Prisma's generated client),
 *  and the relation on the membership is `identity`. Endpoints
 *  that read staff profile data should add:
 *
 *    include: { membership: { include: { identity: { ... } } } }
 *
 *  selecting at least firstName, lastName, displayName, gender,
 *  profileImageUrl on the identity. */
export type StaffWithIdentity = StaffProfileShape & {
  membership?: {
    identity?: IdentityProfileShape | null;
  } | null;
};

export type ResolvedStaffProfile = {
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  gender: string | null;
  profileImageUrl: string | null;
};

const nz = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * Return the canonical profile values for a Staff row by
 * preferring its linked UserIdentity (when present and populated)
 * and falling back to the Staff columns otherwise.
 *
 * Pass null / undefined values for `identity` if the Staff row
 * isn't joined (it'll just fall back to Staff fields). The
 * resolver never throws.
 */
export function resolveStaffProfile(
  staff: StaffProfileShape | null | undefined,
  identity?: IdentityProfileShape | null,
): ResolvedStaffProfile {
  const i = identity || null;
  const s = staff || null;

  const firstName = nz(i?.firstName) ?? nz(s?.firstName);
  const lastName = nz(i?.lastName) ?? nz(s?.lastName);
  const fromName = nz(i?.displayName) ?? nz(s?.name);
  const composed = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  return {
    firstName,
    lastName,
    // Prefer an explicit stored display name; fall back to the
    // composed first/last so callers that always want a single
    // string for the UI never get empty strings.
    name: fromName || composed,
    gender: nz(i?.gender as string | null) ?? nz(s?.gender as string | null),
    profileImageUrl: nz(i?.profileImageUrl) ?? nz(s?.profileImageUrl),
  };
}

/**
 * Convenience overload for the common Prisma include shape: pass
 * the Staff row directly and the resolver pulls the identity off
 * `staff.membership.identity`. Returns null-safe values even
 * if the include was missed.
 */
export function resolveFromStaffRow(staff: StaffWithIdentity | null | undefined): ResolvedStaffProfile {
  return resolveStaffProfile(staff || null, staff?.membership?.identity ?? null);
}

/** Prisma include fragment to copy-paste into queries that need
 *  the identity for profile resolution. Kept here so the field
 *  list is defined once and stays in sync with the resolver's
 *  fallback rules. */
export const STAFF_IDENTITY_INCLUDE = {
  membership: {
    select: {
      identity: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          gender: true,
          profileImageUrl: true,
        },
      },
    },
  },
} as const;
