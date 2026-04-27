import { Router } from 'express';
import { prisma } from '../prisma.js';
import { v4 as uuidv4 } from 'uuid';
import { buildSingleServiceGroups, generateAvailability } from '../services/availabilityService.js';
import { assertBookingAllowed } from '../services/blacklist.js';

const router = Router();

function sendCustomerBannedResponse(res: any, detail?: string | null) {
  return res.status(403).json({
    code: 'CUSTOMER_BANNED',
    message: detail && detail.trim() ? `Müşteri yasaklı: ${detail.trim()}` : 'Müşteri yasaklı olduğu için işlem yapılamaz.',
  });
}

interface CreateMagicLinkRequest {
  salonId: number;
}

interface LockSlotRequest {
  slot: {
    date: string;
    startTime: string;
    serviceId: number;
    staffIds: number[];
    peopleCount: number;
  };
}

interface ConfirmBookingRequest {
  customerInfo: {
    firstName?: string;
    lastName?: string;
    name?: string;
    phone: string;
    email?: string;
  };
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
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function resolveCustomerNameParts(input: { firstName?: unknown; lastName?: unknown; name?: unknown }) {
  const firstNameRaw = normalizeNamePart(input.firstName);
  const lastNameRaw = normalizeNamePart(input.lastName);
  const fallbackName = normalizeNamePart(input.name);
  const fallbackParts = !firstNameRaw && !lastNameRaw ? splitFullName(fallbackName) : { firstName: '', lastName: '' };
  const firstName = firstNameRaw || fallbackParts.firstName;
  const lastName = lastNameRaw || fallbackParts.lastName;
  const fullName = `${firstName} ${lastName}`.trim() || fallbackName;
  return { firstName, lastName, fullName };
}

// POST /api/magic-link - Create a new booking session
router.post("/magic-link", async (req: any, res: any) => {
  const { salonId } = req.body as any;

  if (!salonId || typeof salonId !== 'number') {
    return res.status(400).json({ message: 'Valid salonId is required.' });
  }

  // Verify salon exists
  const salon = await prisma.salon.findUnique({
    where: { id: salonId }
  });

  if (!salon) {
    return res.status(404).json({ message: 'Salon not found.' });
  }

  // Create booking session
  const token = uuidv4();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 6); // 6 hour expiry

  const session = await prisma.bookingSession.create({
    data: {
      token,
      salonId,
      expiresAt
    }
  });

  // Return booking URL
  const bookingUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/book/${token}`;

  res.status(201).json({
    bookingUrl,
    sessionToken: token,
    expiresAt: session.expiresAt
  });
});

// GET /api/sessions/:token - Get session state
router.get("/:token", async (req: any, res: any) => {
  const { token } = req.params as any;
  const tokenStr = Array.isArray(token) ? token[0] : token;

  const session = await prisma.bookingSession.findUnique({
    where: { token: tokenStr }
  });

  if (!session) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  if (session.expiresAt < new Date()) {
    return res.status(410).json({ message: 'Session has expired.' });
  }

  // After CONFIRMED, session is immutable - return 410 for all access
  if (session.state === 'CONFIRMED') {
    return res.status(410).json({ message: 'Session has been completed.' });
  }

  // Get salon info
  const salon = await prisma.salon.findUnique({
    where: { id: session.salonId },
    include: {
      settings: true,
      services: {
        include: {
          staff: {
            select: {
              id: true,
              name: true
            }
          }
        }
      },
      staff: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  if (!salon) {
    return res.status(404).json({ message: 'Salon not found.' });
  }

  res.json({
    session: {
      token: session.token,
      state: session.state,
      expiresAt: session.expiresAt,
      selectedSlot: session.selectedSlot,
      customerInfo: session.customerInfo
    },
    salon: {
      id: salon.id,
      name: salon.name,
      logoUrl: salon.logoUrl,
      bookingTheme: salon.bookingTheme,
      settings: salon.settings,
      services: salon.services,
      staff: salon.staff
    }
  });
});

// GET /api/sessions/:token/availability - Get availability for session
router.get("/:token/availability", async (req: any, res: any) => {
  const { token } = req.params as any;
  const tokenStr = Array.isArray(token) ? token[0] : token;
  const { date } = req.query as any;
  const serviceId = Number(req.query?.serviceId);
  const peopleCount = Number(req.query?.peopleCount || 1);

  if (!date || typeof date !== 'string' || !Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'date and serviceId parameters are required.' });
  }

  const session = await prisma.bookingSession.findUnique({
    where: { token: tokenStr }
  });

  if (!session) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  if (session.expiresAt < new Date()) {
    return res.status(410).json({ message: 'Session has expired.' });
  }

  // After CONFIRMED, session is immutable - return 410 for all access
  if (session.state === 'CONFIRMED') {
    return res.status(410).json({ message: 'Session has been completed.' });
  }

  const availabilityResult = await generateAvailability({
    salonId: session.salonId,
    date,
    groups: buildSingleServiceGroups(serviceId, Number.isInteger(peopleCount) && peopleCount > 0 ? peopleCount : 1),
  });

  res.json({
    slots: availabilityResult.displaySlots.map((slot) => slot.label),
    lockToken: availabilityResult.lockToken
  });
});

// POST /api/sessions/:token/lock - Lock a slot for the session
router.post("/:token/lock", async (req: any, res: any) => {
  const { token } = req.params as any;
  const tokenStr = Array.isArray(token) ? token[0] : token;
  const { slot } = req.body as any;

  if (!slot || !slot.date || !slot.startTime || !slot.serviceId || !Array.isArray(slot.staffIds)) {
    return res.status(400).json({ message: 'Valid slot data is required.' });
  }

  const session = await prisma.bookingSession.findUnique({
    where: { token: tokenStr }
  });

  if (!session) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  if (session.expiresAt < new Date()) {
    return res.status(410).json({ message: 'Session has expired.' });
  }

  // After CONFIRMED, session is immutable - return 410 for all access
  if (session.state === 'CONFIRMED') {
    return res.status(410).json({ message: 'Session has been completed.' });
  }

  // Enforce strict state transitions: CREATED → SLOT_SELECTED → CONFIRMED
  if (session.state !== 'CREATED' && session.state !== 'SLOT_SELECTED') {
    return res.status(409).json({ message: 'Invalid session state transition.' });
  }

  // If changing slot while in SLOT_SELECTED, release old lock
  if (session.state === 'SLOT_SELECTED' && session.selectedSlot) {
    const oldSlot = session.selectedSlot as any;
    if (oldSlot.lockToken) {
      // Release old lock (don't fail if it doesn't exist)
      await prisma.$executeRaw`
        DELETE FROM temporary_locks WHERE id = ${oldSlot.lockToken}
      `.catch(() => {}); // Ignore errors
    }
  }

  // Update session with selected slot (allow replacement in SLOT_SELECTED)
  const updatedSession = await prisma.bookingSession.update({
    where: { token: tokenStr },
    data: {
      state: 'SLOT_SELECTED',
      selectedSlot: slot
    }
  });

  res.json({
    message: 'Slot locked successfully.',
    session: {
      token: updatedSession.token,
      state: updatedSession.state,
      selectedSlot: updatedSession.selectedSlot
    }
  });
});

// POST /api/sessions/:token/confirm - Confirm booking for session
router.post("/:token/confirm", async (req: any, res: any) => {
  const { token } = req.params as any;
  const tokenStr = Array.isArray(token) ? token[0] : token;
  const { customerInfo } = req.body as any;
  const normalizedName = resolveCustomerNameParts({
    firstName: customerInfo?.firstName,
    lastName: customerInfo?.lastName,
    name: customerInfo?.name,
  });

  if (!customerInfo || !normalizedName.firstName || !normalizedName.lastName || !customerInfo.phone) {
    return res.status(400).json({ message: 'Customer information is required.' });
  }

  const session = await prisma.bookingSession.findUnique({
    where: { token: tokenStr }
  });

  if (!session) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  if (session.expiresAt < new Date()) {
    return res.status(410).json({ message: 'Session has expired.' });
  }

  if (session.state !== 'SLOT_SELECTED' || !session.selectedSlot) {
    return res.status(400).json({ message: 'No slot selected for this session.' });
  }

  const slot = session.selectedSlot as any;

  try {
    // Start transaction
    await prisma.$transaction(async (tx) => {
      // 1. Validate lock token exists and is not expired
      const lockRecord = await tx.$queryRaw`
        SELECT * FROM temporary_locks
        WHERE id = ${slot.lockToken}
        AND salon_id = ${session.salonId}
        AND expires_at > NOW()
        FOR UPDATE
      ` as any[];

      if (lockRecord.length === 0) {
        return res.status(409).json({ message: 'Lock token has expired or is invalid.' });
      }

      // 2. Handle customer persistence
      let customer = await tx.customer.findFirst({
        where: {
          salonId: session.salonId,
          phone: customerInfo.phone
        }
      });

      if (!customer) {
        // Create new customer record
        customer = await tx.customer.create({
          data: {
            salonId: session.salonId,
            name: normalizedName.fullName,
            firstName: normalizedName.firstName || null,
            lastName: normalizedName.lastName || null,
            phone: customerInfo.phone,
            email: customerInfo.email,
            registrationStatus: 'PENDING'
          }
        });
      } else {
        // Update existing customer info if provided
        if (
          normalizedName.fullName !== customer.name ||
          normalizedName.firstName !== (customer.firstName || '') ||
          normalizedName.lastName !== (customer.lastName || '') ||
          customerInfo.email !== customer.email
        ) {
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: {
              name: normalizedName.fullName,
              firstName: normalizedName.firstName || null,
              lastName: normalizedName.lastName || null,
              email: customerInfo.email
            }
          });
        }
      }

      const lock = lockRecord[0];
      const lockDuration = parseInt(lock.sure, 10) || 60;
      const slotStart = new Date(`${slot.date}T${slot.startTime}`);
      const slotEnd = new Date(slotStart.getTime() + lockDuration * 60 * 1000);

      await assertBookingAllowed({
        salonId: session.salonId,
        customerId: customer.id,
        phone: customer.phone,
        channel: 'WHATSAPP',
      });

      const appointments = [];
      for (const staffId of slot.staffIds) {
        const appointment = await tx.appointment.create({
          data: {
            salonId: session.salonId,
            staffId,
            serviceId: slot.serviceId,
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            startTime: slotStart,
            endTime: slotEnd,
            status: 'BOOKED',
            source: 'CUSTOMER'
          }
        });
        appointments.push(appointment);
      }

      // 4. Delete lock token
      await tx.$executeRaw`
        DELETE FROM temporary_locks WHERE id = ${slot.lockToken}
      `;

      // 5. Update session state
      await tx.bookingSession.update({
        where: { token: tokenStr },
        data: {
          state: 'CONFIRMED',
          customerInfo
        }
      });

      res.status(201).json({
        message: 'Booking confirmed successfully.',
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          isReturning: customer.createdAt < new Date(Date.now() - 1000) // Created more than 1 second ago
        },
        appointments: appointments.map(apt => ({
          id: apt.id,
          startTime: apt.startTime,
          endTime: apt.endTime,
          staffId: apt.staffId,
          serviceId: apt.serviceId
        }))
      });
    });
  } catch (error: any) {
    if (error?.code === 'CUSTOMER_BANNED' || error?.message === 'CUSTOMER_BANNED') {
      return sendCustomerBannedResponse(res, error?.ban?.reason || null);
    }
    console.error('Error confirming session booking:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
