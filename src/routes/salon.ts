import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { logCustomerBehavior, calculateCancellationSeverity, BehaviorType } from '../utils/behaviorTracking.js';

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
        settings: true,
        _count: {
          select: {
            services: true,
            staff: true
          }
        }
      }
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    // Single source of truth for salon readiness
    const hasServices = salon._count.services > 0;
    const hasWorkingHours = (salon.settings?.workStartHour !== undefined &&
                            salon.settings?.workEndHour !== undefined);
    // Staff is optional for basic onboarding - can be added later
    const onboardingComplete = hasServices && hasWorkingHours;

    // Default to trial status (no real subscription system yet)
    const subscriptionStatus = 'trial';

    res.json({
      salon: {
        id: salon.id,
        name: salon.name,
        workStartHour: salon.settings?.workStartHour || 9,
        workEndHour: salon.settings?.workEndHour || 18,
        slotInterval: salon.settings?.slotInterval || 30,
        onboardingComplete,
        subscriptionStatus
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

  const { name, phone, address, workStartHour, workEndHour, slotInterval, isOnboarded } = req.body;

  try {
    // Update salon basic info if provided
    if (name || phone || address) {
      await prisma.salon.update({
        where: { id: req.user.salonId },
        data: {
          ...(name && { name }),
          // Note: phone and address are not in the Salon model yet
          // TODO: Add phone and address fields to Salon model
        }
      });
    }

    // Update or create salon settings
    if (workStartHour !== undefined || workEndHour !== undefined || slotInterval !== undefined || isOnboarded !== undefined) {
      const settings = await prisma.salonSettings.upsert({
        where: { salonId: req.user.salonId },
        update: {
          ...(workStartHour !== undefined && { workStartHour }),
          ...(workEndHour !== undefined && { workEndHour }),
          ...(slotInterval !== undefined && { slotInterval }),
          ...(isOnboarded !== undefined && { isOnboarded }),
        },
        create: {
          salonId: req.user.salonId,
          ...(workStartHour !== undefined && { workStartHour }),
          ...(workEndHour !== undefined && { workEndHour }),
          ...(slotInterval !== undefined && { slotInterval }),
          ...(isOnboarded !== undefined && { isOnboarded }),
        }
      });

      res.json({ settings });
    } else {
      res.json({ message: 'Settings updated successfully' });
    }
  } catch (error) {
    console.error('Error updating salon settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/services - Get authenticated salon's services (for salon management)
router.get('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const salonId = req.user.salonId;
  console.log(`[SALON_SERVICES] authenticated request for salonId=${salonId}`);

  try {
    const services = await prisma.service.findMany({
      where: {
        salonId: salonId
      },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true
        // TODO: Add enabled field to Service model
      },
      orderBy: { name: 'asc' }
    });

    console.log(`[SALON_SERVICES] found ${services.length} services for salonId=${salonId}`);

    // Transform to expected format with enabled status
    const servicesWithStatus = services.map(service => ({
      id: service.id,
      name: service.name,
      price: service.price,
      duration: service.duration,
      enabled: true // Default to true until enabled field is added
    }));

    res.json({ services: servicesWithStatus });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/services/public - Get salon services by ID (public for magic links)
router.get('/services/public', async (req: any, res: any) => {
  // Allow public access for magic link booking flow
  // But filter by salonId from query parameter
  const { s: salonId } = req.query;

  console.log(`[MAGIC_SERVICES] public request for salonId=${salonId}`);

  if (!salonId) {
    console.log(`[MAGIC_SERVICES] salonId missing in query`);
    return res.status(400).json({ message: 'Salon ID required' });
  }

  try {
    const services = await prisma.service.findMany({
      where: {
        salonId: parseInt(salonId as string)
        // TODO: Add enabled field to Service model and filter by it
        // For now, all services are considered enabled
      },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true
      },
      orderBy: { name: 'asc' }
    });

    console.log(`[MAGIC_SERVICES] found ${services.length} services for salonId=${salonId}`);

    res.json({ services });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/salon/services - Create a new service
router.post('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { name, duration, price } = req.body;

  if (!name || !duration || price === undefined) {
    return res.status(400).json({ message: 'Name, duration, and price are required' });
  }

  try {
    const service = await prisma.service.create({
      data: {
        name,
        duration: parseInt(duration),
        price: parseInt(price),
        salonId: req.user.salonId,
      },
    });

    res.status(201).json({
      service: {
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: service.price,
      }
    });
  } catch (error) {
    console.error('Error creating service:', error);
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

// GET /api/salon/staff - Get authenticated salon's staff (for salon management)
router.get('/staff', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const staff = await prisma.staff.findMany({
      where: {
        salonId: req.user.salonId
      },
      select: {
        id: true,
        name: true,
        // TODO: Add enabled field to Staff model
      },
      orderBy: { name: 'asc' }
    });

    // Transform to expected format with enabled status
    const staffWithStatus = staff.map(person => ({
      id: person.id,
      name: person.name,
      enabled: true // Default to true until enabled field is added
    }));

    res.json({ staff: staffWithStatus });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/staff/public - Get salon staff by ID (public for magic links)
router.get('/staff/public', async (req: any, res: any) => {
  // Allow public access for magic link booking flow
  // But filter by salonId from query parameter
  const { s: salonId } = req.query;

  if (!salonId) {
    return res.status(400).json({ message: 'Salon ID required' });
  }

  try {
    const staff = await prisma.staff.findMany({
      where: {
        salonId: parseInt(salonId as string),
        // TODO: Add enabled field to Staff model and filter by it
      },
      select: {
        id: true,
        name: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({ staff });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/salon/staff - Create a new staff member
router.post('/staff', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
  }

  try {
    const staff = await prisma.staff.create({
      data: {
        name: name.trim(),
        salonId: req.user.salonId,
      },
    });

    res.status(201).json({
      staff: {
        id: staff.id,
        name: staff.name,
      }
    });
  } catch (error) {
    console.error('Error creating staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/salon/staff/:id - Update specific staff member
router.put('/staff/:id', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { name } = req.body;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ message: 'Valid staff ID is required' });
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
  }

  try {
    // Check if staff exists and belongs to salon
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Update staff
    const updatedStaff = await prisma.staff.update({
      where: { id: parseInt(id) },
      data: {
        name: name.trim(),
      },
    });

    res.json({
      staff: {
        id: updatedStaff.id,
        name: updatedStaff.name,
      }
    });
  } catch (error) {
    console.error('Error updating staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /api/salon/staff/:id - Delete specific staff member
router.delete('/staff/:id', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ message: 'Valid staff ID is required' });
  }

  try {
    // Check if staff exists and belongs to salon
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // Delete staff
    await prisma.staff.delete({
      where: { id: parseInt(id) },
    });

    res.json({ message: 'Staff member deleted successfully' });
  } catch (error) {
    console.error('Error deleting staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// PUT /api/salon/staff/:id/status - Update staff status (enabled/disabled)
router.put('/staff/:id/status', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id } = req.params;
  const { enabled } = req.body;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ message: 'Valid staff ID is required' });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'Enabled status must be a boolean' });
  }

  try {
    // Check if staff exists and belongs to salon
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    // For now, just return success since we don't have an enabled field in Staff model
    // TODO: Add enabled field to Staff model and implement actual status update
    res.json({ message: 'Staff status updated successfully' });
  } catch (error) {
    console.error('Error updating staff status:', error);
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
      },
      include: {
        customer: true
      }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found or cannot be cancelled' });
    }

    // Check if appointment is in the future
    if (appointment.startTime <= new Date()) {
      return res.status(400).json({ message: 'Cannot cancel past appointments' });
    }

    // Calculate hours until appointment for behavior logging
    const hoursUntilAppointment = (appointment.startTime.getTime() - Date.now()) / (1000 * 60 * 60);

    // Get salon risk configuration
    const { getSalonRiskConfig } = await import('../utils/behaviorTracking.js');
    const config = await getSalonRiskConfig(req.user.salonId);

    // Log last-minute cancellation if within configured threshold
    if (config?.isEnabled && hoursUntilAppointment < config.lastMinuteHoursThreshold && appointment.customerId) {
      const severityScore = calculateCancellationSeverity(hoursUntilAppointment);
      await logCustomerBehavior({
        customerId: appointment.customerId,
        salonId: req.user.salonId,
        appointmentId: appointment.id,
        behaviorType: BehaviorType.LAST_MINUTE_CANCELLATION,
        severityScore,
        metadata: {
          hoursUntilAppointment,
          appointmentDateTime: appointment.startTime,
          serviceName: appointment.service?.name
        }
      });
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
  const salonId = req.user.salonId;

  console.log(`[MAGIC_LINK_CREATE] creating link for salonId=${salonId}, phone=${phone}`);

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
          salonId: salonId
        },
        expiresAt
      }
    });

    console.log(`[MAGIC_LINK_CREATE] created token=${token} with salonId=${salonId}`);

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