import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { InviteStatus, UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';

export const INVITE_TTL_DAYS = 7;

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

  // 6 bytes → 12 hex chars (48 bits ≈ 2.8e14 keyspace). Previously 4 bytes
  // (32 bits ≈ 4.3e9) which is brute-forceable. Frontend regex must accept
  // ^[A-F0-9]{12}$ — see Salonmanagementsaasapp SalonSwitcher.tsx.
  const inviteCode = randomBytes(6).toString('hex').toUpperCase();
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

    const legacyUser = await tx.salonUser.create({
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

    const identity = await tx.userIdentity.create({
      data: {
        email: ownerEmail || null,
        phone: ownerPhone || null,
        firstName,
        lastName,
        displayName: ownerName || null,
        passwordHash,
        isActive: true,
      },
    });

    const membership = await tx.salonMembership.create({
      data: {
        salonId: salon.id,
        identityId: identity.id,
        role: UserRole.OWNER,
        isActive: false,
        passwordResetRequired: true,
        legacySalonUserId: legacyUser.id,
      },
    });

    await tx.invite.create({
      data: {
        salonId: salon.id,
        invitedUserId: legacyUser.id,
        invitedMembershipId: membership.id,
        invitedIdentityPhone: ownerPhone || null,
        invitedIdentityEmail: ownerEmail || null,
        inviteCodeHash: hashPlainToken(inviteCode),
        inviteTokenHash: hashPlainToken(inviteToken),
        status: InviteStatus.PENDING,
        expiresAt,
      },
    });

    return { salonId: salon.id, userId: legacyUser.id };
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
      invitedMembership: {
        include: { identity: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } } },
      },
    },
  });

  if (!invite || !invite.invitedMembership) return null;
  return {
    inviteId: invite.id,
    salon: invite.salon,
    user: invite.invitedMembership.identity,
    expiresAt: invite.expiresAt,
  };
}

export async function activateInvite(input: {
  code?: string;
  token?: string;
  password?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
}): Promise<{ salonId: number; identityId: number; membershipId: number; legacyUserId: number; role: string; email: string | null }> {
  const validated = await validateInvite(input);
  if (!validated) {
    throw new Error('INVITE_INVALID');
  }

  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const nextDisplayName = `${firstName} ${lastName}`.trim() || null;
  const nextPhone = normalizePhone(input.phone) || validated.user.phone || null;
  const nextEmail = normalizeEmail(input.email || validated.user.email || '');
  const rawPassword = String(input.password || '').trim();

  const activated = await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findFirst({
      where: {
        status: InviteStatus.PENDING,
        expiresAt: { gt: new Date() },
        OR: [
          ...(input.code ? [{ inviteCodeHash: hashPlainToken(String(input.code).trim().toUpperCase()) }] : []),
          ...(input.token ? [{ inviteTokenHash: hashPlainToken(String(input.token).trim()) }] : []),
        ],
      },
      include: {
        invitedMembership: { include: { identity: true } },
      },
    });
    if (!invite || !invite.invitedMembership) throw new Error('INVITE_INVALID');

    const targetMembership = invite.invitedMembership;
    const existingIdentity = await tx.userIdentity.findFirst({
      where: {
        id: { not: targetMembership.identityId },
        OR: [...(nextPhone ? [{ phone: nextPhone }] : []), ...(nextEmail ? [{ email: nextEmail }] : [])],
      },
    });

    let identityId = targetMembership.identityId;
    let passwordHash = targetMembership.identity.passwordHash;
    if (existingIdentity) {
      identityId = existingIdentity.id;
      passwordHash = existingIdentity.passwordHash;
    } else {
      if (rawPassword.length < 8) throw new Error('PASSWORD_TOO_SHORT');
      passwordHash = await bcrypt.hash(rawPassword, 10);
    }

    if (existingIdentity && existingIdentity.id !== targetMembership.identityId) {
      await tx.salonMembership.update({
        where: { id: targetMembership.id },
        data: { identityId },
      });
    }

    await tx.userIdentity.update({
      where: { id: identityId },
      data: {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        displayName: nextDisplayName || undefined,
        phone: nextPhone || undefined,
        email: nextEmail || undefined,
        passwordHash,
        isActive: true,
      },
    });

    const membership = await tx.salonMembership.update({
      where: { id: targetMembership.id },
      data: {
        isActive: true,
        passwordResetRequired: false,
      },
    });

    const legacyUser = membership.legacySalonUserId
      ? await tx.salonUser.update({
          where: { id: membership.legacySalonUserId },
          data: {
            firstName: firstName || null,
            lastName: lastName || null,
            displayName: nextDisplayName,
            phone: nextPhone,
            email: nextEmail || undefined,
            passwordHash,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
            role: membership.role,
            secondaryRoles: membership.secondaryRoles || null,
          },
        })
      : await tx.salonUser.create({
          data: {
            salonId: membership.salonId,
            email: nextEmail || `legacy-${identityId}@kedy.local`,
            phone: nextPhone || null,
            firstName: firstName || null,
            lastName: lastName || null,
            displayName: nextDisplayName,
            role: membership.role,
            secondaryRoles: membership.secondaryRoles || null,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
            passwordHash,
          },
        });

    await tx.salonMembership.update({
      where: { id: membership.id },
      data: { legacySalonUserId: legacyUser.id },
    });

    await tx.staff.updateMany({
      where: { salonId: membership.salonId, OR: [{ membershipId: membership.id }, { userId: legacyUser.id }] },
      data: {
        ...(nextDisplayName ? { name: nextDisplayName } : {}),
        phone: nextPhone,
        membershipId: membership.id,
        userId: legacyUser.id,
      },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedAt: new Date(),
        invitedIdentityPhone: nextPhone || null,
        invitedIdentityEmail: nextEmail || null,
      },
    });
    await tx.salon.update({
      where: { id: membership.salonId },
      data: { status: 'ACTIVE' },
    });

    return {
      salonId: membership.salonId,
      membershipId: membership.id,
      identityId,
      legacyUserId: legacyUser.id,
      role: membership.role,
      email: nextEmail || null,
    };
  });

  return activated;
}

// Redeem an invite code on behalf of an already-registered UserIdentity.
//
// Different from activateInvite(): the caller is already a verified
// user (came in via authenticateIdentity), so we don't collect name /
// phone / password again. We just re-point the invite's pre-created
// membership at the caller's identity and mark it active.
//
// Email/phone mismatch with the invite is tolerated — the staff member
// might have a different email than the one the owner used to send
// the invite. The invite code itself is the proof of consent.
export async function redeemInviteForIdentity(input: {
  code?: string;
  token?: string;
  identityId: number;
}): Promise<{
  salonId: number;
  membershipId: number;
  identityId: number;
  legacyUserId: number;
  role: string;
}> {
  if (!input.identityId) throw new Error('IDENTITY_REQUIRED');
  const code = input.code ? String(input.code).trim().toUpperCase() : '';
  const token = input.token ? String(input.token).trim() : '';
  if (!code && !token) throw new Error('INVITE_REQUIRED');

  const result = await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findFirst({
      where: {
        status: InviteStatus.PENDING,
        expiresAt: { gt: new Date() },
        OR: [
          ...(code ? [{ inviteCodeHash: hashPlainToken(code) }] : []),
          ...(token ? [{ inviteTokenHash: hashPlainToken(token) }] : []),
        ],
      },
      include: { invitedMembership: true },
    });
    if (!invite || !invite.invitedMembership) throw new Error('INVITE_INVALID');

    const targetMembership = invite.invitedMembership;
    const identity = await tx.userIdentity.findUnique({
      where: { id: input.identityId },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        displayName: true,
        passwordHash: true,
      },
    });
    if (!identity) throw new Error('IDENTITY_NOT_FOUND');

    // Block double-membership in the same salon.
    const dupe = await tx.salonMembership.findFirst({
      where: {
        salonId: targetMembership.salonId,
        identityId: identity.id,
        id: { not: targetMembership.id },
        isActive: true,
      },
      select: { id: true },
    });
    if (dupe) throw new Error('ALREADY_MEMBER');

    const membership = await tx.salonMembership.update({
      where: { id: targetMembership.id },
      data: {
        identityId: identity.id,
        isActive: true,
        passwordResetRequired: false,
      },
    });

    const legacyUser = membership.legacySalonUserId
      ? await tx.salonUser.update({
          where: { id: membership.legacySalonUserId },
          data: {
            email: identity.email || `legacy-${identity.id}@kedy.local`,
            phone: identity.phone || null,
            firstName: identity.firstName || null,
            lastName: identity.lastName || null,
            displayName: identity.displayName || null,
            passwordHash: identity.passwordHash,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
            role: membership.role,
          },
        })
      : await tx.salonUser.create({
          data: {
            salonId: membership.salonId,
            email: identity.email || `legacy-${identity.id}@kedy.local`,
            phone: identity.phone || null,
            firstName: identity.firstName || null,
            lastName: identity.lastName || null,
            displayName: identity.displayName || null,
            role: membership.role,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
            passwordHash: identity.passwordHash,
          },
        });

    await tx.salonMembership.update({
      where: { id: membership.id },
      data: { legacySalonUserId: legacyUser.id },
    });

    // Mirror the activateInvite() Staff sync. The owner created a
    // Staff row up front with the invited person's placeholder data;
    // now that the real identity is attached we re-point that row's
    // membershipId + userId so the team list shows the new joiner
    // and the displayName/phone match what they registered with.
    // Without this the team UI keeps showing the placeholder name
    // and the role/availability widgets can't resolve the row.
    await tx.staff.updateMany({
      where: {
        salonId: membership.salonId,
        OR: [{ membershipId: membership.id }, { userId: legacyUser.id }],
      },
      data: {
        ...(identity.displayName ? { name: identity.displayName } : {}),
        phone: identity.phone || null,
        membershipId: membership.id,
        userId: legacyUser.id,
      },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedAt: new Date(),
        invitedIdentityPhone: identity.phone || null,
        invitedIdentityEmail: identity.email || null,
      },
    });

    await tx.salon.update({
      where: { id: membership.salonId },
      data: { status: 'ACTIVE' },
    });

    return {
      salonId: membership.salonId,
      membershipId: membership.id,
      identityId: identity.id,
      legacyUserId: legacyUser.id,
      role: membership.role,
    };
  });

  return result;
}
