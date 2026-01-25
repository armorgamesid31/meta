import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// GET /api/salon/me - Get salon info and settings
router.get('/me', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: req.user.salonId },
      include: {
        settings: true
      }
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    res.json({
      salon: {
        id: salon.id,
        name: salon.name,
        workStartHour: salon.settings?.workStartHour || 9,
        workEndHour: salon.settings?.workEndHour || 18,
        slotInterval: salon.settings?.slotInterval || 30
      }
    });
  } catch (error) {
    console.error('Error fetching salon:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/salon/settings - Update salon settings
router.put('/settings', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { workStartHour, workEndHour, slotInterval } = req.body;

  try {
    // Update or create salon settings
    const settings = await prisma.salonSettings.upsert({
      where: { salonId: req.user.salonId },
      update: {
        workStartHour,
        workEndHour,
        slotInterval
      },
      create: {
        salonId: req.user.salonId,
        workStartHour,
        workEndHour,
        slotInterval
      }
    });

    res.json({ settings });
  } catch (error) {
    console.error('Error updating salon settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/services - Get salon services
router.get('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const services = await prisma.service.findMany({
      where: { salonId: req.user.salonId },
      include: {
        staff: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // For now, assume all services are enabled
    const servicesWithStatus = services.map(service => ({
      id: service.id,
      name: service.name,
      price: service.price,
      duration: service.duration,
      enabled: true, // TODO: Add enabled field to Service model
      staff: service.staff
    }));

    res.json({ services: servicesWithStatus });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/salon/services - Update service status
router.put('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { serviceId, enabled } = req.body;

  try {
    // For now, just return success since we don't have an enabled field
    // TODO: Add enabled field to Service model
    res.json({ message: 'Service updated successfully' });
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/staff - Get salon staff
router.get('/staff', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const staff = await prisma.staff.findMany({
      where: { salonId: req.user.salonId },
      orderBy: { name: 'asc' }
    });

    // For now, assume all staff are enabled
    const staffWithStatus = staff.map(person => ({
      id: person.id,
      name: person.name,
      enabled: true // TODO: Add enabled field to Staff model
    }));

    res.json({ staff: staffWithStatus });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/salon/staff - Update staff status
router.put('/staff', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { staffId, enabled } = req.body;

  try {
    // For now, just return success since we don't have an enabled field
    // TODO: Add enabled field to Staff model
    res.json({ message: 'Staff updated successfully' });
  } catch (error) {
    console.error('Error updating staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/appointments - Get salon appointments
router.get('/appointments', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { date, limit = '50', offset = '0' } = req.query;

  // Default to today if no date provided
  const targetDate = date ? new Date(date as string) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        salonId: req.user.salonId,
        startTime: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      include: {
        service: true,
        staff: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        startTime: 'asc'
      },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    res.json({
      appointments: appointments.map(apt => ({
        id: apt.id,
        datetime: apt.startTime,
        status: apt.status === 'BOOKED' ? 'CONFIRMED' : apt.status,
        customer: {
          name: apt.customerName,
          phone: apt.customerPhone
        },
        services: [{
          name: apt.service.name
        }]
      }))
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/salon/appointments/:id/cancel - Cancel appointment
router.post('/appointments/:id/cancel', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  try {
    // Check if appointment exists and belongs to salon
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId,
        status: 'BOOKED'
      }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found or cannot be cancelled' });
    }

    // Check if appointment is in the future
    if (appointment.startTime <= new Date()) {
      return res.status(400).json({ message: 'Cannot cancel past appointments' });
    }

    // Update appointment status
    await prisma.appointment.update({
      where: { id: parseInt(id) },
      data: {
        status: 'CANCELLED',
        updatedAt: new Date()
      }
    });

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/salon/appointments/:id/reschedule-link - Generate reschedule magic link
router.post('/appointments/:id/reschedule-link', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  try {
    // Check if appointment exists and belongs to salon
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId,
        status: 'BOOKED'
      }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Check if appointment is in the future
    if (appointment.startTime <= new Date()) {
      return res.status(400).json({ message: 'Cannot reschedule past appointments' });
    }

    // Generate reschedule magic link
    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 6); // 6 hours for reschedule

    const magicLink = await prisma.magicLink.create({
      data: {
        token,
        phone: appointment.customerPhone,
        type: 'RESCHEDULE',
        context: {
          appointmentId: appointment.id,
          salonId: req.user.salonId
        },
        expiresAt
      }
    });

    // Generate magic link URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const magicUrl = `${baseUrl}/m/${token}`;

    res.json({
      magicUrl,
      token,
      expiresAt: magicLink.expiresAt
    });
  } catch (error) {
    console.error('Error generating reschedule link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/salon/magic-link/booking - Create booking magic link
router.post('/magic-link/booking', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ message: 'Phone number is required' });
  }

  try {
    // Generate booking magic link
    const { randomBytes } = await import('crypto');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours for booking

    const magicLink = await prisma.magicLink.create({
      data: {
        token,
        phone,
        type: 'BOOKING',
        context: {
          salonId: req.user.salonId
        },
        expiresAt
      }
    });

    // Generate magic link URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const magicUrl = `${baseUrl}/m/${token}`;

    res.status(201).json({
      magicUrl,
      token,
      expiresAt: magicLink.expiresAt
    });
  } catch (error) {
    console.error('Error creating booking magic link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;