import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { AvailabilityEngine } from '../modules/availability/engine.js';
import { SlotsEngine } from '../modules/availability/slots-engine.js';
import { DateNormalizer } from '../modules/availability/normalizer.js';
import type { PersonGroup } from '../modules/availability/types.js';
import { calculateSmartDuration, ServiceWithCategory } from '../utils/durationCalculator.js';
import { normalizeInstagramIdentity } from '../services/identityService.js';
import { notifySameDayAppointmentChange } from '../services/notifications.js';
import {
  generateAvailability,
  generateAvailabilityAlternatives,
  matchSelectedDisplaySlots,
  parseSelectedPersonSlots,
} from '../services/availabilityService.js';
import {
  buildAppointmentReschedulePreview,
  commitAppointmentReschedule,
} from '../services/appointmentReschedule.js';
import { buildRescheduleOptions } from '../services/appointmentRescheduleOptions.js';
import { matchWaitlistForDate } from '../services/waitlist.js';
import {
  previewCampaignPricing,
  persistAppointmentCampaignApplication,
  consumeWalletBalances,
  upsertReferralEnrollment,
  registerReferralAttributionFromToken,
  releaseAppointmentCampaignApplications,
} from '../services/campaignPricing.js';
import { assertBookingAllowed } from '../services/blacklist.js';

const router = Router();

function sendCustomerBannedResponse(res: any, detail?: string | null) {
  return res.status(403).json({
    code: 'CUSTOMER_BANNED',
    message: detail && detail.trim() ? `Müşteri yasaklı: ${detail.trim()}` : 'Müşteri yasaklı olduğu için işlem yapılamaz.',
  });
}

type SameDayEvent = 'CREATED' | 'UPDATED' | 'CANCELLED';

async function getSalonTimezone(salonId: number): Promise<string> {
  try {
    const setting = await prisma.salonSettings.findUnique({
      where: { salonId },
      select: { timezone: true },
    });
    return setting?.timezone || 'Europe/Istanbul';
  } catch {
    return 'Europe/Istanbul';
  }
}

async function emitSameDayChangeBestEffort(input: {
  salonId: number;
  event: SameDayEvent;
  appointmentId: number;
  customerName: string;
  serviceName?: string | null;
  startTime: Date;
}): Promise<void> {
  try {
    const timezone = await getSalonTimezone(input.salonId);
    await notifySameDayAppointmentChange({
      salonId: input.salonId,
      event: input.event,
      appointmentId: input.appointmentId,
      customerName: input.customerName,
      serviceName: input.serviceName || null,
      startTime: input.startTime,
      timezone,
    });
  } catch (error) {
    console.error('Failed to emit same-day notification from bookings route:', error);
  }
}

function parseAppointmentIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const dedup = new Set<number>();
  for (const row of input) {
    const id = Number(row);
    if (Number.isInteger(id) && id > 0) dedup.add(id);
  }
  return Array.from(dedup);
}

function parseRescheduleAssignments(input: unknown): Record<number, number> {
  const list = Array.isArray(input) ? input : [];
  const map: Record<number, number> = {};
  for (const row of list) {
    const appointmentId = Number((row as any)?.appointmentId);
    const staffId = Number((row as any)?.staffId);
    if (Number.isInteger(appointmentId) && appointmentId > 0 && Number.isInteger(staffId) && staffId > 0) {
      map[appointmentId] = staffId;
    }
  }
  return map;
}

function parsePositiveIdArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => Number(value))
    .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index);
}

function normalizeNamePart(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function splitFullName(value: string): { firstName: string; lastName: string } {
  const normalized = normalizeNamePart(value);
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function resolveCustomerNameParts(input: {
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
}) {
  const firstNameRaw = normalizeNamePart(input.firstName);
  const lastNameRaw = normalizeNamePart(input.lastName);
  const fallbackFullName = normalizeNamePart(input.fullName);
  const fallback = !firstNameRaw && !lastNameRaw ? splitFullName(fallbackFullName) : { firstName: '', lastName: '' };
  const firstName = firstNameRaw || fallback.firstName;
  const lastName = lastNameRaw || fallback.lastName;
  const fullName = `${firstName} ${lastName}`.trim() || fallbackFullName;
  return { firstName, lastName, fullName };
}

function buildPublicAvailabilityGroups(services: any[]): PersonGroup[] {
  const servicesByPerson = new Map<number, any[]>();

  for (const service of Array.isArray(services) ? services : []) {
    const personIndex =
      Number.isInteger(Number(service?.personIndex)) && Number(service.personIndex) > 0
        ? Number(service.personIndex)
        : 1;
    const list = servicesByPerson.get(personIndex) || [];
    list.push(service);
    servicesByPerson.set(personIndex, list);
  }

  return Array.from(servicesByPerson.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([personIndex, personServices]) => ({
      personId: `p${personIndex}`,
      services: personServices
        .map((service) => {
          const serviceId = Number(service?.serviceId);
          if (!Number.isInteger(serviceId) || serviceId <= 0) return null;
          const allowedStaffIds = parsePositiveIdArray(service?.staffOptionIds);
          return {
            serviceId,
            allowedStaffIds: allowedStaffIds.length ? allowedStaffIds : null,
          };
        })
        .filter(Boolean) as Array<{ serviceId: number; allowedStaffIds: number[] | null }>,
    }))
    .filter((group) => group.services.length > 0);
}

function buildSlotUnavailableBody(message: string, alternatives: Awaited<ReturnType<typeof generateAvailabilityAlternatives>>) {
  return {
    code: 'SLOT_NOT_AVAILABLE',
    message,
    alternatives,
  };
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isReschedulableAppointmentStatus(value: unknown): boolean {
  const status = String(value || '').trim().toUpperCase();
  return status === 'BOOKED' || status === 'CONFIRMED';
}

function isCancelableAppointmentStatus(value: unknown): boolean {
  const status = String(value || '').trim().toUpperCase();
  return status === 'BOOKED' || status === 'CONFIRMED' || status === 'UPDATED';
}

async function resolveMagicTokenCustomer(input: { token: string; salonId: number }) {
  const now = new Date();
  const magicLink = await prisma.magicLink.findUnique({
    where: { token: input.token },
    include: {
      identitySession: {
        select: {
          customerId: true,
        },
      },
    },
  });

  if (!magicLink || magicLink.salonId !== input.salonId) {
    return { error: 'Magic token not found for this salon.', code: 404 as const };
  }
  if (magicLink.expiresAt < now || magicLink.status === 'EXPIRED' || magicLink.status === 'REVOKED') {
    return { error: 'Magic token has expired.', code: 410 as const };
  }

  let customerId = magicLink.usedByCustomerId || magicLink.identitySession?.customerId || null;

  if (!customerId) {
    const binding = await prisma.identityBinding.findUnique({
      where: {
        salonId_channel_subjectNormalized: {
          salonId: input.salonId,
          channel: magicLink.channel,
          subjectNormalized: magicLink.subjectNormalized,
        },
      },
      select: { customerId: true },
    });
    customerId = binding?.customerId || null;
  }

  if (!customerId) {
    return { error: 'No customer linked to magic token.', code: 403 as const };
  }

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId: input.salonId,
    },
    select: { id: true, phone: true },
  });
  if (!customer) {
    return { error: 'Customer not found for this token.', code: 404 as const };
  }

  return { customerId: customer.id, customerPhone: customer.phone };
}

async function resolveActiveReferralCampaign(input: { salonId: number; campaignId: number }) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: input.campaignId,
      salonId: input.salonId,
      isActive: true,
      type: 'REFERRAL',
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
    },
  });

  if (!campaign) {
    return { error: 'Referral campaign not found or inactive.', code: 404 as const };
  }

  const now = new Date();
  if (campaign.startsAt && campaign.startsAt > now) {
    return { error: 'Referral campaign has not started yet.', code: 409 as const };
  }
  if (campaign.endsAt && campaign.endsAt < now) {
    return { error: 'Referral campaign has ended.', code: 409 as const };
  }

  return { campaignId: campaign.id };
}

async function createExactSlotBooking(input: {
  salonId: number;
  customerId: number;
  customerName: string;
  customerPhone: string;
  services: any[];
  source: 'CUSTOMER' | 'SALON';
  token?: string | null;
  packageSelections?: any[];
  referralShareToken?: string | null;
  availabilityLockToken: string;
  selectedSlots: ReturnType<typeof parseSelectedPersonSlots>;
}): Promise<{ status: number; body: any }> {
  const searchContext = await prisma.searchContext.findUnique({
    where: { id: input.availabilityLockToken },
  });

  if (!searchContext) {
    return { status: 404, body: { message: 'Availability selection not found.' } };
  }
  if (searchContext.expiresAt < new Date()) {
    return { status: 410, body: { message: 'Availability selection has expired.' } };
  }
  if (searchContext.salonId !== input.salonId) {
    return { status: 403, body: { message: 'Salon mismatch.' } };
  }

  await assertBookingAllowed({
    salonId: input.salonId,
    customerId: input.customerId,
    phone: input.customerPhone,
    channel: 'WHATSAPP',
  });

  const availabilityRequest = searchContext.data as any;
  const availabilityResult = await generateAvailability(availabilityRequest, { persistSearchContext: false });
  const matchedDisplaySlot = matchSelectedDisplaySlots(availabilityResult, input.selectedSlots);

  if (!matchedDisplaySlot) {
    const alternatives = await generateAvailabilityAlternatives({
      salonId: input.salonId,
      request: availabilityRequest,
      preferredDate: availabilityRequest.date,
    });
    return {
      status: 409,
      body: buildSlotUnavailableBody('Selected slot is no longer available.', alternatives),
    };
  }

  const packageByService = new Map<number, number>();
  for (const row of Array.isArray(input.packageSelections) ? input.packageSelections : []) {
    const serviceId = Number((row || {}).serviceId);
    const customerPackageId = Number((row || {}).customerPackageId);
    if (Number.isInteger(serviceId) && serviceId > 0 && Number.isInteger(customerPackageId) && customerPackageId > 0) {
      packageByService.set(serviceId, customerPackageId);
    }
  }

  const requestedServiceIds = input.services
    .map((item: any) => Number(item?.serviceId))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  const uniqueServiceIds = Array.from(new Set<number>(requestedServiceIds));
  const serviceCatalog = uniqueServiceIds.length
    ? await prisma.service.findMany({
        where: { salonId: input.salonId, id: { in: uniqueServiceIds } },
        select: { id: true, price: true, duration: true, name: true },
      })
    : [];
  const serviceById = new Map<number, { price: number; duration: number; name: string }>();
  for (const service of serviceCatalog) {
    serviceById.set(Number(service.id), {
      price: Number(service.price || 0),
      duration: Number(service.duration || 30),
      name: service.name,
    });
  }

  const servicesByPerson = new Map<number, any[]>();
  for (const service of input.services) {
    const personIndex =
      Number.isInteger(Number(service?.personIndex)) && Number(service.personIndex) > 0
        ? Number(service.personIndex)
        : 1;
    const list = servicesByPerson.get(personIndex) || [];
    list.push(service);
    servicesByPerson.set(personIndex, list);
  }
  const orderedPeople = Array.from(servicesByPerson.entries()).sort((a, b) => a[0] - b[0]);

  const earliestSelectedStart = matchedDisplaySlot.personSlots.reduce((earliest, slot) => {
    const candidate = new Date(`${availabilityRequest.date}T${slot.startTime}:00`).getTime();
    return candidate < earliest ? candidate : earliest;
  }, Number.MAX_SAFE_INTEGER);

  const pricingInputLines = orderedPeople.flatMap(([, personServices]) =>
    personServices.map((serviceItem: any) => {
      const serviceId = Number(serviceItem?.serviceId);
      const catalog = serviceById.get(serviceId);
      return {
        serviceId,
        listPrice: catalog ? catalog.price : 0,
        isPackageCovered: packageByService.has(serviceId),
      };
    }),
  );
  const pricingResult = await previewCampaignPricing({
    salonId: input.salonId,
    customerId: input.customerId,
    startTime: new Date(earliestSelectedStart),
    lines: pricingInputLines,
  });

  let txResult: any[];
  try {
    txResult = await prisma.$transaction(
      async (tx) => {
      const currentSearchContext = await tx.searchContext.findUnique({
        where: { id: input.availabilityLockToken },
      });

      if (!currentSearchContext || currentSearchContext.expiresAt < new Date()) {
        throw new Error('Availability selection has expired.');
      }

      const createdAppointments = [] as any[];
      let pricingLineIndex = 0;

      for (const [personIndex, personServices] of orderedPeople) {
        const selectedPersonSlot = matchedDisplaySlot.personSlots.find((slot) => slot.personId === `p${personIndex}`);
        if (!selectedPersonSlot) {
          throw new Error('Selected availability no longer matches requested people.');
        }
        if (selectedPersonSlot.serviceSequence.length !== personServices.length) {
          throw new Error('Selected availability no longer matches requested services.');
        }

        for (let serviceIndex = 0; serviceIndex < personServices.length; serviceIndex += 1) {
          const serviceItem = personServices[serviceIndex];
          const sequenceItem = selectedPersonSlot.serviceSequence[serviceIndex];
          const serviceId = Number(serviceItem?.serviceId);

          if (!Number.isInteger(serviceId) || serviceId <= 0 || sequenceItem.serviceId !== serviceId) {
            throw new Error('Selected availability no longer matches requested services.');
          }

          const start = new Date(`${availabilityRequest.date}T${sequenceItem.start}:00`);
          const end = new Date(`${availabilityRequest.date}T${sequenceItem.end}:00`);
          const staffId = Number(sequenceItem.staffId);

          const conflicting = await tx.appointment.findFirst({
            where: {
              salonId: input.salonId,
              staffId,
              startTime: { lt: end },
              endTime: { gt: start },
              status: 'BOOKED',
            },
            select: { id: true },
          });

          if (conflicting) {
            throw { code: 'SLOT_NOT_AVAILABLE', message: `Staff ${staffId} is busy at the selected time.` };
          }

          const requestedPreferenceMode =
            String(serviceItem?.staffPreference?.mode || '').trim().toUpperCase() === 'SPECIFIC' ? 'SPECIFIC' : 'ANY';
          const requestedPreferredStaffId = Number(serviceItem?.staffPreference?.preferredStaffId);
          const packageHint = packageByService.get(serviceId);
          const effectiveSpecific = requestedPreferenceMode === 'SPECIFIC' || Boolean(serviceItem?.staffId);
          const effectivePreferredStaffId =
            Number.isInteger(requestedPreferredStaffId) && requestedPreferredStaffId > 0
              ? requestedPreferredStaffId
              : effectiveSpecific
                ? staffId
                : null;
          const staffPreferenceNote = effectiveSpecific
            ? `[BOOK_PREF:SPECIFIC:${effectivePreferredStaffId || staffId}]`
            : '[BOOK_PREF:ANY]';
          const noteParts = [staffPreferenceNote, `[PERSON:${personIndex}]`];
          if (packageHint) {
            noteParts.push(`package:${packageHint}`);
          }

          const catalogInfo = serviceById.get(serviceId);
          const appointment = await tx.appointment.create({
            data: {
              salonId: input.salonId,
              customerId: input.customerId,
              customerName: input.customerName.trim(),
              customerPhone: input.customerPhone.trim(),
              staffId,
              serviceId,
              startTime: start,
              endTime: end,
              status: 'BOOKED',
              source: input.source === 'SALON' ? 'ADMIN' : 'CUSTOMER',
              preferenceMode: effectiveSpecific ? 'SPECIFIC' : 'ANY',
              preferredStaffId: effectiveSpecific ? (effectivePreferredStaffId || staffId) : null,
              notes: noteParts.join('\n'),
              listPrice: Number(pricingResult.lines[pricingLineIndex]?.listPrice || catalogInfo?.price || 0),
              discountTotal: Number(pricingResult.lines[pricingLineIndex]?.discountTotal || 0),
              finalPrice: Number(pricingResult.lines[pricingLineIndex]?.finalPrice || 0),
              campaignSnapshot: pricingResult.lines[pricingLineIndex]
                ? ({
                    appliedCampaigns: pricingResult.lines[pricingLineIndex].appliedCampaigns,
                    packageCovered: pricingResult.lines[pricingLineIndex].packageCovered,
                  } as any)
                : null,
            },
          });

          createdAppointments.push(appointment);
          if (pricingResult.lines[pricingLineIndex]) {
            await persistAppointmentCampaignApplication({
              salonId: input.salonId,
              appointmentId: Number(appointment.id),
              customerId: input.customerId,
              serviceId,
              line: pricingResult.lines[pricingLineIndex],
              db: tx,
            });
            await consumeWalletBalances({
              salonId: input.salonId,
              customerId: input.customerId,
              line: pricingResult.lines[pricingLineIndex],
            });
          }
          pricingLineIndex += 1;
        }
      }

      await tx.searchContext.delete({
        where: { id: input.availabilityLockToken },
      });

      return createdAppointments;
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error: any) {
    if (error?.code === 'SLOT_NOT_AVAILABLE') {
      const alternatives = await generateAvailabilityAlternatives({
        salonId: input.salonId,
        request: availabilityRequest,
        preferredDate: availabilityRequest.date,
      });
      return {
        status: 409,
        body: buildSlotUnavailableBody(error.message || 'Selected slot is no longer available.', alternatives),
      };
    }
    throw error;
  }

  if (input.token && typeof input.token === 'string') {
    try {
      await prisma.magicLink.updateMany({
        where: {
          token: input.token,
          salonId: input.salonId,
          usedAt: null,
          status: 'ACTIVE',
        },
        data: {
          usedAt: new Date(),
          status: 'USED',
        },
      });
    } catch (_) {}
  }

  if (input.referralShareToken && typeof input.referralShareToken === 'string') {
    try {
      await registerReferralAttributionFromToken({
        salonId: input.salonId,
        referredCustomerId: input.customerId,
        token: input.referralShareToken,
      });
    } catch (error) {
      console.warn('Referral attribution registration skipped:', error);
    }
  }

  const serviceIds = Array.from(new Set(txResult.map((appointment) => Number(appointment.serviceId)).filter((id) => Number.isInteger(id) && id > 0)));
  const createdServices = serviceIds.length
    ? await prisma.service.findMany({
        where: { salonId: input.salonId, id: { in: serviceIds } },
        select: { id: true, name: true },
      })
    : [];
  const serviceNameById = new Map<number, string>();
  for (const service of createdServices) {
    serviceNameById.set(Number(service.id), service.name);
  }

  await Promise.all(
    txResult.map((appointment) =>
      emitSameDayChangeBestEffort({
        salonId: input.salonId,
        event: 'CREATED',
        appointmentId: Number(appointment.id),
        customerName: appointment.customerName || input.customerName.trim(),
        serviceName: serviceNameById.get(Number(appointment.serviceId)) || null,
        startTime: appointment.startTime,
      }),
    ),
  );

  return {
    status: 201,
    body: {
      data: {
        appointments: txResult.map((appointment) => ({ id: appointment.id })),
        status: 'BOOKED',
        pricingBreakdown: pricingResult,
        appliedCampaigns: pricingResult.appliedCampaigns,
      },
    },
  };
}

interface AuthRequest extends Request {
  user?: {
    userId: number;
    salonId: number;
    role: 'OWNER' | 'STAFF';
  };
}

interface ConfirmBookingRequest {
  lockToken: string;
  customerName: string;
  customerPhone: string;
  serviceId: number;
  staffIds: number[]; // For multi-person bookings
}

interface CancelBookingRequest {
  bookingId: number;
}

interface RescheduleBookingRequest {
  bookingId: number;
  newSlot: {
    date: string; // ISO date string
    startTime: string; // HH:MM format
    serviceId: number;
    staffIds: number[];
    peopleCount: number;
  };
}

// POST /api/bookings/confirm - Confirm a booking using a lock token
router.post("/confirm", authenticateToken, async (req: any, res: any) => {
  const { lockToken, customerName, customerPhone, appointments: requestedAppointments } = req.body;

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  if (!lockToken || !customerName || !customerPhone || !Array.isArray(requestedAppointments)) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const salonId = req.user.salonId;

  try {
    await assertBookingAllowed({
      salonId,
      phone: customerPhone,
      channel: 'WHATSAPP',
    });

    const result = await prisma.$transaction(async (tx) => {
      const searchContext = await tx.searchContext.findUnique({
        where: { id: lockToken },
      });

      if (!searchContext) {
        return { error: 'Lock token not found.', status: 404 };
      }

      if (searchContext.expiresAt < new Date()) {
        return { error: 'Lock token has expired.', status: 410 };
      }

      if (searchContext.salonId !== salonId) {
        return { error: 'Salon mismatch.', status: 403 };
      }

      const engine = new SlotsEngine();
      const availabilityResult = await engine.generateSlots(searchContext.data as any, { persistSearchContext: false });

      for (const reqApt of requestedAppointments) {
          const group = availabilityResult.groups.find(g => g.personId === reqApt.personId);
          if (!group) return { error: 'Slot no longer available (person not found).', status: 409 };

          const slot = group.slots.find(s => 
              s.startTime === reqApt.startTime && 
              s.staffId === reqApt.staffId
          );

          if (!slot) return { error: 'Slot no longer available.', status: 409 };
      }

      const createdAppointments = [];
      for (const reqApt of requestedAppointments) {
          const [hours, minutes] = reqApt.startTime.split(':').map(Number);
          const startTime = new Date((searchContext.data as any).date);
          startTime.setHours(hours, minutes, 0, 0);

          const [endHours, endMinutes] = reqApt.endTime.split(':').map(Number);
          const endTime = new Date((searchContext.data as any).date);
          endTime.setHours(endHours, endMinutes, 0, 0);

          const appointment = await tx.appointment.create({
            data: {
              salonId,
              staffId: reqApt.staffId,
              serviceId: reqApt.serviceId,
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              startTime,
              endTime,
              status: 'BOOKED',
              source: 'CUSTOMER'
            }
          });
          createdAppointments.push(appointment);
      }

      await tx.searchContext.delete({
        where: { id: lockToken }
      });

      return { success: true, appointments: createdAppointments };
    }, {
        isolationLevel: 'Serializable'
    });

    if ('error' in result) {
        return res.status(result.status).json({ message: result.error });
    }

    const serviceIds = Array.from(new Set(result.appointments.map((apt) => Number(apt.serviceId)).filter((id) => Number.isInteger(id) && id > 0)));
    const services = serviceIds.length
      ? await prisma.service.findMany({
          where: { salonId, id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : [];
    const serviceNameById = new Map<number, string>();
    for (const service of services) {
      serviceNameById.set(Number(service.id), service.name);
    }

    await Promise.all(
      result.appointments.map((apt) =>
        emitSameDayChangeBestEffort({
          salonId,
          event: 'CREATED',
          appointmentId: Number(apt.id),
          customerName: String(apt.customerName || customerName),
          serviceName: serviceNameById.get(Number(apt.serviceId)) || null,
          startTime: new Date(apt.startTime),
        }),
      ),
    );

    res.status(201).json({
      message: 'Booking confirmed successfully.',
      appointments: result.appointments.map(apt => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        staffId: apt.staffId,
        serviceId: apt.serviceId
      }))
    });

  } catch (error: any) {
    if (error?.code === 'CUSTOMER_BANNED' || error?.message === 'CUSTOMER_BANNED') {
      return sendCustomerBannedResponse(res, error?.ban?.reason || null);
    }
    console.error('Error confirming booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/bookings/cancel - Cancel an existing booking
router.post("/cancel", authenticateToken, async (req: any, res: any) => {
  const { bookingId } = req.body as any;

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  if (!bookingId || typeof bookingId !== 'number') {
    return res.status(400).json({ message: 'Valid bookingId is required.' });
  }

  const salonId = req.user.salonId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bookingRecord = await tx.$queryRaw`
        SELECT * FROM randevular
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
        FOR UPDATE
      ` as any[];

      if (bookingRecord.length === 0) {
        return { status: 404, body: { message: 'Booking not found.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      const booking = bookingRecord[0];

      if (booking.hizmet_durumu === 'iptal') {
        return {
          status: 200,
          body: {
            message: 'Booking is already cancelled.',
            bookingId,
          },
          notify: null as null | {
            appointmentId: number;
            customerName: string;
            serviceName: string | null;
            startTime: Date;
          },
        };
      }

      const bookingDate = DateNormalizer.parseDate(booking.tarih);
      const bookingTimeMinutes = DateNormalizer.parseTimeToMinutes(booking.saat);
      const bookingStartTime = DateNormalizer.createDateTime(booking.tarih, bookingTimeMinutes);

      if (bookingStartTime <= new Date()) {
        return { status: 400, body: { message: 'Cannot cancel past bookings.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      await tx.$executeRaw`
        UPDATE randevular
        SET hizmet_durumu = 'iptal',
            erteleme_iptal_zamani = NOW(),
            updated_at = NOW()
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
      `;

      const appointment = await tx.appointment.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          salonId: true,
          customerName: true,
          startTime: true,
          service: { select: { name: true } },
        },
      });

      if (appointment && appointment.salonId === salonId) {
        await tx.appointment.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            updatedAt: new Date()
          }
        });
      }

      await tx.$executeRaw`
        DELETE FROM temporary_locks
        WHERE salon_id = ${salonId}
        AND tarih = ${booking.tarih}
        AND saat = ${booking.saat}
        AND sure = ${booking.sure}
      `;

      return {
        status: 200,
        body: {
          message: 'Booking cancelled successfully.',
          bookingId,
        },
        notify: appointment && appointment.salonId === salonId
          ? {
              appointmentId: Number(appointment.id),
              customerName: appointment.customerName || booking.musteri_adi || 'Müşteri',
              serviceName: appointment.service?.name || null,
              startTime: appointment.startTime,
            }
          : null,
      };
    });

    if (result.notify) {
      await emitSameDayChangeBestEffort({
        salonId,
        event: 'CANCELLED',
        appointmentId: result.notify.appointmentId,
        customerName: result.notify.customerName,
        serviceName: result.notify.serviceName,
        startTime: result.notify.startTime,
      });
      await matchWaitlistForDate(salonId, result.notify.startTime.toISOString().slice(0, 10)).catch(() => undefined);
    }
    return res.status(result.status).json(result.body);

  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/reschedule-preview', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Salon context is required.' });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  const newStartTime = parseIsoDate(req.body?.newStartTime);
  const assignments = parseRescheduleAssignments(req.body?.assignments);

  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
  }
  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }
  if (!newStartTime) {
    return res.status(400).json({ message: 'newStartTime is required as ISO date.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const ownedAppointments = await prisma.appointment.findMany({
      where: {
        salonId,
        customerId: resolved.customerId,
        id: { in: appointmentIds },
      },
      select: {
        id: true,
        status: true,
        startTime: true,
      },
    });
    if (ownedAppointments.length !== appointmentIds.length) {
      return res.status(403).json({ message: 'One or more appointments do not belong to this customer.' });
    }
    if (ownedAppointments.some((item) => !isReschedulableAppointmentStatus(item.status))) {
      return res.status(409).json({ message: 'Only BOOKED/CONFIRMED appointments can be updated.' });
    }
    if (ownedAppointments.some((item) => new Date(item.startTime).getTime() <= Date.now())) {
      return res.status(409).json({ message: 'Past appointments cannot be updated.' });
    }

    const preview = await buildAppointmentReschedulePreview({
      salonId,
      appointmentIds,
      newStartTime,
      assignments,
    });

    return res.status(200).json(preview);
  } catch (error) {
    console.error('Booking reschedule preview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/reschedule-options', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Salon context is required.' });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
  const assignments = parseRescheduleAssignments(req.body?.assignments);

  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
  }
  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }
  if (!date) {
    return res.status(400).json({ message: 'date is required as YYYY-MM-DD.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const ownedAppointments = await prisma.appointment.findMany({
      where: {
        salonId,
        customerId: resolved.customerId,
        id: { in: appointmentIds },
      },
      select: {
        id: true,
        status: true,
        startTime: true,
      },
    });
    if (ownedAppointments.length !== appointmentIds.length) {
      return res.status(403).json({ message: 'One or more appointments do not belong to this customer.' });
    }
    if (ownedAppointments.some((item) => !isReschedulableAppointmentStatus(item.status))) {
      return res.status(409).json({ message: 'Only BOOKED/CONFIRMED appointments can be updated.' });
    }
    if (ownedAppointments.some((item) => new Date(item.startTime).getTime() <= Date.now())) {
      return res.status(409).json({ message: 'Past appointments cannot be updated.' });
    }

    const options = await buildRescheduleOptions({
      salonId,
      appointmentIds,
      date,
      assignments,
    });

    return res.status(200).json(options);
  } catch (error) {
    console.error('Booking reschedule options error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/reschedule-commit', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Salon context is required.' });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  const newStartTime = parseIsoDate(req.body?.newStartTime);
  const assignments = parseRescheduleAssignments(req.body?.assignments);
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : null;

  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
  }
  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }
  if (!newStartTime) {
    return res.status(400).json({ message: 'newStartTime is required as ISO date.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const ownedAppointments = await prisma.appointment.findMany({
      where: {
        salonId,
        customerId: resolved.customerId,
        id: { in: appointmentIds },
      },
      select: {
        id: true,
        status: true,
        startTime: true,
      },
    });
    if (ownedAppointments.length !== appointmentIds.length) {
      return res.status(403).json({ message: 'One or more appointments do not belong to this customer.' });
    }
    if (ownedAppointments.some((item) => !isReschedulableAppointmentStatus(item.status))) {
      return res.status(409).json({ message: 'Only BOOKED/CONFIRMED appointments can be updated.' });
    }
    if (ownedAppointments.some((item) => new Date(item.startTime).getTime() <= Date.now())) {
      return res.status(409).json({ message: 'Past appointments cannot be updated.' });
    }

    const committed = await commitAppointmentReschedule({
      salonId,
      appointmentIds,
      newStartTime,
      assignments,
      idempotencyKey,
    });

    await Promise.all(
      committed.previousAppointmentIds.map((appointmentId) =>
        releaseAppointmentCampaignApplications({ salonId, appointmentId }),
      ),
    );

    await Promise.all(
      committed.createdAppointments.map((apt) =>
        emitSameDayChangeBestEffort({
          salonId,
          event: 'UPDATED',
          appointmentId: apt.id,
          customerName: apt.customerName,
          serviceName: apt.service?.name || null,
          startTime: new Date(apt.startTime),
        }),
      ),
    );
    await Promise.all(
      ownedAppointments.map((apt) =>
        matchWaitlistForDate(salonId, new Date(apt.startTime).toISOString().slice(0, 10)).catch(() => undefined),
      ),
    );

    return res.status(200).json({
      batchId: committed.batchId,
      previousAppointmentIds: committed.previousAppointmentIds,
      items: committed.createdAppointments,
    });
  } catch (error: any) {
    if (error?.code === 'CUSTOMER_BANNED' || error?.message === 'CUSTOMER_BANNED') {
      return sendCustomerBannedResponse(res, error?.ban?.reason || null);
    }
    const message = error?.message || 'Internal server error.';
    const status = /manual specialist selection|no eligible|only booked|not found|cannot/i.test(message) ? 409 : 500;
    if (status === 500) {
      console.error('Booking reschedule commit error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.post('/cancel-by-token', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Salon context is required.' });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
  }
  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const ownedAppointments = await prisma.appointment.findMany({
      where: {
        salonId,
        customerId: resolved.customerId,
        id: { in: appointmentIds },
      },
      select: {
        id: true,
        status: true,
        startTime: true,
        customerName: true,
        service: { select: { name: true } },
      },
    });
    if (ownedAppointments.length !== appointmentIds.length) {
      return res.status(403).json({ message: 'One or more appointments do not belong to this customer.' });
    }
    if (ownedAppointments.some((item) => !isCancelableAppointmentStatus(item.status))) {
      return res.status(409).json({ message: 'Only BOOKED/CONFIRMED/UPDATED appointments can be cancelled.' });
    }
    if (ownedAppointments.some((item) => new Date(item.startTime).getTime() <= Date.now())) {
      return res.status(409).json({ message: 'Past appointments cannot be cancelled.' });
    }

    await prisma.appointment.updateMany({
      where: {
        salonId,
        customerId: resolved.customerId,
        id: { in: appointmentIds },
      },
      data: {
        status: 'CANCELLED',
        updatedAt: new Date(),
      },
    });

    await Promise.all(
      appointmentIds.map((appointmentId) =>
        releaseAppointmentCampaignApplications({ salonId, appointmentId }),
      ),
    );

    await Promise.all(
      ownedAppointments.map((apt) =>
        emitSameDayChangeBestEffort({
          salonId,
          event: 'CANCELLED',
          appointmentId: apt.id,
          customerName: apt.customerName,
          serviceName: apt.service?.name || null,
          startTime: new Date(apt.startTime),
        }),
      ),
    );
    await Promise.all(
      ownedAppointments.map((apt) =>
        matchWaitlistForDate(salonId, new Date(apt.startTime).toISOString().slice(0, 10)).catch(() => undefined),
      ),
    );

    return res.status(200).json({
      cancelledAppointmentIds: appointmentIds,
      count: appointmentIds.length,
    });
  } catch (error) {
    console.error('Booking cancel-by-token error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/feedback', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Salon context is required.' });
  }

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const appointmentId = Number(req.body?.appointmentId);
  const rating = Number(req.body?.rating);
  const review = typeof req.body?.review === 'string' ? req.body.review.trim() : '';

  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
  }
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'appointmentId must be a positive integer.' });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'rating must be between 1 and 5.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        salonId,
        customerId: resolved.customerId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found for this customer.' });
    }
    if (String(appointment.status || '').toUpperCase() !== 'COMPLETED') {
      return res.status(409).json({ message: 'Only completed appointments can be reviewed.' });
    }

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        customerRating: rating,
        customerReview: review || null,
        customerReviewedAt: new Date(),
      },
      select: {
        id: true,
        customerRating: true,
        customerReview: true,
        customerReviewedAt: true,
      },
    });

    return res.status(200).json({ item: updated });
  } catch (error) {
    console.error('Booking feedback error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/bookings/reschedule - Reschedule an existing booking
router.post("/reschedule", authenticateToken, async (req: any, res: any) => {
  const { bookingId, newSlot } = req.body as any;

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  if (!bookingId || typeof bookingId !== 'number' || !newSlot ||
      !newSlot.date || !newSlot.startTime || !newSlot.serviceId ||
      !Array.isArray(newSlot.staffIds) || newSlot.staffIds.length === 0 ||
      typeof newSlot.peopleCount !== 'number') {
    return res.status(400).json({ message: 'Missing or invalid required fields.' });
  }

  const salonId = req.user.salonId;

  try {
    const modernAppointment = await prisma.appointment.findFirst({
      where: { id: bookingId, salonId },
      select: {
        id: true,
        customerId: true,
        customerName: true,
        customerPhone: true,
        startTime: true,
        service: { select: { name: true } },
      },
    });

    if (modernAppointment) {
      await assertBookingAllowed({
        salonId,
        customerId: modernAppointment.customerId,
        phone: modernAppointment.customerPhone,
        channel: 'WHATSAPP',
      });

      const parsedStart = parseIsoDate(`${newSlot.date}T${newSlot.startTime}:00`);
      if (!parsedStart) {
        return res.status(400).json({ message: 'Invalid newSlot date/time.' });
      }

      const preferredStaffId = Number(Array.isArray(newSlot.staffIds) ? newSlot.staffIds[0] : null);
      const assignments =
        Number.isInteger(preferredStaffId) && preferredStaffId > 0 ? { [bookingId]: preferredStaffId } : {};

      const committed = await commitAppointmentReschedule({
        salonId,
        appointmentIds: [bookingId],
        newStartTime: parsedStart,
        assignments,
        idempotencyKey: null,
      });

      if (committed.createdAppointments.length) {
        const first = committed.createdAppointments[0];
        await emitSameDayChangeBestEffort({
          salonId,
          event: 'UPDATED',
          appointmentId: first.id,
          customerName: first.customerName,
          serviceName: first.service?.name || modernAppointment.service?.name || null,
          startTime: new Date(first.startTime),
        });
      }

      return res.status(200).json({
        message: 'Booking rescheduled successfully.',
        oldBookingId: bookingId,
        newAppointments: committed.createdAppointments.map((apt) => ({
          id: apt.id,
          startTime: apt.startTime,
          endTime: apt.endTime,
          staffId: apt.staffId,
          serviceId: apt.serviceId,
        })),
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const bookingRecord = await tx.$queryRaw`
        SELECT * FROM randevular
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
        FOR UPDATE
      ` as any[];

      if (bookingRecord.length === 0) {
        return { status: 404, body: { message: 'Booking not found.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      const booking = bookingRecord[0];

      await assertBookingAllowed({
        salonId,
        phone: String(booking.musteri_telefonu || ''),
        channel: 'WHATSAPP',
      });

      if (booking.hizmet_durumu === 'iptal') {
        return { status: 400, body: { message: 'Cannot reschedule a cancelled booking.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      if (booking.hizmet_durumu === 'rescheduling') {
        return { status: 409, body: { message: 'Booking is currently being rescheduled.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      const bookingDate = DateNormalizer.parseDate(booking.tarih);
      const bookingTimeMinutes = DateNormalizer.parseTimeToMinutes(booking.saat);
      const bookingStartTime = DateNormalizer.createDateTime(booking.tarih, bookingTimeMinutes);

      if (bookingStartTime <= new Date()) {
        return { status: 400, body: { message: 'Cannot reschedule past bookings.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      await tx.$executeRaw`
        UPDATE randevular
        SET hizmet_durumu = 'rescheduling',
            updated_at = NOW()
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
      `;

      const engine = new AvailabilityEngine();
      const availabilityResult = await engine.calculateAvailability({
        date: new Date(newSlot.date),
        serviceId: newSlot.serviceId,
        peopleCount: newSlot.peopleCount,
        salonId
      });

      const newSlotStartMinutes = DateNormalizer.parseTimeToMinutes(newSlot.startTime);
      const newSlotStart = DateNormalizer.createDateTime(newSlot.date, newSlotStartMinutes);

      const slotAvailable = availabilityResult.slots.some(slot =>
        slot.startTime.getTime() === newSlotStart.getTime() &&
        slot.availableStaff.length >= newSlot.staffIds.length &&
        newSlot.staffIds.every((staffId: number) => slot.availableStaff.includes(staffId))
      );

      if (!slotAvailable) {
        await tx.$executeRaw`
          UPDATE randevular
          SET hizmet_durumu = 'aktif',
              updated_at = NOW()
          WHERE id = ${bookingId}
          AND salon_id = ${salonId}
        `;
        return { status: 409, body: { message: 'New slot is not available.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      const lockId = `reschedule-${bookingId}-${Date.now()}`;
      const staffService = await tx.staffService.findFirst({
        where: {
          serviceId: newSlot.serviceId,
          staffId: newSlot.staffIds[0],
          Staff: { salonId }
        }
      });
      const service = await tx.service.findFirst({
        where: { id: newSlot.serviceId, salonId }
      });
      if (!service) {
        await tx.$executeRaw`
          UPDATE randevular
          SET hizmet_durumu = 'aktif',
              updated_at = NOW()
          WHERE id = ${bookingId}
          AND salon_id = ${salonId}
        `;
        return { status: 404, body: { message: 'Service not found.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }
      const duration = staffService?.duration ?? service.duration;

      await tx.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, ${newSlot.date}, ${newSlot.startTime}, ${duration}, ${new Date(Date.now() + 5 * 60 * 1000)}, NOW())
      `;

      const validStaff = await tx.staff.findMany({
        where: {
          id: { in: newSlot.staffIds },
          salonId
        }
      });

      if (validStaff.length !== newSlot.staffIds.length) {
        await tx.$executeRaw`
          UPDATE randevular
          SET hizmet_durumu = 'aktif',
              updated_at = NOW()
          WHERE id = ${bookingId}
          AND salon_id = ${salonId}
        `;
        await tx.$executeRaw`
          DELETE FROM temporary_locks WHERE id = ${lockId}
        `;
        return { status: 400, body: { message: 'Invalid staff selection for new slot.' }, notify: null as null | {
          appointmentId: number;
          customerName: string;
          serviceName: string | null;
          startTime: Date;
        } };
      }

      const newSlotEnd = new Date(newSlotStart.getTime() + duration * 60 * 1000);
      const newAppointments = [];

      for (const staffId of newSlot.staffIds) {
        const appointment = await tx.appointment.create({
          data: {
            salonId,
            staffId,
            serviceId: newSlot.serviceId,
            customerName: booking.musteri_adi,
            customerPhone: booking.musteri_telefonu,
            startTime: newSlotStart,
            endTime: newSlotEnd,
            status: 'BOOKED',
            source: 'ADMIN' 
          }
        });
        newAppointments.push(appointment);
      }

      await tx.$executeRaw`
        UPDATE randevular
        SET hizmet_durumu = 'iptal',
            erteleme_iptal_zamani = NOW(),
            updated_at = NOW()
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
      `;

      const oldAppointment = await tx.appointment.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          salonId: true,
          customerName: true,
          startTime: true,
        },
      });

      if (oldAppointment && oldAppointment.salonId === salonId) {
        await tx.appointment.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            updatedAt: new Date()
          }
        });
      }

      await tx.$executeRaw`
        DELETE FROM temporary_locks WHERE id = ${lockId}
      `;

      return {
        status: 200,
        body: {
          message: 'Booking rescheduled successfully.',
          oldBookingId: bookingId,
          newAppointments: newAppointments.map(apt => ({
            id: apt.id,
            startTime: apt.startTime,
            endTime: apt.endTime,
            staffId: apt.staffId,
            serviceId: apt.serviceId
          })),
        },
        notify: newAppointments.length
          ? {
              appointmentId: Number(newAppointments[0].id),
              customerName: oldAppointment?.customerName || booking.musteri_adi || 'Müşteri',
              serviceName: service.name,
              startTime: newSlotStart,
            }
          : null,
        releasedAppointmentId: Number(bookingId),
      };
    });

    if (result.releasedAppointmentId) {
      await releaseAppointmentCampaignApplications({
        salonId,
        appointmentId: result.releasedAppointmentId,
      });
    }

    if (result.notify) {
      await emitSameDayChangeBestEffort({
        salonId,
        event: 'UPDATED',
        appointmentId: result.notify.appointmentId,
        customerName: result.notify.customerName,
        serviceName: result.notify.serviceName,
        startTime: result.notify.startTime,
      });
    }
    return res.status(result.status).json(result.body);

  } catch (error: any) {
    if (error?.code === 'CUSTOMER_BANNED' || error?.message === 'CUSTOMER_BANNED') {
      return sendCustomerBannedResponse(res, error?.ban?.reason || null);
    }
    console.error('Error rescheduling booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/pricing-preview', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Missing tenant context.' });
  }

  const startTime = parseIsoDate(req.body?.startTime || req.body?.datetime || new Date().toISOString());
  if (!startTime) {
    return res.status(400).json({ message: 'startTime is required.' });
  }

  const customerIdRaw = Number(req.body?.customerId);
  const customerId = Number.isInteger(customerIdRaw) && customerIdRaw > 0 ? customerIdRaw : null;
  const services = Array.isArray(req.body?.services) ? req.body.services : [];
  const packageSelections = Array.isArray(req.body?.packageSelections) ? req.body.packageSelections : [];
  const packageByService = new Set<number>();
  for (const row of packageSelections) {
    const serviceId = Number((row || {}).serviceId);
    if (Number.isInteger(serviceId) && serviceId > 0) packageByService.add(serviceId);
  }

  const requestedServiceIds = services
    .map((item: any) => Number(item?.serviceId))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  if (!requestedServiceIds.length) {
    return res.status(400).json({ message: 'services[] is required.' });
  }

  try {
    const uniqueServiceIds: number[] = Array.from(new Set<number>(requestedServiceIds));
    const catalog = await prisma.service.findMany({
      where: { salonId, id: { in: uniqueServiceIds } },
      select: { id: true, price: true },
    });
    const priceByServiceId = new Map<number, number>();
    for (const item of catalog) {
      priceByServiceId.set(Number(item.id), Number(item.price || 0));
    }

    const lines = requestedServiceIds.map((serviceId) => ({
      serviceId,
      listPrice: Math.max(0, Number(priceByServiceId.get(serviceId) || 0)),
      isPackageCovered: packageByService.has(serviceId),
    }));

    const pricing = await previewCampaignPricing({
      salonId,
      customerId,
      startTime,
      lines,
    });

    return res.status(200).json(pricing);
  } catch (error) {
    console.error('Booking pricing-preview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/referral/enroll', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const token = String(req.body?.token || '').trim();
  const campaignId = Number(req.body?.campaignId);

  if (!salonId || !token || !Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'token and campaignId are required.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const enrollment = await upsertReferralEnrollment({
      salonId,
      customerId: resolved.customerId,
      campaignId,
    });

    return res.status(200).json({
      enrollment: {
        campaignId: enrollment.campaignId,
        shareToken: enrollment.shareToken,
      },
    });
  } catch (error) {
    console.error('Booking referral enroll error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/referral/share-link', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const token = String(req.body?.token || '').trim();
  const campaignId = Number(req.body?.campaignId);

  if (!salonId || !token || !Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'token and campaignId are required.' });
  }

  try {
    const resolved = await resolveMagicTokenCustomer({ token, salonId });
    if ('error' in resolved) {
      return res.status(resolved.code).json({ message: resolved.error });
    }

    const enrollment = await upsertReferralEnrollment({
      salonId,
      customerId: resolved.customerId,
      campaignId,
    });

    return res.status(200).json({
      share: {
        campaignId,
        token: enrollment.shareToken,
      },
    });
  } catch (error) {
    console.error('Booking referral share-link error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/bookings - Create appointment (frontend booking flow)
router.post('/', async (req: any, res: any, next: any) => {
  const b = req.body || {};
  const salonId = req.salon?.id;

  // Support for multiple services
  if (
    salonId &&
    typeof b.customerId === 'number' &&
    typeof b.customerName === 'string' &&
    typeof b.customerPhone === 'string' &&
    Array.isArray(b.services) &&
    b.services.length > 0 &&
    (b.source === 'CUSTOMER' || b.source === 'SALON')
  ) {
    const {
      customerId,
      customerName,
      customerPhone,
      services,
      source,
      token,
      packageSelections,
      referralShareToken,
    } = b;
    const normalizedCustomerName = resolveCustomerNameParts({
      firstName: b.customerFirstName,
      lastName: b.customerLastName,
      fullName: customerName,
    });
    if (!normalizedCustomerName.firstName || !normalizedCustomerName.lastName) {
      return res.status(400).json({ message: 'customerFirstName and customerLastName are required.' });
    }
    const normalizedCustomerPhone = String(customerPhone || '').trim();
    if (!normalizedCustomerPhone) {
      return res.status(400).json({ message: 'customerPhone is required.' });
    }

    try {
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          salonId,
        },
        select: {
          id: true,
          phone: true,
          name: true,
          firstName: true,
          lastName: true,
        },
      });

      if (!existingCustomer) {
        return res.status(404).json({ message: 'Customer not found for salon.' });
      }

      if (
        existingCustomer.name !== normalizedCustomerName.fullName ||
        (existingCustomer.firstName || '') !== normalizedCustomerName.firstName ||
        (existingCustomer.lastName || '') !== normalizedCustomerName.lastName
      ) {
        await prisma.customer.update({
          where: { id: existingCustomer.id },
          data: {
            name: normalizedCustomerName.fullName,
            firstName: normalizedCustomerName.firstName,
            lastName: normalizedCustomerName.lastName,
          },
        });
      }

      await assertBookingAllowed({
        salonId,
        customerId,
        phone: normalizedCustomerPhone,
        channel: 'WHATSAPP',
      });

      const createdAppointments = [];
      let currentStartTime = new Date(b.startTime);
      
      // Double check date validity
      if (isNaN(currentStartTime.getTime())) {
          return res.status(400).json({ message: 'Geçersiz randevu saati formatı (ISO beklenen).' });
      }

      const availabilityLockToken =
        typeof b.availabilityLockToken === 'string' && b.availabilityLockToken.trim()
          ? b.availabilityLockToken.trim()
          : '';
      const selectedSlots = parseSelectedPersonSlots(b.selectedSlots);

      if (availabilityLockToken && selectedSlots.length) {
        const exactResult = await createExactSlotBooking({
          salonId,
          customerId,
          customerName: normalizedCustomerName.fullName,
          customerPhone: normalizedCustomerPhone,
          services,
          source,
          token: typeof token === 'string' ? token : null,
          packageSelections,
          referralShareToken: typeof referralShareToken === 'string' ? referralShareToken : null,
          availabilityLockToken,
          selectedSlots,
        });
        return res.status(exactResult.status).json(exactResult.body);
      }

      const packageByService = new Map<number, number>();
      if (Array.isArray(packageSelections)) {
        for (const row of packageSelections) {
          const serviceId = Number((row || {}).serviceId);
          const customerPackageId = Number((row || {}).customerPackageId);
          if (Number.isInteger(serviceId) && serviceId > 0 && Number.isInteger(customerPackageId) && customerPackageId > 0) {
            packageByService.set(serviceId, customerPackageId);
          }
        }
      }

      const requestedServiceIds = services
        .map((item: any) => Number(item?.serviceId))
        .filter((id: number) => Number.isInteger(id) && id > 0);
      const uniqueServiceIds: number[] = Array.from(new Set<number>(requestedServiceIds));
      const serviceCatalog = uniqueServiceIds.length
        ? await prisma.service.findMany({
            where: { salonId, id: { in: uniqueServiceIds } },
            select: { id: true, price: true, duration: true },
          })
        : [];
      const serviceById = new Map<number, { price: number; duration: number }>();
      for (const svc of serviceCatalog) {
        serviceById.set(Number(svc.id), {
          price: Number(svc.price || 0),
          duration: Number(svc.duration || 30),
        });
      }

      const servicesByPerson = new Map<number, any[]>();
      for (const serviceItem of services) {
        const personIndex = Number.isInteger(Number(serviceItem?.personIndex)) && Number(serviceItem.personIndex) > 0
          ? Number(serviceItem.personIndex)
          : 1;
        const list = servicesByPerson.get(personIndex) || [];
        list.push(serviceItem);
        servicesByPerson.set(personIndex, list);
      }

      const orderedPeople = Array.from(servicesByPerson.entries()).sort((a, b) => a[0] - b[0]);
      const pricingInputLines = orderedPeople.flatMap(([, personServices]) =>
        personServices.map((serviceItem: any) => {
          const serviceId = Number(serviceItem?.serviceId);
          const catalog = serviceById.get(serviceId);
          return {
            serviceId,
            listPrice: catalog ? catalog.price : 0,
            isPackageCovered: packageByService.has(serviceId),
          };
        }),
      );
      const pricingResult = await previewCampaignPricing({
        salonId,
        customerId,
        startTime: currentStartTime,
        lines: pricingInputLines,
      });
      let pricingLineIndex = 0;

      for (const [personIndex, personServices] of orderedPeople) {
        let personStartTime = new Date(b.startTime);
        for (const serviceItem of personServices) {
          const serviceId = parseInt(serviceItem.serviceId);
          let staffId = parseInt(serviceItem.staffId);
          const staffOptionIds = Array.isArray(serviceItem?.staffOptionIds)
            ? serviceItem.staffOptionIds.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
            : [];
          const requestedPreferenceMode =
            String(serviceItem?.staffPreference?.mode || '').trim().toUpperCase() === 'SPECIFIC' ? 'SPECIFIC' : 'ANY';
          const requestedPreferredStaffId = Number(serviceItem?.staffPreference?.preferredStaffId);
          
          if (!staffId) {
              if (staffOptionIds.length) {
                const optionStaff = await prisma.staffService.findFirst({
                  where: {
                    serviceId,
                    staffId: { in: staffOptionIds },
                    Staff: { salonId },
                    isactive: true
                  },
                  select: { staffId: true },
                  orderBy: { staffId: 'asc' },
                });
                if (optionStaff) {
                  staffId = optionStaff.staffId;
                }
              }

              if (!staffId) {
                // Auto-assign: Find any staff that can perform this service in this salon
                const autoStaff = await prisma.staffService.findFirst({
                    where: {
                      serviceId,
                      Staff: { salonId },
                      isactive: true
                    },
                    select: { staffId: true }
                });
                
                if (autoStaff) {
                    staffId = autoStaff.staffId;
                } else {
                    return res.status(400).json({ message: `${serviceId} ID'li hizmeti verebilecek aktif personel bulunamadı.` });
                }
              }
          }

          const catalogInfo = serviceById.get(serviceId);
          const duration = parseInt(serviceItem.duration) || catalogInfo?.duration || 30;
          
          const start = new Date(personStartTime);
          const end = new Date(start.getTime() + duration * 60 * 1000);

          // Simple collision check
          const conflicting = await prisma.appointment.findFirst({
              where: {
                  salonId,
                  staffId,
                  startTime: { lt: end },
                  endTime: { gt: start },
                  status: 'BOOKED'
              }
          });

          if (conflicting) {
              return res.status(409).json({ error: 'SLOT_NOT_AVAILABLE', message: `Personel (${staffId}) bu saatte dolu.` });
          }

          const packageHint = packageByService.get(serviceId);
          const effectiveSpecific = requestedPreferenceMode === 'SPECIFIC' || Boolean(serviceItem.staffId);
          const effectivePreferredStaffId =
            Number.isInteger(requestedPreferredStaffId) && requestedPreferredStaffId > 0
              ? requestedPreferredStaffId
              : effectiveSpecific
                ? staffId
                : null;
          const staffPreferenceNote = effectiveSpecific
            ? `[BOOK_PREF:SPECIFIC:${effectivePreferredStaffId || staffId}]`
            : '[BOOK_PREF:ANY]';
          const noteParts = [staffPreferenceNote];
          noteParts.push(`[PERSON:${personIndex}]`);
          if (packageHint) {
            noteParts.push(`package:${packageHint}`);
          }
          const appointment = await prisma.appointment.create({
            data: {
              salonId,
              customerId,
              customerName: normalizedCustomerName.fullName,
              customerPhone: normalizedCustomerPhone,
              staffId,
              serviceId,
              startTime: start,
              endTime: end,
              status: 'BOOKED',
              source: source === 'SALON' ? 'ADMIN' : 'CUSTOMER',
              preferenceMode: effectiveSpecific ? 'SPECIFIC' : 'ANY',
              preferredStaffId: effectiveSpecific ? (effectivePreferredStaffId || staffId) : null,
              notes: noteParts.join('\n'),
              listPrice: Number(pricingResult.lines[pricingLineIndex]?.listPrice || catalogInfo?.price || 0),
              discountTotal: Number(pricingResult.lines[pricingLineIndex]?.discountTotal || 0),
              finalPrice: Number(pricingResult.lines[pricingLineIndex]?.finalPrice || 0),
              campaignSnapshot: pricingResult.lines[pricingLineIndex]
                ? ({
                    appliedCampaigns: pricingResult.lines[pricingLineIndex].appliedCampaigns,
                    packageCovered: pricingResult.lines[pricingLineIndex].packageCovered,
                  } as any)
                : null,
            }
          });
          createdAppointments.push(appointment);
          if (pricingResult.lines[pricingLineIndex]) {
            await persistAppointmentCampaignApplication({
              salonId,
              appointmentId: Number(appointment.id),
              customerId,
              serviceId,
              line: pricingResult.lines[pricingLineIndex],
            });
            await consumeWalletBalances({
              salonId,
              customerId,
              line: pricingResult.lines[pricingLineIndex],
            });
          }
          pricingLineIndex += 1;
          
          // Next service starts after this one
          // Sequential: next service starts when previous one ends
          personStartTime = new Date(end.getTime());
        }
      }

      // Record behavior tracking or other logs if needed
      console.log(`Successfully created ${createdAppointments.length} sequential appointments for customer ${customerId}`);

      if (token && typeof token === 'string') {
        try {
          await prisma.magicLink.updateMany({
            where: { 
                token,
                salonId,
                usedAt: null,
                status: 'ACTIVE',
            },
            data: {
              usedAt: new Date(),
              status: 'USED',
            }
          });
        } catch (_) {}
      }

      if (referralShareToken && typeof referralShareToken === 'string') {
        try {
          await registerReferralAttributionFromToken({
            salonId,
            referredCustomerId: customerId,
            token: referralShareToken,
          });
        } catch (error) {
          console.warn('Referral attribution registration skipped:', error);
        }
      }

      const serviceIds = Array.from(new Set(createdAppointments.map((apt) => Number(apt.serviceId)).filter((id) => Number.isInteger(id) && id > 0)));
      const createdServices = serviceIds.length
        ? await prisma.service.findMany({
            where: { salonId, id: { in: serviceIds } },
            select: { id: true, name: true },
          })
        : [];
      const serviceNameById = new Map<number, string>();
      for (const service of createdServices) {
        serviceNameById.set(Number(service.id), service.name);
      }

      await Promise.all(
        createdAppointments.map((apt) =>
          emitSameDayChangeBestEffort({
            salonId,
            event: 'CREATED',
            appointmentId: Number(apt.id),
            customerName: apt.customerName || normalizedCustomerName.fullName,
            serviceName: serviceNameById.get(Number(apt.serviceId)) || null,
            startTime: apt.startTime,
          }),
        ),
      );

      return res.status(201).json({
        data: {
            appointments: createdAppointments.map(a => ({ id: a.id })),
            status: 'BOOKED',
            pricingBreakdown: pricingResult,
            appliedCampaigns: pricingResult.appliedCampaigns,
        },
      });
    } catch (error: any) {
      if (error?.code === 'CUSTOMER_BANNED' || error?.message === 'CUSTOMER_BANNED') {
        return sendCustomerBannedResponse(res, error?.ban?.reason || null);
      }
      console.error('Booking Error Details:', {
          message: error.message,
          stack: error.stack,
          body: b
      });
      return res.status(500).json({ 
          message: 'Randevu oluşturulurken bir sunucu hatası oluştu.',
          error: error.message 
      });
    }
  }
  next();
});

// POST /appointments - Create appointment using magic link token
router.post('/appointments-by-token', async (req: any, res: any) => {
  const { token, datetime, people, campaignOptIn } = req.body as any;
  const salonId = req.salon?.id;

  if (!token || !salonId || !datetime || !Array.isArray(people) || people.length === 0) {
    return res.status(400).json({ message: 'Missing required fields or tenant context' });
  }

  try {
    const magicLink = await prisma.magicLink.findFirst({
      where: {
        token,
        salonId,
      },
    });

    if (!magicLink) {
      return res.status(404).json({ message: 'Magic link not found for this salon' });
    }

    if (magicLink.expiresAt < new Date() || magicLink.status === 'EXPIRED' || magicLink.status === 'REVOKED') {
      return res.status(410).json({ message: 'Magic link has expired' });
    }

    if (magicLink.status !== 'ACTIVE') {
      return res.status(410).json({ message: 'Magic link is not active' });
    }

    if (magicLink.usedAt) {
      return res.status(410).json({ message: 'Magic link has already been used' });
    }

    if (magicLink.type !== 'BOOKING' && magicLink.type !== 'RESCHEDULE') {
      return res.status(400).json({ message: 'Invalid magic link type' });
    }

    const fallbackPhoneFromLink = magicLink.subjectType === 'PHONE'
      ? magicLink.phone.trim()
      : `IG_${magicLink.subjectNormalized}`;

    let customer = magicLink.usedByCustomerId
      ? await prisma.customer.findFirst({
          where: {
            id: magicLink.usedByCustomerId,
            salonId,
          },
        })
      : null;

    if (!customer) {
      const binding = await prisma.identityBinding.findUnique({
        where: {
          salonId_channel_subjectNormalized: {
            salonId,
            channel: magicLink.channel,
            subjectNormalized: magicLink.subjectNormalized,
          },
        },
        select: { customerId: true },
      });

      if (binding?.customerId) {
        customer = await prisma.customer.findFirst({
          where: {
            id: binding.customerId,
            salonId,
          },
        });
      }
    }

    if (!customer && magicLink.subjectType === 'PHONE') {
      customer = await prisma.customer.findFirst({
        where: {
          phone: fallbackPhoneFromLink,
          salonId,
        },
      });
    }

    const primaryName = resolveCustomerNameParts({
      firstName: people?.[0]?.firstName,
      lastName: people?.[0]?.lastName,
      fullName: people?.[0]?.name,
    });
    if (!primaryName.firstName || !primaryName.lastName) {
      return res.status(400).json({ message: 'Ad ve soyad zorunludur.' });
    }

    if (!customer) {
      const customerName = primaryName.fullName || `Customer ${fallbackPhoneFromLink}`;
      const fallbackInstagram = magicLink.subjectType === 'INSTAGRAM_ID'
        ? normalizeInstagramIdentity(magicLink.phone) || null
        : null;
      customer = await prisma.customer.create({
        data: {
          phone: fallbackPhoneFromLink,
          name: customerName,
          firstName: primaryName.firstName,
          lastName: primaryName.lastName,
          salonId,
          registrationStatus: 'PENDING',
          instagram: fallbackInstagram,
        },
      });
    } else if (
      customer.name !== primaryName.fullName ||
      (customer.firstName || '') !== primaryName.firstName ||
      (customer.lastName || '') !== primaryName.lastName
    ) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          name: primaryName.fullName,
          firstName: primaryName.firstName,
          lastName: primaryName.lastName,
        },
      });
    }

    const customerPhoneForAppointment = customer.phone || fallbackPhoneFromLink;

    await assertBookingAllowed({
      salonId,
      customerId: customer.id,
      phone: customerPhoneForAppointment,
      channel: magicLink.channel as any,
      subjectNormalized: magicLink.subjectNormalized,
    });

    const appointmentDateTime = new Date(datetime);
    if (isNaN(appointmentDateTime.getTime())) {
      return res.status(400).json({ message: 'Invalid datetime format' });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (magicLink.type === 'RESCHEDULE' && magicLink.context) {
        const oldAppointmentId = (magicLink.context as any).appointmentId;
        await tx.appointment.update({
          where: { id: oldAppointmentId, salonId },
          data: {
            status: 'CANCELLED',
            updatedAt: new Date()
          }
        });
      }

      const appointments = [];

      for (const person of people) {
        const personName = resolveCustomerNameParts({
          firstName: person?.firstName,
          lastName: person?.lastName,
          fullName: person?.name,
        });
        if (!personName.firstName || !personName.lastName || !person.birthDate || !person.gender || !Array.isArray(person.services)) {
          throw new Error('Invalid person data');
        }

        if (!['kadin', 'erkek', 'belirtmek-istemiyorum'].includes(person.gender)) {
          throw new Error('Invalid gender value');
        }

        const personServices: ServiceWithCategory[] = [];

        for (const serviceItem of person.services) {
          if (!serviceItem.serviceId || !serviceItem.staffId) {
            throw new Error('Invalid service data');
          }

          const staffService = await tx.staffService.findFirst({
            where: {
              serviceId: serviceItem.serviceId,
              staffId: serviceItem.staffId,
              Staff: { salonId },
              OR: [{ isactive: true }, { isactive: null }]
            }
          });

          const service = await tx.service.findFirst({
            where: { id: serviceItem.serviceId, salonId }
          });
          if (!service) {
            throw new Error('Service not found');
          }

          const staff = await tx.staff.findFirst({
            where: {
              id: serviceItem.staffId,
              salonId: salonId
            }
          });
          if (!staff) {
            throw new Error('Staff not found');
          }

          const duration = staffService?.duration ?? service.duration;
          const price = staffService?.price ?? service.price;

          personServices.push({
            id: service.id,
            name: service.name,
            duration,
            price,
            isSynergyEnabled: false,
            category: undefined
          });
        }

        const totalDuration = calculateSmartDuration(personServices);

        for (const serviceItem of person.services) {
          const endTime = new Date(appointmentDateTime.getTime() + totalDuration * 60 * 1000);

          const appointment = await tx.appointment.create({
            data: {
              salonId: salonId,
              staffId: serviceItem.staffId,
              serviceId: serviceItem.serviceId,
              customerId: customer.id,
              customerName: personName.fullName,
              customerPhone: customerPhoneForAppointment,
              startTime: appointmentDateTime,
              endTime: endTime,
              status: 'BOOKED',
              source: magicLink.type === 'RESCHEDULE' ? 'ADMIN' : 'CUSTOMER',
              notes: `Birth date: ${person.birthDate}, Gender: ${person.gender}, Campaign opt-in: ${campaignOptIn || false}${magicLink.type === 'RESCHEDULE' ? ', Rescheduled' : ''}`
            }
          });

          appointments.push(appointment);
        }
      }

      return appointments;
    });

    if (magicLink.usedAt === null) {
      try {
        await prisma.magicLink.updateMany({
          where: { token, salonId, usedAt: null, status: 'ACTIVE' },
          data: {
            usedAt: new Date(),
            status: 'USED',
            usedByCustomerId: customer.id,
          },
        });
      } catch (_) {}
    }

    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { name: true }
    });

    console.log('📱 WhatsApp Event:', {
      event: 'appointment.created',
      appointmentId: result[0].id,
      salon: {
        name: salon?.name || 'Unknown Salon',
        location: 'Salon Address'
      },
      customer: {
        phone: customerPhoneForAppointment,
        name: customer.name
      },
      datetime: appointmentDateTime.toLocaleString('tr-TR')
    });

    const serviceIds = Array.from(new Set(result.map((apt) => Number(apt.serviceId)).filter((id) => Number.isInteger(id) && id > 0)));
    const createdServices = serviceIds.length
      ? await prisma.service.findMany({
          where: { salonId, id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : [];
    const serviceNameById = new Map<number, string>();
    for (const service of createdServices) {
      serviceNameById.set(Number(service.id), service.name);
    }
    const eventType: SameDayEvent = magicLink.type === 'RESCHEDULE' ? 'UPDATED' : 'CREATED';
    await Promise.all(
      result.map((apt) =>
        emitSameDayChangeBestEffort({
          salonId,
          event: eventType,
          appointmentId: Number(apt.id),
          customerName: apt.customerName || customer.name || 'Müşteri',
          serviceName: serviceNameById.get(Number(apt.serviceId)) || null,
          startTime: apt.startTime,
        }),
      ),
    );

    res.status(201).json({
      appointmentId: result[0].id,
      status: 'CONFIRMED'
    });

  } catch (error: any) {
    if (error?.code === 'CUSTOMER_BANNED' || error?.message === 'CUSTOMER_BANNED') {
      return sendCustomerBannedResponse(res, error?.ban?.reason || null);
    }
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
