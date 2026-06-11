// Salon-neutral customer profile portal. The customer reaches it via a
// channel-proven magic link (ProfilePortalToken, minted by the AI
// "profil_guncelleme" tool) to view/edit their OWN platform-wide identity —
// name, gender, birthday (1×/year), photo — and manage their linked channels
// (multiple phones / Instagram accounts; see globalCustomerIdentity helpers).
// Salon-scoped Customer data is NEVER touched here — global identity only.

import { ChannelType, CustomerGender, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma.js';
import { listIdentityChannels } from './globalCustomerIdentity.js';

const PORTAL_TOKEN_TTL_MINUTES = 30;
const BIRTHDAY_CHANGE_COOLDOWN_DAYS = 365;
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generateToken(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

/**
 * Mint a single-use, short-lived portal token for a KNOWN global identity.
 * Called by the AI "profil_guncelleme" tool after it resolves the customer's
 * identity from the channel they messaged from. originChannel/Subject record
 * that channel-proven origin (= proof of current-channel ownership).
 */
export async function mintPortalToken(input: {
  globalIdentityId: string;
  originChannel: ChannelType;
  originSubject: string;
  ttlMinutes?: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const ttl = input.ttlMinutes ?? PORTAL_TOKEN_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);
  for (let i = 0; i < 6; i += 1) {
    const token = generateToken();
    const clash = await prisma.profilePortalToken.findUnique({ where: { token }, select: { id: true } });
    if (clash) continue;
    await prisma.profilePortalToken.create({
      data: {
        token,
        globalIdentityId: input.globalIdentityId,
        originChannel: input.originChannel,
        originSubject: input.originSubject.trim(),
        expiresAt,
      },
    });
    return { token, expiresAt };
  }
  throw new Error('portal_token_mint_failed');
}

/**
 * Validate + consume a portal token (single use). Returns the globalIdentityId
 * the session is for, or null if missing/expired/already used. Marks usedAt so
 * the link can't be replayed; the route layer issues the editing session.
 */
export async function consumePortalToken(
  token: string,
): Promise<{ globalIdentityId: string } | null> {
  const value = token?.trim();
  if (!value) return null;
  const row = await prisma.profilePortalToken.findUnique({ where: { token: value } });
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  await prisma.profilePortalToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return { globalIdentityId: row.globalIdentityId };
}

function nextBirthdayEditableAt(changedAt: Date | null): Date | null {
  if (!changedAt) return null;
  return new Date(changedAt.getTime() + BIRTHDAY_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

/** Read the customer's own profile + linked channels for the portal UI. */
export async function getPortalProfile(globalIdentityId: string) {
  if (!globalIdentityId) return null;
  const identity = await prisma.globalCustomerIdentity.findUnique({
    where: { id: globalIdentityId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      gender: true,
      birthDate: true,
      birthDateChangedAt: true,
      photoUrl: true,
      acceptMarketing: true,
      phoneE164: true,
    },
  });
  if (!identity) return null;

  const channels = await listIdentityChannels(globalIdentityId);
  const birthdayEditableAt = nextBirthdayEditableAt(identity.birthDateChangedAt);
  return {
    profile: {
      firstName: identity.firstName,
      lastName: identity.lastName,
      gender: identity.gender,
      birthDate: identity.birthDate,
      photoUrl: identity.photoUrl,
      acceptMarketing: identity.acceptMarketing,
      birthdayEditableNow: birthdayEditableAt === null || birthdayEditableAt.getTime() <= Date.now(),
      birthdayEditableAt,
    },
    // Multiple phones / Instagram accounts / future platforms render generically.
    channels: channels.map((c) => ({
      id: c.id,
      channel: c.channel,
      subjectType: c.subjectType,
      label: c.profileUsername ?? c.subjectRaw ?? c.subjectNormalized,
      verified: !!c.verifiedAt,
      isPrimaryPhone: c.channel === 'WHATSAPP' && c.subjectNormalized === identity.phoneE164,
      photoUrl: c.profilePicUrl,
    })),
  };
}

type UpdateProfileResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'birthday_locked'; nextAllowedAt: Date };

/**
 * Update the free-edit profile fields. Birthday changes only once per year
 * (birthDateChangedAt guard); name/gender/photo/marketing are unrestricted.
 * Channel changes (phone/Instagram) go through their own proven flows — NOT
 * here. Salon-side Customer rows are untouched (global identity only).
 */
export async function updatePortalProfile(
  globalIdentityId: string,
  patch: {
    firstName?: string | null;
    lastName?: string | null;
    gender?: CustomerGender | null;
    birthDate?: Date | null;
    photoUrl?: string | null;
    acceptMarketing?: boolean;
  },
): Promise<UpdateProfileResult> {
  const identity = await prisma.globalCustomerIdentity.findUnique({
    where: { id: globalIdentityId },
    select: { id: true, birthDate: true, birthDateChangedAt: true },
  });
  if (!identity) return { status: 'not_found' };

  const data: Prisma.GlobalCustomerIdentityUpdateInput = {};
  if (patch.firstName !== undefined) data.firstName = patch.firstName;
  if (patch.lastName !== undefined) data.lastName = patch.lastName;
  if (patch.gender !== undefined) data.gender = patch.gender;
  if (patch.photoUrl !== undefined) data.photoUrl = patch.photoUrl;
  if (patch.acceptMarketing !== undefined) data.acceptMarketing = patch.acceptMarketing;

  if (patch.birthDate !== undefined) {
    const current = identity.birthDate ? identity.birthDate.getTime() : null;
    const next = patch.birthDate ? patch.birthDate.getTime() : null;
    if (current !== next) {
      const editableAt = nextBirthdayEditableAt(identity.birthDateChangedAt);
      if (editableAt && editableAt.getTime() > Date.now()) {
        return { status: 'birthday_locked', nextAllowedAt: editableAt };
      }
      data.birthDate = patch.birthDate;
      data.birthDateChangedAt = new Date();
    }
  }

  if (Object.keys(data).length > 0) {
    await prisma.globalCustomerIdentity.update({ where: { id: globalIdentityId }, data });
  }
  return { status: 'ok' };
}
