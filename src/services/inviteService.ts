import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { InviteStatus, UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';

const INVITE_TTL_DAYS = 3;

function normalizePhone(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

function normalizeEmail(input: string): string {
  return String(input || '').trim().toLowerCase();
}

export function hashPlainToken(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function createOwnerPendingProvisioning(input: {
  salonName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
}): Promise<{
  salonId: number;
  userId: number;
  inviteCode: string;
  inviteToken: string;
  expiresAt: Date;
}> {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const ownerPhone = normalizePhone(input.ownerPhone);
  const ownerName = String(input.ownerName || '').trim();
  const salonName = String(input.salonName || '').trim();

  const existingByPhone = ownerPhone ? await prisma.salonUser.findFirst({ where: { phone: ownerPhone } }) : null;
  // Email can already exist in another salon/user record in current model.
  // Hard-block only phone collisions because phone is unique at DB level.
  if (existingByPhone) {
    throw new Error('OWNER_PHONE_ALREADY_EXISTS');
  }

  const inviteCode = randomBytes(4).toString('hex').toUpperCase();
  const inviteToken = randomBytes(24).toString('hex');
  const passwordHash = await bcrypt.hash(randomBytes(16).toString('hex'), 10);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.$transaction(async (tx) => {
    const salon = await tx.salon.create({
      data: {
        name: salonName || 'Yeni Salon',
        status: 'PENDING',
      },
    });

    const parts = ownerName.split(' ').filter(Boolean);
    const firstName = parts[0] || null;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;

    const user = await tx.salonUser.create({
      data: {
        salonId: salon.id,
        email: ownerEmail,
        phone: ownerPhone || null,
        firstName,
        lastName,
        displayName: ownerName || null,
        role: UserRole.OWNER,
        isActive: false,
        passwordResetRequired: true,
        passwordHash,
      },
    });

    await tx.invite.create({
      data: {
        salonId: salon.id,
        invitedUserId: user.id,
        inviteCodeHash: hashPlainToken(inviteCode),
        inviteTokenHash: hashPlainToken(inviteToken),
        status: InviteStatus.PENDING,
        expiresAt,
      },
    });

    return { salonId: salon.id, userId: user.id };
  });

  return {
    ...result,
    inviteCode,
    inviteToken,
    expiresAt,
  };
}

export async function validateInvite(input: { code?: string; token?: string }) {
  const code = String(input.code || '').trim().toUpperCase();
  const token = String(input.token || '').trim();
  if (!code && !token) {
    throw new Error('INVITE_REQUIRED');
  }
  const now = new Date();
  const invite = await prisma.invite.findFirst({
    where: {
      status: InviteStatus.PENDING,
      expiresAt: { gt: now },
      ...(code ? { inviteCodeHash: hashPlainToken(code) } : {}),
      ...(token ? { inviteTokenHash: hashPlainToken(token) } : {}),
    },
    include: {
      salon: { select: { id: true, name: true } },
      invitedUser: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } },
    },
  });

  if (!invite) return null;
  return {
    inviteId: invite.id,
    salon: invite.salon,
    user: invite.invitedUser,
    expiresAt: invite.expiresAt,
  };
}

export async function activateInvite(input: {
  code?: string;
  token?: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
}): Promise<{ salonId: number; userId: number }> {
  const validated = await validateInvite(input);
  if (!validated) {
    throw new Error('INVITE_INVALID');
  }
  const password = String(input.password || '');
  if (password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.$transaction(async (tx) => {
    await tx.salonUser.update({
      where: { id: validated.user.id },
      data: {
        firstName: String(input.firstName || '').trim() || null,
        lastName: String(input.lastName || '').trim() || null,
        displayName: `${String(input.firstName || '').trim()} ${String(input.lastName || '').trim()}`.trim() || null,
        email: String(input.email || validated.user.email || '').trim().toLowerCase(),
        phone: normalizePhone(input.phone) || validated.user.phone || null,
        passwordHash,
        isActive: true,
        passwordResetRequired: false,
        activationCompletedAt: new Date(),
      },
    });
    await tx.invite.update({
      where: { id: validated.inviteId },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });
    await tx.salon.update({
      where: { id: validated.salon.id },
      data: { status: 'ACTIVE' },
    });
  });

  return { salonId: validated.salon.id, userId: validated.user.id };
}
