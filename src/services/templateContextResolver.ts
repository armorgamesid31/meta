// templateContextResolver — single source of truth for WhatsApp template
// NAMED parameters at send time.
//
// Given a (salonId, customerId, [appointmentId]) tuple, fetches the
// related rows and returns a parameter map keyed by the variables used
// in template bodies (customer_name, customer_surname, customer_honorific,
// appointment_date, appointment_time, service_name, location_url, etc.).
//
// All variable names here MUST match what's in templateVariations.ts and
// in the Meta-registered template bodies.

import { prisma } from '../prisma.js';
import { getSalonCustomerRiskPolicy } from './customerRiskPolicy.js';
import { resolveStaffProfile } from './staffProfileResolver.js';

export interface ResolveInput {
  salonId: number;
  customerId?: number | null;
  appointmentId?: number | null;
  /** Override or supply extra params (e.g. magic_token, salon_or_action). */
  extra?: Record<string, string>;
}

export interface ResolvedContext {
  /** Raw NAMED parameter map (template var name → value). */
  params: Record<string, string>;
  /** Display first name for greeting. */
  firstName: string;
  /** Recipient phone in digits-only E.164 minus `+`. */
  recipientPhone: string;
  /** True if customer has opted into marketing messages. */
  acceptMarketing: boolean;
  /** True if salon has WABA connected (chakraPluginId + chakraPhoneNumberId). */
  salonWabaReady: boolean;
  /** Salon's preferred communication tone (drives tier-aware pick). */
  communicationTone: 'FRIENDLY' | 'BALANCED' | 'PROFESSIONAL';
}

const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function formatTRDate(d: Date): string {
  const day = d.getDate();
  const month = TR_MONTHS[d.getMonth()];
  return `${day} ${month}`;
}

function formatTRTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function honorificFromGender(gender: string | null | undefined): string {
  switch (String(gender || '').toLowerCase()) {
    case 'male':   return 'Bey';
    case 'female': return 'Hanım';
    default:       return '';
  }
}

function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const normalized = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizePhoneDigits(phone: string | null | undefined): string {
  return String(phone || '').replace(/\D/g, '');
}

export async function resolveTemplateContext(input: ResolveInput): Promise<ResolvedContext> {
  const [salon, customer, appointment] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: input.salonId },
      select: {
        id: true,
        name: true,
        googleMapsUrl: true,
        chakraPluginId: true,
        chakraPhoneNumberId: true,
        communicationTone: true,
        birthdayDiscountText: true,
        birthdayValidityText: true,
        winbackDiscountText: true,
        winbackValidityText: true,
      },
    }),
    input.customerId
      ? prisma.customer.findUnique({
          where: { id: input.customerId },
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            phone: true,
            gender: true,
            acceptMarketing: true,
          },
        })
      : Promise.resolve(null),
    input.appointmentId
      ? prisma.appointment.findUnique({
          where: { id: input.appointmentId },
          include: {
            service: { select: { name: true } },
            // Resolver inputs: Identity is authoritative for the
            // staff member's display name; Staff columns kept as a
            // fallback for orphan staff with no membership.
            staff: {
              select: {
                firstName: true,
                lastName: true,
                name: true,
                membership: {
                  select: {
                    identity: {
                      select: {
                        firstName: true,
                        lastName: true,
                        displayName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  if (!salon) throw new Error(`salon_not_found:${input.salonId}`);

  // Name resolution: prefer Customer.firstName/lastName; fall back to splitting Customer.name.
  let firstName = customer?.firstName?.trim() || '';
  let lastName = customer?.lastName?.trim() || '';
  if (!firstName && !lastName && customer?.name) {
    const split = splitName(customer.name);
    firstName = split.firstName;
    lastName = split.lastName;
  }
  if (!firstName) firstName = 'Misafir';

  const honorific = honorificFromGender(customer?.gender);

  // Risk policy hours (unified threshold for late cancel + late reschedule).
  let latePolicyHours = '24';
  try {
    const policy = await getSalonCustomerRiskPolicy(input.salonId);
    latePolicyHours = String(policy.attendanceConfig.lateChangeHours || 24);
  } catch {
    // fall back to default 24
  }

  const params: Record<string, string> = {
    // Customer identity
    customer_name: firstName,
    customer_surname: lastName,
    customer_honorific: honorific,
    // Salon
    salon_name: salon.name,
    salonname: salon.name, // alias used by kdy_islem_link header
    location_url: salon.googleMapsUrl || '',
    // Policy
    late_policy_hours: latePolicyHours,
    // Marketing offer texts (may be empty — caller must guard)
    discount_amount: '',
    validity_period: '',
  };

  // Appointment-scoped fields
  if (appointment) {
    params.appointment_date = formatTRDate(appointment.startTime);
    params.appointment_time = formatTRTime(appointment.startTime);
    params.service_name = appointment.service?.name || '';
    // Prefer the cross-salon identity name so a renamed user
    // shows up correctly in every salon's templates. Falls back
    // to legacy Staff columns for orphan staff.
    const staffResolved = resolveStaffProfile(
      appointment.staff,
      appointment.staff?.membership?.identity ?? null,
    );
    params.staff_name = staffResolved.name || '';
  }

  // Caller-supplied extras win over computed defaults.
  if (input.extra) {
    for (const [k, v] of Object.entries(input.extra)) {
      params[k] = String(v ?? '');
    }
  }

  return {
    params,
    firstName,
    recipientPhone: normalizePhoneDigits(customer?.phone),
    acceptMarketing: Boolean(customer?.acceptMarketing),
    salonWabaReady: Boolean(salon.chakraPluginId && salon.chakraPhoneNumberId),
    communicationTone: (salon.communicationTone || 'BALANCED') as ResolvedContext['communicationTone'],
  };
}

/**
 * Returns the salon's birthday offer config. Empty fields → template
 * should NOT be sent (salon is opted out of birthday marketing).
 */
export async function getBirthdayOfferConfig(salonId: number) {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { birthdayDiscountText: true, birthdayValidityText: true },
  });
  return {
    discountText: salon?.birthdayDiscountText || '',
    validityText: salon?.birthdayValidityText || '',
    enabled: Boolean(salon?.birthdayDiscountText && salon?.birthdayValidityText),
  };
}

export async function getWinbackOfferConfig(salonId: number) {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { winbackDiscountText: true, winbackValidityText: true },
  });
  return {
    discountText: salon?.winbackDiscountText || '',
    validityText: salon?.winbackValidityText || '',
    enabled: Boolean(salon?.winbackDiscountText && salon?.winbackValidityText),
  };
}
