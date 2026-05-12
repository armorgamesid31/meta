// Helpers that keep GlobalCustomerIdentity in sync with the per-salon
// Customer table. Idempotent — safe to call on every create/update.
//
// The PhoneIdentity / CustomerPhoneLink ecosystem still owns the actual
// cross-salon verification + consent flow. GlobalCustomerIdentity is a
// thinner platform-wide PII record that lets us:
//   - Show a returning customer's name on a new salon's magic-link page
//   - Hold platform-wide marketing consent in the future
//   - Carry firstName/lastName/gender consistently across salons

import { Customer } from '@prisma/client';
import { prisma } from '../prisma.js';

/**
 * Upsert GlobalCustomerIdentity from a Customer row and ensure the
 * Customer.globalIdentityId FK points to it. Phone (E.164 digits-only) is
 * the dedupe key.
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
        verifiedAt: customer.registrationStatus === 'VERIFIED' ? new Date() : null,
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
        verifiedAt:
          existing.verifiedAt ??
          (customer.registrationStatus === 'VERIFIED' ? new Date() : null),
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
