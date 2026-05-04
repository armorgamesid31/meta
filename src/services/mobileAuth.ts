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

    if (!session || !session.membership || !session.identity || !session.membershipId || !session.identityId) {
      return null;
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

    await tx.salonMembership.update({
      where: { id: session.membershipId },
      data: { lastLoginAt: now },
    });

    const accessToken = generateToken(
      toAccessTokenPayload({
        legacyUserId: session.userId,
        identityId: session.identityId,
        membershipId: session.membershipId,
        salonId: session.salonId,
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
