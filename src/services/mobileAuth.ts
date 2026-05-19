import { randomBytes, createHash } from 'crypto';
import { prisma } from '../prisma.js';
import { generateToken } from '../utils/jwt.js';

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

function getTokenExpiry(days: number): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

type AuthMembershipInput = {
  membershipId: number;
  identityId: number;
  legacyUserId: number;
  salonId: number;
  role: string;
};

export function toAccessTokenPayload(input: AuthMembershipInput) {
  return {
    userId: input.legacyUserId,
    identityId: input.identityId,
    membershipId: input.membershipId,
    salonId: input.salonId,
    role: input.role as any,
  };
}

export async function createAuthTokens(input: AuthMembershipInput) {
  const accessToken = generateToken(toAccessTokenPayload(input));
  const refreshToken = createRefreshToken();

  await prisma.$transaction([
    prisma.mobileAuthSession.create({
      data: {
        userId: input.legacyUserId,
        identityId: input.identityId,
        membershipId: input.membershipId,
        salonId: input.salonId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: getTokenExpiry(REFRESH_TOKEN_TTL_DAYS),
      },
    }),
    prisma.salonMembership.update({
      where: { id: input.membershipId },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  return {
    accessToken,
    refreshToken,
  };
}

export async function rotateRefreshToken(refreshToken: string) {
  const refreshTokenHash = hashToken(refreshToken);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const session = await tx.mobileAuthSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        membership: true,
        identity: true,
      },
    });

    if (!session || !session.identity || !session.identityId) {
      return null;
    }

    // Identity-only session (registered via /kayit, no salon attached
    // yet): mint a fresh identity-only token. Previously this path
    // returned null, which caused the AuthContext apiFetch interceptor
    // to call logout() the moment any salon-scoped request 401'd —
    // the user got booted right back to the login screen immediately
    // after logging in.
    if (!session.membership || !session.salonId || !session.userId) {
      const newRefreshToken = createRefreshToken();
      const newRefreshTokenHash = hashToken(newRefreshToken);

      await tx.mobileAuthSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });
      await tx.mobileAuthSession.create({
        data: {
          identityId: session.identityId,
          refreshTokenHash: newRefreshTokenHash,
          expiresAt: getTokenExpiry(REFRESH_TOKEN_TTL_DAYS),
        },
      });

      const accessToken = generateToken({
        identityId: session.identityId,
        userId: 0,
      } as any);

      return {
        accessToken,
        refreshToken: newRefreshToken,
        user: {
          id: session.identity.id,
          email: session.identity.email,
          role: null,
          salonId: null,
          passwordResetRequired: false,
          isActive: session.identity.isActive === true,
        },
        membershipId: null,
        identityId: session.identityId,
        legacyUserId: null,
      };
    }

    const newRefreshToken = createRefreshToken();
    const newRefreshTokenHash = hashToken(newRefreshToken);

    await tx.mobileAuthSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });

    await tx.mobileAuthSession.create({
      data: {
        userId: session.userId,
        identityId: session.identityId,
        membershipId: session.membershipId,
        salonId: session.salonId,
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: getTokenExpiry(REFRESH_TOKEN_TTL_DAYS),
      },
    });

    // Past the identity-only early return, all of these are guaranteed
    // non-null — assert for TS so the narrowing carries through.
    const membershipId = session.membershipId!;
    const userId = session.userId!;
    const salonId = session.salonId!;

    await tx.salonMembership.update({
      where: { id: membershipId },
      data: { lastLoginAt: now },
    });

    const accessToken = generateToken(
      toAccessTokenPayload({
        legacyUserId: userId,
        identityId: session.identityId,
        membershipId: membershipId,
        salonId: salonId,
        role: session.membership.role,
      }),
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: session.identity.id,
        email: session.identity.email,
        role: session.membership.role,
        salonId: session.salonId,
        passwordResetRequired: session.membership.passwordResetRequired === true,
        isActive: session.membership.isActive === true && session.identity.isActive === true,
      },
      membershipId: session.membershipId,
      identityId: session.identityId,
      legacyUserId: session.userId,
    };
  });
}

// Identity-only tokens for users who registered but haven't joined or
// created a salon yet. The token carries identityId but no salonId,
// membershipId, or legacy userId. Only endpoints that explicitly use
// the authenticateIdentity middleware accept these — full-fat
// authenticateToken (which requires salon scope) will reject them.
export async function createIdentityTokens(input: { identityId: number }) {
  const accessToken = generateToken({
    identityId: input.identityId,
    // legacy field kept for token signature compatibility; consumers
    // that read it should fall back to identityId when 0.
    userId: 0,
  } as any);
  const refreshToken = createRefreshToken();

  await prisma.mobileAuthSession.create({
    data: {
      identityId: input.identityId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: getTokenExpiry(REFRESH_TOKEN_TTL_DAYS),
    },
  });

  return { accessToken, refreshToken };
}

export async function revokeRefreshToken(refreshToken: string) {
  const refreshTokenHash = hashToken(refreshToken);

  const result = await prisma.mobileAuthSession.updateMany({
    where: {
      refreshTokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count > 0;
}
