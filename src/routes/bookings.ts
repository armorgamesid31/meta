import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { AvailabilityEngine } from '../modules/availability/engine.js';
import { SlotsEngine } from '../modules/availability/slots-engine.js';
import { DateNormalizer } from '../modules/availability/normalizer.js';
import { calculateSmartDuration, ServiceWithCategory } from '../utils/durationCalculator.js';

const router = Router();

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
    await prisma.$transaction(async (tx) => {
      const bookingRecord = await tx.$queryRaw`
        SELECT * FROM randevular
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
        FOR UPDATE
      ` as any[];

      if (bookingRecord.length === 0) {
        return res.status(404).json({ message: 'Booking not found.' });
      }

      const booking = bookingRecord[0];

      if (booking.hizmet_durumu === 'iptal') {
        return res.status(200).json({
          message: 'Booking is already cancelled.',
          bookingId
        });
      }

      const bookingDate = DateNormalizer.parseDate(booking.tarih);
      const bookingTimeMinutes = DateNormalizer.parseTimeToMinutes(booking.saat);
      const bookingStartTime = DateNormalizer.createDateTime(booking.tarih, bookingTimeMinutes);

      if (bookingStartTime <= new Date()) {
        return res.status(400).json({ message: 'Cannot cancel past bookings.' });
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
        where: { id: bookingId }
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

      res.status(200).json({
        message: 'Booking cancelled successfully.',
        bookingId
      });
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
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
    await prisma.$transaction(async (tx) => {
      const bookingRecord = await tx.$queryRaw`
        SELECT * FROM randevular
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
        FOR UPDATE
      ` as any[];

      if (bookingRecord.length === 0) {
        return res.status(404).json({ message: 'Booking not found.' });
      }

      const booking = bookingRecord[0];

      if (booking.hizmet_durumu === 'iptal') {
        return res.status(400).json({ message: 'Cannot reschedule a cancelled booking.' });
      }

      if (booking.hizmet_durumu === 'rescheduling') {
        return res.status(409).json({ message: 'Booking is currently being rescheduled.' });
      }

      const bookingDate = DateNormalizer.parseDate(booking.tarih);
      const bookingTimeMinutes = DateNormalizer.parseTimeToMinutes(booking.saat);
      const bookingStartTime = DateNormalizer.createDateTime(booking.tarih, bookingTimeMinutes);

      if (bookingStartTime <= new Date()) {
        return res.status(400).json({ message: 'Cannot reschedule past bookings.' });
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
        return res.status(409).json({ message: 'New slot is not available.' });
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
        return res.status(404).json({ message: 'Service not found.' });
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
        return res.status(400).json({ message: 'Invalid staff selection for new slot.' });
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
        where: { id: bookingId }
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

      res.status(200).json({
        message: 'Booking rescheduled successfully.',
        oldBookingId: bookingId,
        newAppointments: newAppointments.map(apt => ({
          id: apt.id,
          startTime: apt.startTime,
          endTime: apt.endTime,
          staffId: apt.staffId,
          serviceId: apt.serviceId
        }))
      });
    });

  } catch (error) {
    console.error('Error rescheduling booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/bookings - Create appointment (frontend booking flow)
router.post('/', async (req: any, res: any, next: any) => {
  const b = req.body || {};
  const salonId = req.salon?.id;

  if (
    salonId &&
    typeof b.customerId === 'number' &&
    typeof b.customerName === 'string' &&
    typeof b.customerPhone === 'string' &&
    typeof b.staffId === 'number' &&
    typeof b.serviceId === 'number' &&
    typeof b.startTime === 'string' &&
    typeof b.endTime === 'string' &&
    (b.source === 'CUSTOMER' || b.source === 'SALON')
  ) {
    const {
      customerId,
      customerName,
      customerPhone,
      staffId,
      serviceId,
      startTime,
      endTime,
      source,
      token
    } = b;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid startTime or endTime' });
    }

    try {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const engine = new AvailabilityEngine();
      const availabilityResult = await engine.calculateAvailability({
        date,
        serviceId,
        peopleCount: 1,
        salonId
      });

      const startMs = Math.floor(start.getTime() / 60000) * 60000;
      const slotAvailable = availabilityResult.slots.some(
        (slot) =>
          Math.floor(slot.startTime.getTime() / 60000) * 60000 === startMs &&
          slot.availableStaff.includes(staffId)
      );

      if (!slotAvailable) {
        return res.status(409).json({ error: 'SLOT_NOT_AVAILABLE' });
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
          source: source === 'SALON' ? 'ADMIN' : 'CUSTOMER'
        }
      });

      if (token && typeof token === 'string') {
        try {
          await prisma.magicLink.updateMany({
            where: { 
                token, 
                usedAt: null,
                context: { path: ['salonId'], equals: salonId }
            },
            data: { usedAt: new Date() }
          });
        } catch (_) {}
      }

      return res.status(201).json({
        appointmentId: appointment.id,
        status: 'BOOKED'
      });
    } catch (error) {
      return res.status(500).json({ message: 'Internal server error' });
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
          context: { path: ['salonId'], equals: salonId }
      }
    });

    if (!magicLink) {
      return res.status(404).json({ message: 'Magic link not found for this salon' });
    }

    if (magicLink.expiresAt < new Date()) {
      return res.status(410).json({ message: 'Magic link has expired' });
    }

    if (magicLink.usedAt) {
      return res.status(410).json({ message: 'Magic link has already been used' });
    }

    if (magicLink.type !== 'BOOKING' && magicLink.type !== 'RESCHEDULE') {
      return res.status(400).json({ message: 'Invalid magic link type' });
    }

    const phone = magicLink.phone.trim();
    let customer = await prisma.customer.findFirst({
      where: {
        phone,
        salonId: salonId
      }
    });

    if (!customer) {
      const customerName = people[0].name || `Customer ${phone}`;
      customer = await prisma.customer.create({
        data: {
          phone,
          name: customerName,
          salonId: salonId
        }
      });
    }

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
              customerPhone: phone,
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
          where: { token, usedAt: null },
          data: { usedAt: new Date() }
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
        phone,
        name: customer.name
      },
      datetime: appointmentDateTime.toLocaleString('tr-TR')
    });

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
