import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { prisma } from '../prisma.js';
import { createAuthTokens, createIdentityTokens } from './mobileAuth.js';
import { ensureSalonAccessSeed } from './accessControl.js';

// Legacy SalonUser.passwordHash is NOT NULL. OAuth-only identities
// have identity.passwordHash = null, so when we backfill a legacy row
// we drop a placeholder bcrypt hash of random bytes that no one can
// reproduce. This keeps the column populated without leaving a
// guessable credential in the table.
async function legacyPasswordPlaceholder(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), 10);
}

type Provider = 'google' | 'apple';

type FindOrCreateInput = {
  provider: Provider;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  picture?: string | null;
};

export class OAuthEmailCollisionError extends Error {
  constructor() {
    super('Email already registered without verification.');
    this.name = 'OAuthEmailCollisionError';
  }
}

/**
 * Resolve a UserIdentity for an OAuth login.
 *
 * Strategy:
 *  1. Provider `sub` is the strongest signal — if we've seen it
 *     before, return the bound identity directly.
 *  2. If the provider asserts the email is verified AND an identity
 *     with that email already exists, link the provider sub to it.
 *     This is the canonical account-merge case (user signed up with
 *     a password, later clicks "Sign in with Google" using the same
 *     mailbox).
 *  3. If the email exists but the provider did NOT verify it (rare:
 *     consent-only scopes, malformed Apple tokens), refuse the link
 *     to avoid hijacking — caller surfaces a 409 telling the user
 *     to log in with their password.
 *  4. Otherwise, mint a fresh identity. emailVerifiedAt is stamped
 *     only when the provider asserted verification.
 */
export async function findOrCreateIdentityForOAuth(
  input: FindOrCreateInput,
): Promise<{ identity: Awaited<ReturnType<typeof prisma.userIdentity.create>>; isNew: boolean }> {
  const subField = input.provider === 'google' ? 'googleSub' : 'appleSub';

  const bySub = await prisma.userIdentity.findFirst({
    where: { [subField]: input.sub },
  });
  if (bySub) return { identity: bySub, isNew: false };

  if (input.email) {
    const byEmail = await prisma.userIdentity.findFirst({
      where: { email: input.email },
    });
    if (byEmail) {
      if (!input.emailVerified) {
        throw new OAuthEmailCollisionError();
      }
      const updated = await prisma.userIdentity.update({
        where: { id: byEmail.id },
        data: {
          [subField]: input.sub,
          emailVerifiedAt: byEmail.emailVerifiedAt || new Date(),
          // Only seed names if the existing identity has none — never
          // overwrite a name the user already chose.
          firstName: byEmail.firstName || input.firstName,
          lastName: byEmail.lastName || input.lastName,
          displayName:
            byEmail.displayName ||
            [input.firstName, input.lastName].filter(Boolean).join(' ').trim() ||
            null,
          // Same rule for the avatar — keep whatever the user already
          // picked, only fill in if empty.
          profileImageUrl: byEmail.profileImageUrl || input.picture || null,
        },
      });
      // Link-up is not a brand-new account: the user already onboarded
      // with a password and is now adding an OAuth method. Don't push
      // them through the profile-completion flow again.
      return { identity: updated, isNew: false };
    }
  }

  const displayName =
    [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || null;

  const created = await prisma.userIdentity.create({
    data: {
      email: input.email,
      [subField]: input.sub,
      passwordHash: null,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName,
      profileImageUrl: input.picture || null,
      isActive: true,
      emailVerifiedAt: input.emailVerified ? new Date() : null,
    },
  });
  return { identity: created, isNew: true };
}

type LoginResult =
  | { kind: 'inactive' }
  | { kind: 'identity_only'; body: any }
  | { kind: 'requires_selection'; body: any }
  | { kind: 'full'; body: any };

/**
 * Build the same response shape /auth/login returns, given just an
 * identityId and an optional preferred salon. Mirrors the membership
 * resolution and legacy-SalonUser backfill from the password-login
 * path so OAuth callers get identical behavior:
 *   - 0 memberships → identity-only token
 *   - >1 memberships and no preference → salon picker payload
 *   - else → salon-scoped token + memberships list
 */
export async function buildIdentityLoginResponse(
  identityId: number,
  requestedSalonId?: number,
): Promise<LoginResult> {
  const identity = await prisma.userIdentity.findUnique({
    where: { id: identityId },
    include: {
      memberships: {
        where: { isActive: true },
        orderBy: { id: 'asc' },
        include: {
          salon: { select: { id: true, name: true, slug: true, logoUrl: true } },
        },
      },
    },
  });

  if (!identity || !identity.isActive) {
    return { kind: 'inactive' };
  }

  const memberships = identity.memberships;

  if (!memberships.length) {
    const tokens = await createIdentityTokens({ identityId: identity.id });
    return {
      kind: 'identity_only',
      body: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: identity.id,
          email: identity.email,
          salonId: null,
          membershipId: null,
          role: null,
        },
      },
    };
  }

  if (memberships.length > 1 && !requestedSalonId) {
    return {
      kind: 'requires_selection',
      body: {
        requiresSalonSelection: true,
        salons: memberships.map((m) => ({
          salonId: m.salonId,
          salonName: m.salon?.name || `Salon #${m.salonId}`,
          salonSlug: m.salon?.slug || null,
          salonLogoUrl: m.salon?.logoUrl || null,
          role: m.role,
          email: identity.email || '',
          userId: m.legacySalonUserId || m.id,
          membershipId: m.id,
          lastLoginAt: m.lastLoginAt || null,
        })),
      },
    };
  }

  const membership =
    (requestedSalonId
      ? memberships.find((m) => m.salonId === requestedSalonId)
      : null) || memberships[0];

  let legacyUserId = membership.legacySalonUserId || 0;
  if (!legacyUserId) {
    const legacy = await prisma.salonUser.create({
      data: {
        salonId: membership.salonId,
        email: identity.email || `legacy-${identity.id}@kedy.local`,
        phone: identity.phone || null,
        passwordHash: identity.passwordHash || (await legacyPasswordPlaceholder()),
        role: membership.role,
        secondaryRoles: (membership.secondaryRoles as any) || undefined,
        firstName: identity.firstName || null,
        lastName: identity.lastName || null,
        displayName: identity.displayName || null,
        isActive: membership.isActive,
        passwordResetRequired: membership.passwordResetRequired,
      },
    });
    legacyUserId = legacy.id;
    await prisma.salonMembership.update({
      where: { id: membership.id },
      data: { legacySalonUserId: legacy.id },
    });
  }

  const { accessToken, refreshToken } = await createAuthTokens({
    legacyUserId,
    identityId: identity.id,
    membershipId: membership.id,
    salonId: membership.salonId,
    role: membership.role as string,
  } as any);
  await ensureSalonAccessSeed(membership.salonId);

  return {
    kind: 'full',
    body: {
      token: accessToken,
      accessToken,
      refreshToken,
      user: {
        id: identity.id,
        membershipId: membership.id,
        email: identity.email,
        role: membership.role,
        salonId: membership.salonId,
        passwordResetRequired: membership.passwordResetRequired === true,
      },
      salons: memberships.map((m) => ({
        salonId: m.salonId,
        role: m.role,
        email: identity.email || '',
        userId: m.legacySalonUserId || m.id,
        membershipId: m.id,
      })),
    },
  };
}
