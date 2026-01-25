import { Router } from 'express';
import { prisma } from '../prisma';
import { authenticateToken } from '../middleware/auth';
import { Request, Response } from 'express';
import { AvailabilityEngine } from '../modules/availability/engine';
import { DateNormalizer } from '../modules/availability/normalizer';

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
router.post("/confirm", authenticateToken, async (req: AuthRequest, res) => {
  const { lockToken, customerName, customerPhone, serviceId, staffIds }: ConfirmBookingRequest = req.body;

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  if (!lockToken || !customerName || !customerPhone || !serviceId || !Array.isArray(staffIds) || staffIds.length === 0) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  const salonId = req.user.salonId;

  try {
    // Start a database transaction
    await prisma.$transaction(async (tx) => {
      // 1. Validate lock token exists and is not expired
      const lockRecord = await tx.$queryRaw`
        SELECT * FROM temporary_locks
        WHERE id = ${lockToken}
        AND salon_id = ${salonId}
        AND expires_at > NOW()
        FOR UPDATE
      ` as any[];

      if (lockRecord.length === 0) {
        // Check if lock exists but is expired
        const expiredLock = await tx.$queryRaw`
          SELECT * FROM temporary_locks
          WHERE id = ${lockToken}
          AND salon_id = ${salonId}
        ` as any[];

        if (expiredLock.length > 0) {
          return res.status(410).json({ message: 'Lock token has expired.' });
        } else {
          return res.status(404).json({ message: 'Lock token not found.' });
        }
      }

      const lock = lockRecord[0];

      // 2. Parse lock data
      const lockDate = DateNormalizer.parseDate(lock.tarih);
      const lockStartMinutes = DateNormalizer.parseTimeToMinutes(lock.saat);
      const lockDuration = DateNormalizer.parseDuration(lock.sure);

      const slotStart = DateNormalizer.createDateTime(lock.tarih, lockStartMinutes);
      const slotEnd = new Date(slotStart.getTime() + lockDuration * 60 * 1000);

      // 3. Re-run availability engine to ensure slot is still valid
      const engine = new AvailabilityEngine();
      const availabilityResult = await engine.calculateAvailability({
        date: lockDate,
        serviceId,
        peopleCount: staffIds.length,
        salonId
      });

      // Check if our locked slot is still available
      const slotStillAvailable = availabilityResult.slots.some(slot =>
        slot.startTime.getTime() === slotStart.getTime() &&
        slot.availableStaff.length >= staffIds.length &&
        staffIds.every(staffId => slot.availableStaff.includes(staffId))
      );

      if (!slotStillAvailable) {
        return res.status(409).json({ message: 'Slot is no longer available.' });
      }

      // 4. Get service details
      const service = await tx.service.findUnique({
        where: { id: serviceId, salonId }
      });

      if (!service) {
        return res.status(404).json({ message: 'Service not found.' });
      }

      // 5. Validate staff are available for this salon
      const validStaff = await tx.staff.findMany({
        where: {
          id: { in: staffIds },
          salonId
        }
      });

      if (validStaff.length !== staffIds.length) {
        return res.status(400).json({ message: 'Invalid staff selection.' });
      }

      // 6. Create appointments for each staff member
      const appointments = [];
      for (const staffId of staffIds) {
        const appointment = await tx.appointment.create({
          data: {
            salonId,
            staffId,
            serviceId,
            customerName,
            customerPhone,
            startTime: slotStart,
            endTime: slotEnd,
            status: 'BOOKED',
            source: 'CUSTOMER'
          }
        });
        appointments.push(appointment);
      }

      // 7. Delete the lock token
      await tx.$executeRaw`
        DELETE FROM temporary_locks
        WHERE id = ${lockToken}
        AND salon_id = ${salonId}
      `;

      // Return success response
      res.status(201).json({
        message: 'Booking confirmed successfully.',
        appointments: appointments.map(apt => ({
          id: apt.id,
          startTime: apt.startTime,
          endTime: apt.endTime,
          staffId: apt.staffId,
          serviceId: apt.serviceId
        }))
      });
    });

  } catch (error) {
    console.error('Error confirming booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/bookings/cancel - Cancel an existing booking
router.post("/cancel", authenticateToken, async (req: AuthRequest, res) => {
  const { bookingId }: CancelBookingRequest = req.body;

  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  if (!bookingId || typeof bookingId !== 'number') {
    return res.status(400).json({ message: 'Valid bookingId is required.' });
  }

  const salonId = req.user.salonId;

  try {
    // Start a database transaction
    await prisma.$transaction(async (tx) => {
      // 1. Check if booking exists and belongs to this salon
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

      // 2. Check if booking is already cancelled (idempotency)
      if (booking.hizmet_durumu === 'iptal') {
        return res.status(200).json({
          message: 'Booking is already cancelled.',
          bookingId
        });
      }

      // 3. Parse booking time and check if it's in the future
      const bookingDate = DateNormalizer.parseDate(booking.tarih);
      const bookingTimeMinutes = DateNormalizer.parseTimeToMinutes(booking.saat);
      const bookingStartTime = DateNormalizer.createDateTime(booking.tarih, bookingTimeMinutes);

      if (bookingStartTime <= new Date()) {
        return res.status(400).json({ message: 'Cannot cancel past bookings.' });
      }

      // 4. Update booking status in legacy table
      await tx.$executeRaw`
        UPDATE randevular
        SET hizmet_durumu = 'iptal',
            erteleme_iptal_zamani = NOW(),
            updated_at = NOW()
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
      `;

      // 5. Update Prisma appointment record as well (for consistency)
      const appointment = await tx.appointment.findUnique({
        where: { id: bookingId }
      });

      if (appointment) {
        await tx.appointment.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            updatedAt: new Date()
          }
        });
      }

      // 6. Release any related temporary locks (if they exist)
      // Find locks that might be related to this booking's time slot
      await tx.$executeRaw`
        DELETE FROM temporary_locks
        WHERE salon_id = ${salonId}
        AND tarih = ${booking.tarih}
        AND saat = ${booking.saat}
        AND sure = ${booking.sure}
      `;

      // Return success response
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
router.post("/reschedule", authenticateToken, async (req: AuthRequest, res) => {
  const { bookingId, newSlot }: RescheduleBookingRequest = req.body;

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
    // Start a database transaction
    await prisma.$transaction(async (tx) => {
      // 1. Lock existing booking row (FOR UPDATE)
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

      // 2. Check if booking is already cancelled
      if (booking.hizmet_durumu === 'iptal') {
        return res.status(400).json({ message: 'Cannot reschedule a cancelled booking.' });
      }

      // 3. Check if booking is already being rescheduled (idempotency)
      if (booking.hizmet_durumu === 'rescheduling') {
        return res.status(409).json({ message: 'Booking is currently being rescheduled.' });
      }

      // 4. Parse booking time and check if it's in the future
      const bookingDate = DateNormalizer.parseDate(booking.tarih);
      const bookingTimeMinutes = DateNormalizer.parseTimeToMinutes(booking.saat);
      const bookingStartTime = DateNormalizer.createDateTime(booking.tarih, bookingTimeMinutes);

      if (bookingStartTime <= new Date()) {
        return res.status(400).json({ message: 'Cannot reschedule past bookings.' });
      }

      // 5. Temporarily mark old booking as "rescheduling"
      await tx.$executeRaw`
        UPDATE randevular
        SET hizmet_durumu = 'rescheduling',
            updated_at = NOW()
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
      `;

      // 6. Run availability engine for new slot
      const engine = new AvailabilityEngine();
      const availabilityResult = await engine.calculateAvailability({
        date: new Date(newSlot.date),
        serviceId: newSlot.serviceId,
        peopleCount: newSlot.peopleCount,
        salonId
      });

      // Parse new slot time
      const newSlotStartMinutes = DateNormalizer.parseTimeToMinutes(newSlot.startTime);
      const newSlotStart = DateNormalizer.createDateTime(newSlot.date, newSlotStartMinutes);

      // Check if new slot is available
      const slotAvailable = availabilityResult.slots.some(slot =>
        slot.startTime.getTime() === newSlotStart.getTime() &&
        slot.availableStaff.length >= newSlot.staffIds.length &&
        newSlot.staffIds.every(staffId => slot.availableStaff.includes(staffId))
      );

      if (!slotAvailable) {
        // Rollback: reset booking status
        await tx.$executeRaw`
          UPDATE randevular
          SET hizmet_durumu = 'aktif',
              updated_at = NOW()
          WHERE id = ${bookingId}
          AND salon_id = ${salonId}
        `;
        return res.status(409).json({ message: 'New slot is not available.' });
      }

      // 7. Create temporary lock for new slot
      const lockId = `reschedule-${bookingId}-${Date.now()}`;
      const service = await tx.service.findUnique({
        where: { id: newSlot.serviceId, salonId }
      });

      if (!service) {
        // Rollback: reset booking status
        await tx.$executeRaw`
          UPDATE randevular
          SET hizmet_durumu = 'aktif',
              updated_at = NOW()
          WHERE id = ${bookingId}
          AND salon_id = ${salonId}
        `;
        return res.status(404).json({ message: 'Service not found.' });
      }

      await tx.$executeRaw`
        INSERT INTO temporary_locks (id, salon_id, tarih, saat, sure, expires_at, created_at)
        VALUES (${lockId}, ${salonId}, ${newSlot.date}, ${newSlot.startTime}, ${service.duration}, ${new Date(Date.now() + 5 * 60 * 1000)}, NOW())
      `;

      // 8. Validate staff for new slot
      const validStaff = await tx.staff.findMany({
        where: {
          id: { in: newSlot.staffIds },
          salonId
        }
      });

      if (validStaff.length !== newSlot.staffIds.length) {
        // Rollback: reset booking status and delete lock
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

      // 9. Create new booking(s) for the rescheduled slot
      const newSlotEnd = new Date(newSlotStart.getTime() + service.duration * 60 * 1000);
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
            source: 'ADMIN' // Rescheduled bookings
          }
        });
        newAppointments.push(appointment);
      }

      // 10. Mark old booking as cancelled with erteleme_iptal_zamani
      await tx.$executeRaw`
        UPDATE randevular
        SET hizmet_durumu = 'iptal',
            erteleme_iptal_zamani = NOW(),
            updated_at = NOW()
        WHERE id = ${bookingId}
        AND salon_id = ${salonId}
      `;

      // 11. Update old Prisma appointment record
      const oldAppointment = await tx.appointment.findUnique({
        where: { id: bookingId }
      });

      if (oldAppointment) {
        await tx.appointment.update({
          where: { id: bookingId },
          data: {
            status: 'CANCELLED',
            updatedAt: new Date()
          }
        });
      }

      // 12. Remove temporary lock
      await tx.$executeRaw`
        DELETE FROM temporary_locks WHERE id = ${lockId}
      `;

      // Return success response
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

export default router;
