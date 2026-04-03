import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { AvailabilityEngine } from '../modules/availability/engine.js';
import { SlotsEngine } from '../modules/availability/slots-engine.js';
import { DateNormalizer } from '../modules/availability/normalizer.js';
import { calculateSmartDuration, ServiceWithCategory } from '../utils/durationCalculator.js';
import { normalizeInstagramIdentity } from '../services/identityService.js';
import { notifySameDayAppointmentChange } from '../services/notifications.js';
import {
  buildAppointmentReschedulePreview,
  commitAppointmentReschedule,
} from '../services/appointmentReschedule.js';

const router = Router();

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
      const availabilityResult = await engine.generateSlots(searchContext.data as any);

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

  } catch (error) {
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

    return res.status(200).json({
      batchId: committed.batchId,
      previousAppointmentIds: committed.previousAppointmentIds,
      items: committed.createdAppointments,
    });
  } catch (error: any) {
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
      select: { id: true, customerName: true, startTime: true, service: { select: { name: true } } },
    });

    if (modernAppointment) {
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
      };
    });

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

  } catch (error) {
    console.error('Error rescheduling booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
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
      packageSelections
    } = b;

    try {
      const createdAppointments = [];
      let currentStartTime = new Date(b.startTime);
      
      // Double check date validity
      if (isNaN(currentStartTime.getTime())) {
          return res.status(400).json({ message: 'Geçersiz randevu saati formatı (ISO beklenen).' });
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

      for (const [personIndex, personServices] of orderedPeople) {
        let personStartTime = new Date(b.startTime);
        for (const serviceItem of personServices) {
          const serviceId = parseInt(serviceItem.serviceId);
          let staffId = parseInt(serviceItem.staffId);
          const requestedPreferenceMode =
            String(serviceItem?.staffPreference?.mode || '').trim().toUpperCase() === 'SPECIFIC' ? 'SPECIFIC' : 'ANY';
          const requestedPreferredStaffId = Number(serviceItem?.staffPreference?.preferredStaffId);
          
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

          const duration = parseInt(serviceItem.duration) || 30;
          
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
              customerName: customerName.trim(),
              customerPhone: customerPhone.trim(),
              staffId,
              serviceId,
              startTime: start,
              endTime: end,
              status: 'BOOKED',
              source: source === 'SALON' ? 'ADMIN' : 'CUSTOMER',
              preferenceMode: effectiveSpecific ? 'SPECIFIC' : 'ANY',
              preferredStaffId: effectiveSpecific ? (effectivePreferredStaffId || staffId) : null,
              notes: noteParts.join('\n'),
            }
          });
          createdAppointments.push(appointment);
          
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
            customerName: apt.customerName || customerName.trim(),
            serviceName: serviceNameById.get(Number(apt.serviceId)) || null,
            startTime: apt.startTime,
          }),
        ),
      );

      return res.status(201).json({
        data: {
            appointments: createdAppointments.map(a => ({ id: a.id })),
            status: 'BOOKED'
        }
      });
    } catch (error: any) {
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

    if (!customer) {
      const customerName = people[0].name || `Customer ${fallbackPhoneFromLink}`;
      const fallbackInstagram = magicLink.subjectType === 'INSTAGRAM_ID'
        ? normalizeInstagramIdentity(magicLink.phone) || null
        : null;
      customer = await prisma.customer.create({
        data: {
          phone: fallbackPhoneFromLink,
          name: customerName,
          salonId,
          registrationStatus: 'PENDING',
          instagram: fallbackInstagram,
        },
      });
    }

    const customerPhoneForAppointment = customer.phone || fallbackPhoneFromLink;

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
        if (!person.name || !person.birthDate || !person.gender || !Array.isArray(person.services)) {
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
              customerName: person.name,
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

  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
