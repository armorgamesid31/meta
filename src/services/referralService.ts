import crypto from 'crypto';
import { prisma } from '../prisma.js';

function normalizeReferralCode(raw: string): string {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateReferralCode(): string {
  const seed = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `KEDY${seed}`;
}

export async function ensureSalonReferralCode(salonId: number): Promise<string> {
  const existing = await prisma.referralCode.findFirst({
    where: { salonId, isActive: true },
    orderBy: { id: 'desc' },
  });
  if (existing) return existing.code;

  for (let i = 0; i < 8; i += 1) {
    const code = generateReferralCode();
    try {
      const created = await prisma.referralCode.create({
        data: { salonId, code, isActive: true },
      });
      return created.code;
    } catch {
      // retry on collision
    }
  }
  throw new Error('REFERRAL_CODE_GENERATION_FAILED');
}

export async function findActiveReferralCode(rawCode?: string | null) {
  const normalized = normalizeReferralCode(String(rawCode || ''));
  if (!normalized) return null;
  return await prisma.referralCode.findFirst({
    where: { code: normalized, isActive: true },
  });
}

export async function attachReferredSalon(input: {
  referralCode: string;
  referredSalonId: number;
}) {
  const referral = await findActiveReferralCode(input.referralCode);
  if (!referral) {
    return { linked: false as const, reason: 'REFERRAL_NOT_FOUND' };
  }

  if (referral.salonId === input.referredSalonId) {
    return { linked: false as const, reason: 'SELF_REFERRAL_BLOCKED' };
  }

  const existing = await prisma.referralInvite.findUnique({
    where: { referredSalonId: input.referredSalonId },
  });
  if (existing) {
    return { linked: false as const, reason: 'ALREADY_LINKED' };
  }

  const invite = await prisma.referralInvite.create({
    data: {
      referralCodeId: referral.id,
      referrerSalonId: referral.salonId,
      referredSalonId: input.referredSalonId,
      status: 'QUALIFIED',
      rewards: {
        create: {
          salonId: referral.salonId,
          status: 'PENDING',
          rewardType: 'FREE_MONTH',
          notes: 'Referral qualified after checkout completion.',
        },
      },
    },
    include: { rewards: true },
  });

  return { linked: true as const, invite };
}
