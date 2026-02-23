import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { logCustomerBehavior, calculateCancellationSeverity, BehaviorType } from '../utils/behaviorTracking.js';
import { CATEGORIES, CATEGORY_ORDER } from '../constants/categories.js';

const router = Router();

// GET /api/salon/public - Get salon info (public for tenant subdomain)
router.get('/public', async (req: any, res: any) => {
  const salonId = req.salon?.id;

  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
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
        slotInterval: salon.settings?.slotInterval || 30,
        categoryOrder: salon.settings?.categoryOrder || null
      }
    });
  } catch (error) {
    console.error('Error fetching salon public info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

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

    const hasServices = salon._count.services > 0;
    const hasWorkingHours = (salon.settings?.workStartHour !== undefined &&
                            salon.settings?.workEndHour !== undefined);
    const onboardingComplete = hasServices && hasWorkingHours;
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

  const { name, phone, address, workStartHour, workEndHour, slotInterval, isOnboarded, categoryOrder } = req.body;

  try {
    if (name || phone || address) {
      await prisma.salon.update({
        where: { id: req.user.salonId },
        data: {
          ...(name && { name }),
        }
      });
    }

    if (workStartHour !== undefined || workEndHour !== undefined || slotInterval !== undefined || isOnboarded !== undefined || categoryOrder !== undefined) {
      const settings = await prisma.salonSettings.upsert({
        where: { salonId: req.user.salonId },
        update: {
          ...(workStartHour !== undefined && { workStartHour }),
          ...(workEndHour !== undefined && { workEndHour }),
          ...(slotInterval !== undefined && { slotInterval }),
          ...(isOnboarded !== undefined && { isOnboarded }),
          ...(categoryOrder !== undefined && { categoryOrder }),
        },
        create: {
          salonId: req.user.salonId,
          ...(workStartHour !== undefined && { workStartHour }),
          ...(workEndHour !== undefined && { workEndHour }),
          ...(slotInterval !== undefined && { slotInterval }),
          ...(isOnboarded !== undefined && { isOnboarded }),
          ...(categoryOrder !== undefined && { categoryOrder }),
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

// GET /api/salon/services - Get authenticated salon's services
router.get('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const salonId = req.user.salonId;

  try {
    const services = await prisma.service.findMany({
      where: {
        salonId: salonId
      },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true
      },
      orderBy: { name: 'asc' }
    });

    res.json({ services });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/services/public - Get salon services grouped by category
router.get('/services/public', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const { gender } = req.query;

  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  try {
    // 1. Fetch salon settings for category order
    const settings = await prisma.salonSettings.findUnique({
      where: { salonId },
      select: { categoryOrder: true }
    });

    // 2. Fetch services with optional gender filter
    const rawServices = await prisma.service.findMany({
      where: {
        salonId,
        ...(gender && {
            OR: [
                { ServiceGender: { some: { gender: gender as any } } },
                { ServiceGender: { none: {} } } // Fallback for services with no specific gender
            ]
        })
      },
      select: {
        id: true,
        name: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true
      }
    });

    // 3. Group services by category
    const groupedMap: Record<string, any[]> = {};
    
    rawServices.forEach(service => {
      const dbCat = (service.category || '').toUpperCase().trim();
      let finalKey = 'OTHER';

      if (dbCat.includes('LAZER') || dbCat === 'LASER') finalKey = 'LASER';
      else if (dbCat.includes('AĞDA') || dbCat.includes('AGDA') || dbCat === 'WAX') finalKey = 'WAX';
      else if (dbCat.includes('TIRNAK') || dbCat.includes('MANİKÜR') || dbCat.includes('PEDİKÜR') || dbCat === 'NAIL') finalKey = 'NAIL';
      else if (dbCat.includes('CİLT') || dbCat.includes('YÜZ') || dbCat === 'FACIAL') finalKey = 'FACIAL';
      else if (dbCat.includes('MASAJ') || dbCat.includes('BODY') || dbCat.includes('VÜCUT')) finalKey = 'BODY';
      else if (dbCat.includes('SAÇ') || dbCat.includes('HAIR')) finalKey = 'HAIR';
      else if (dbCat.includes('MEDİKAL') || dbCat === 'MEDICAL') finalKey = 'MEDICAL';
      else if (dbCat.includes('DANIŞMANLIK') || dbCat === 'CONSULTATION') finalKey = 'CONSULTATION';

      if (!groupedMap[finalKey]) {
        groupedMap[finalKey] = [];
      }
      
      groupedMap[finalKey].push({
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: service.price,
        requiresSpecialist: service.requiresSpecialist || false
      });
    });

    // 4. Use custom order if exists, otherwise default order
    const customOrder = settings?.categoryOrder as string[] | null;
    const finalOrder = (customOrder && Array.isArray(customOrder)) ? customOrder : CATEGORY_ORDER;

    // 5. Build response
    const response = finalOrder
      .filter(key => groupedMap[key] && groupedMap[key].length > 0)
      .map(key => ({
        key: key,
        name: CATEGORIES[key] || key,
        services: groupedMap[key]
      }));

    // Add any categories present in DB but missing from the order (safety fallback)
    Object.keys(groupedMap).forEach(key => {
        if (!finalOrder.includes(key)) {
            response.push({
                key,
                name: CATEGORIES[key] || key,
                services: groupedMap[key]
            });
        }
    });

    res.json({ categories: response });
  } catch (error) {
    console.error('Error fetching grouped services:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/services/:serviceId/staff - Get staff for a specific service
router.get('/services/:serviceId/staff', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const { serviceId } = req.params;

  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  try {
    const staffServices = await prisma.staffService.findMany({
      where: {
        serviceId: parseInt(serviceId),
        Staff: { salonId },
        isactive: true
      },
      include: {
        Staff: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    const response = staffServices.map(ss => ({
      id: ss.Staff.id,
      name: ss.Staff.name,
      price: ss.price,
      duration: ss.duration
    }));

    res.json({ staff: response });
  } catch (error) {
    console.error('Error fetching service-specific staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/salon/services - Create a new service
router.post('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { name, duration, price, category, requiresSpecialist } = req.body;

  if (!name || !duration || price === undefined) {
    return res.status(400).json({ message: 'Name, duration, and price are required' });
  }

  try {
    const service = await prisma.service.create({
      data: {
        name,
        duration: parseInt(duration),
        price: parseFloat(price),
        category: category || 'OTHER',
        requiresSpecialist: !!requiresSpecialist,
        salonId: req.user.salonId,
      },
    });

    res.status(201).json({ service });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/staff - Get authenticated salon's staff
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
      },
      orderBy: { name: 'asc' }
    });

    res.json({ staff });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/staff/public - Get salon staff (public for tenant subdomain)
router.get('/staff/public', async (req: any, res: any) => {
  const salonId = req.salon?.id;

  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  try {
    const staff = await prisma.staff.findMany({
      where: {
        salonId
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

    res.status(201).json({ staff });
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

  try {
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    const updatedStaff = await prisma.staff.update({
      where: { id: parseInt(id) },
      data: {
        name: name.trim(),
      },
    });

    res.json({ staff: updatedStaff });
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

  try {
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      return res.status(404).json({ message: 'Staff member not found' });
    }

    await prisma.staff.delete({
      where: { id: parseInt(id) },
    });

    res.json({ message: 'Staff member deleted successfully' });
  } catch (error) {
    console.error('Error deleting staff:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/salon/appointments - Get salon appointments
router.get('/appointments', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { date, limit = '50', offset = '0' } = req.query;

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
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId,
        status: 'BOOKED'
      },
      include: {
        customer: true,
        service: true
      }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found or cannot be cancelled' });
    }

    if (appointment.startTime <= new Date()) {
      return res.status(400).json({ message: 'Cannot cancel past appointments' });
    }

    const hoursUntilAppointment = (appointment.startTime.getTime() - Date.now()) / (1000 * 60 * 60);

    const { getSalonRiskConfig } = await import('../utils/behaviorTracking.js');
    const config = await getSalonRiskConfig(req.user.salonId);

    if (config?.isEnabled && config.lastMinuteHoursThreshold && hoursUntilAppointment < config.lastMinuteHoursThreshold && appointment.customerId) {
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

export default router;
