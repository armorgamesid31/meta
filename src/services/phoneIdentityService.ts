// PhoneIdentity — ecosystem-scoped phone verification record.
//
// A single phone number can be linked to multiple salon Customer rows.
// Once a phone has a PhoneIdentity with a valid verification, additional
// salons can adopt that customer with a lightweight "consent link"
// instead of a full re-verification.

import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

export interface UpsertPhoneIdentityInput {
  phone: string; // E.164 (e.g. +905551234567) or digits-only
  isActive?: boolean;
}

export async function upsertPhoneIdentity(input: UpsertPhoneIdentityInput) {
  const phone = String(input.phone || '').trim();
  if (!phone) throw new Error('phone_required');

  const now = new Date();
  return prisma.phoneIdentity.upsert({
    where: { phone },
    update: {
      lastVerifiedAt: now,
      isActive: input.isActive ?? true,
    },
    create: {
      phone,
      firstVerifiedAt: now,
      lastVerifiedAt: now,
      isActive: input.isActive ?? true,
    },
  });
}

export async function getPhoneIdentity(phone: string) {
  const normalized = String(phone || '').trim();
  if (!normalized) return null;
  return prisma.phoneIdentity.findUnique({ where: { phone: normalized } });
}

export interface LinkCustomerInput {
  salonId: number;
  phoneIdentityId: number;
  customerId: number;
  consentSource: 'INSTAGRAM' | 'BOOKING' | 'ADMIN' | 'WHATSAPP_INBOUND' | 'WEB';
  optInChannels?: Record<string, boolean>;
}

export async function linkCustomerToIdentity(input: LinkCustomerInput) {
  return prisma.customerPhoneLink.upsert({
    where: {
      salonId_phoneIdentityId: {
        salonId: input.salonId,
        phoneIdentityId: input.phoneIdentityId,
      },
    },
    update: {
      customerId: input.customerId,
      consentSource: input.consentSource,
      optInChannels: (input.optInChannels ?? {}) as Prisma.InputJsonValue,
    },
    create: {
      salonId: input.salonId,
      phoneIdentityId: input.phoneIdentityId,
      customerId: input.customerId,
      consentSource: input.consentSource,
      optInChannels: (input.optInChannels ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/**
 * For a given phone, returns every salon where this customer is already
 * linked. Used by the FAST PATH check in customer verification — if the
 * caller's salon is not in this list, we send a short consent link
 * (not a full verification flow).
 */
export async function findSalonLinksForPhone(phone: string) {
  const identity = await getPhoneIdentity(phone);
  if (!identity) return { identity: null, links: [] as any[] };
  const links = await prisma.customerPhoneLink.findMany({
    where: { phoneIdentityId: identity.id },
    select: {
      id: true,
      salonId: true,
      customerId: true,
      consentSource: true,
      linkedAt: true,
    },
  });
  return { identity, links };
}

export async function isLinkedToSalon(phone: string, salonId: number): Promise<boolean> {
  const { identity } = await findSalonLinksForPhone(phone);
  if (!identity) return false;
  const count = await prisma.customerPhoneLink.count({
    where: { phoneIdentityId: identity.id, salonId },
  });
  return count > 0;
}

export async function blockPhone(phone: string, reason: string) {
  return prisma.phoneIdentity.update({
    where: { phone },
    data: {
      isActive: false,
      blockedAt: new Date(),
      blockedReason: reason,
    },
  });
}
