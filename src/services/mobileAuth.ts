import { randomBytes, createHash } from 'crypto';
import type { SalonUser } from '@prisma/client';
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

export function toAccessTokenPayload(user: Pick<SalonUser, 'id' | 'salonId' | 'role'>) {
  return {
    userId: user.id,
    salonId: user.salonId,
    role: user.role as any,
  };
}

export async function createAuthTokens(user: Pick<SalonUser, 'id' | 'salonId' | 'role'>) {
  const accessToken = generateToken(toAccessTokenPayload(user));
  const refreshToken = createRefreshToken();

  await prisma.mobileAuthSession.create({
    data: {
      userId: user.id,
      salonId: user.salonId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: getTokenExpiry(REFRESH_TOKEN_TTL_DAYS),
    },
  });

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
        user: true,
      },
    });

    if (!session) {
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
        salonId: session.salonId,
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: getTokenExpiry(REFRESH_TOKEN_TTL_DAYS),
      },
    });

    const accessToken = generateToken(toAccessTokenPayload(session.user));

    return {
      accessToken,
      refreshToken: newRefreshToken,
      user: session.user,
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
