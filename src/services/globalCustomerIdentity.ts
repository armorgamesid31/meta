// Helpers that keep GlobalCustomerIdentity (+ its per-channel index
// GlobalIdentityChannel) in sync with the per-salon Customer table.
// Idempotent — safe to call on every create/update.
//
// GlobalCustomerIdentity is the platform-wide person; GlobalIdentityChannel
// is the (channel, subject) -> person index that unifies WhatsApp (phone) and
// Instagram (IGSID) onto the same person. This lets us:
//   - Recognise a returning customer on a NEW salon's booking/magic-link page
//     (cross-salon), for BOTH WhatsApp and Instagram
//   - Surface one consistent profile photo across channels (lives per-channel
//     here, so it persists even when a salon's ChannelProfileCache goes stale)
//   - Carry firstName/lastName/gender consistently across salons
//
// The PhoneIdentity / CustomerPhoneLink ecosystem still owns the per-salon
// consent layer; this module is the platform-wide identity spine.

import { ChannelType, Customer, IdentitySubjectType } from '@prisma/client';
import { prisma } from '../prisma.js';

/** Normalise an IG handle for matching: strip leading @, trim, lowercase. */
export function normalizeIgUsername(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Upsert a (channel, subjectNormalized) row pointing at a global identity.
 * Idempotent on the unique [channel, subjectNormalized]. Only fills missing
 * profile fields; never relinks an existing subject to a different identity
 * (merge is an explicit, separate flow — A/B linking mechanisms).
 */
export async function upsertGlobalIdentityChannel(input: {
  globalIdentityId: string;
  channel: ChannelType;
  subjectType: IdentitySubjectType;
  subjectNormalized: string;
  subjectRaw?: string | null;
  profileUsername?: string | null;
  profilePicUrl?: string | null;
  verified?: boolean;
}): Promise<void> {
  const subject = input.subjectNormalized?.trim();
  if (!input.globalIdentityId || !subject) return;

  const existing = await prisma.globalIdentityChannel.findUnique({
    where: {
      channel_subjectNormalized: { channel: input.channel, subjectNormalized: subject },
    },
  });

  if (!existing) {
    await prisma.globalIdentityChannel.create({
      data: {
        globalIdentityId: input.globalIdentityId,
        channel: input.channel,
        subjectType: input.subjectType,
        subjectNormalized: subject,
        subjectRaw: input.subjectRaw ?? subject,
        profileUsername: input.profileUsername ?? null,
        profilePicUrl: input.profilePicUrl ?? null,
        profilePicRefreshedAt: input.profilePicUrl ? new Date() : null,
        verifiedAt: input.verified ? new Date() : null,
      },
    });
    return;
  }

  // Same subject already known. Fill missing profile fields only.
  await prisma.globalIdentityChannel.update({
    where: { id: existing.id },
    data: {
      profileUsername: existing.profileUsername ?? input.profileUsername ?? undefined,
      profilePicUrl: input.profilePicUrl ?? existing.profilePicUrl ?? undefined,
      profilePicRefreshedAt: input.profilePicUrl ? new Date() : existing.profilePicRefreshedAt ?? undefined,
      verifiedAt: existing.verifiedAt ?? (input.verified ? new Date() : null),
    },
  });
}

/** Resolve a global identity from a channel subject (phone or IGSID). */
export async function lookupGlobalIdentityByChannel(
  channel: ChannelType,
  subjectNormalized: string,
) {
  const subject = subjectNormalized?.trim();
  if (!subject) return null;
  const row = await prisma.globalIdentityChannel.findUnique({
    where: { channel_subjectNormalized: { channel, subjectNormalized: subject } },
    include: { globalIdentity: true },
  });
  return row?.globalIdentity ?? null;
}

/**
 * Mechanism B (deferred bind): an IG message just arrived with a known IGSID
 * + username. If some global identity claimed this username at registration
 * (pendingInstagramUsername), bind the IGSID to it now and clear the claim.
 * Returns the bound globalIdentityId, or null if no pending claim matched.
 */
export async function bindPendingInstagramUsername(input: {
  igsid: string;
  username: string | null | undefined;
  profilePicUrl?: string | null;
}): Promise<string | null> {
  const username = normalizeIgUsername(input.username);
  const igsid = input.igsid?.trim();
  if (!username || !igsid) return null;

  // Already bound? Nothing to do.
  const alreadyBound = await prisma.globalIdentityChannel.findUnique({
    where: { channel_subjectNormalized: { channel: 'INSTAGRAM', subjectNormalized: igsid } },
    select: { globalIdentityId: true },
  });
  if (alreadyBound) return alreadyBound.globalIdentityId;

  const claimant = await prisma.globalCustomerIdentity.findFirst({
    where: { pendingInstagramUsername: username },
    select: { id: true },
  });
  if (!claimant) return null;

  await upsertGlobalIdentityChannel({
    globalIdentityId: claimant.id,
    channel: 'INSTAGRAM',
    subjectType: 'INSTAGRAM_ID',
    subjectNormalized: igsid,
    subjectRaw: igsid,
    profileUsername: username,
    profilePicUrl: input.profilePicUrl ?? null,
    verified: true,
  });
  await prisma.globalCustomerIdentity.update({
    where: { id: claimant.id },
    data: { pendingInstagramUsername: null },
  });
  return claimant.id;
}

/**
 * Upsert GlobalCustomerIdentity from a Customer row and ensure the
 * Customer.globalIdentityId FK points to it. Phone (E.164 digits-only) is
 * the dedupe key. Also writes the WhatsApp/phone channel-index row and, if the
 * Customer carries an IG handle, records it as a pending IG username claim.
 *
 * Conflict policy on update: only fill missing fields, do NOT overwrite
 * existing global PII unless the Customer carries a verified value. This
 * avoids salons stomping over each other's name spellings.
 */
export async function syncCustomerToGlobalIdentity(
  customerOrId: Customer | number,
): Promise<{ identityId: string | null; created: boolean }> {
  const customer =
    typeof customerOrId === 'number'
      ? await prisma.customer.findUnique({ where: { id: customerOrId } })
      : customerOrId;
  if (!customer || !customer.phone) return { identityId: null, created: false };

  const phoneE164 = customer.phone;
  const isVerified = customer.registrationStatus === 'VERIFIED';

  // Find by phone (unique). If none → create. Otherwise update missing fields.
  const existing = await prisma.globalCustomerIdentity.findUnique({
    where: { phoneE164 },
  });

  let identity;
  let created = false;
  if (!existing) {
    identity = await prisma.globalCustomerIdentity.create({
      data: {
        phoneE164,
        firstName: customer.firstName,
        lastName: customer.lastName,
        gender: customer.gender,
        birthDate: customer.birthDate,
        acceptMarketing: customer.acceptMarketing ?? false,
        // Customers get marked verified by the existing PhoneIdentity flow.
        verifiedAt: isVerified ? new Date() : null,
        pendingInstagramUsername: normalizeIgUsername(customer.instagram) || null,
      },
    });
    created = true;
  } else {
    // Only fill missing PII; never overwrite existing values.
    identity = await prisma.globalCustomerIdentity.update({
      where: { id: existing.id },
      data: {
        firstName: existing.firstName ?? customer.firstName ?? undefined,
        lastName: existing.lastName ?? customer.lastName ?? undefined,
        gender: existing.gender ?? customer.gender ?? undefined,
        birthDate: existing.birthDate ?? customer.birthDate ?? undefined,
        verifiedAt: existing.verifiedAt ?? (isVerified ? new Date() : null),
        pendingInstagramUsername:
          existing.pendingInstagramUsername ?? normalizeIgUsername(customer.instagram) ?? undefined,
      },
    });
  }

  // Link the Customer row if not yet linked.
  if (customer.globalIdentityId !== identity.id) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { globalIdentityId: identity.id },
    });
  }

  // Channel index: phone -> WhatsApp subject. (IG subject is bound separately
  // once the real IGSID is known — see bindPendingInstagramUsername.)
  await upsertGlobalIdentityChannel({
    globalIdentityId: identity.id,
    channel: 'WHATSAPP',
    subjectType: 'PHONE',
    subjectNormalized: phoneE164,
    subjectRaw: phoneE164,
    verified: isVerified,
  });

  return { identityId: identity.id, created };
}

/**
 * Mark the global identity as verified for a phone. Idempotent.
 * Called when any salon completes phone verification.
 */
export async function markGlobalIdentityVerified(phone: string): Promise<void> {
  if (!phone) return;
  await prisma.globalCustomerIdentity.updateMany({
    where: { phoneE164: phone, verifiedAt: null },
    data: { verifiedAt: new Date() },
  });
}

/**
 * Stamp Customer.firstAppointmentAt the first time an appointment completes
 * for a (customer, salon). No-op if already set.
 */
export async function markFirstAppointmentIfNeeded(customerId: number): Promise<void> {
  await prisma.customer.updateMany({
    where: { id: customerId, firstAppointmentAt: null },
    data: { firstAppointmentAt: new Date() },
  });
}
