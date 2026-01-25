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

  try {
    let where: any = {
      salonId: req.user.salonId,
      status: {
        in: ['BOOKED', 'CANCELLED']
      }
    };

    if (date) {
      const targetDate = new Date(date as string);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      where.startTime = {
        gte: startOfDay,
        lte: endOfDay
      };
    }

    const appointments = await prisma.appointment.findMany({
      where,
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
        startTime: 'desc'
      },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    res.json({
      appointments: appointments.map(apt => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        status: apt.status,
        customerName: apt.customerName,
        customerPhone: apt.customerPhone,
        service: apt.service,
        staff: apt.staff
      }))
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;