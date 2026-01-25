import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

// GET /availability?salonId=ID&date=YYYY-MM-DD
router.get('/', async (req: any, res: any) => {
  const { salonId, date } = req.query as any;

  if (!salonId || !date) {
    return res.status(400).json({ message: 'salonId and date are required' });
  }

  try {
    // Parse and validate date
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Get salon settings for working hours
    const salon = await prisma.salon.findUnique({
      where: { id: parseInt(salonId) },
      select: {
        id: true,
        settings: {
          select: {
            workStartHour: true,
            workEndHour: true,
            slotInterval: true
          }
        }
      }
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    const settings = salon.settings;
    if (!settings) {
      return res.status(404).json({ message: 'Salon settings not found' });
    }

    // Generate time slots
    const slots: string[] = [];
    const startHour = settings.workStartHour;
    const endHour = settings.workEndHour;
    const interval = settings.slotInterval;

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += interval) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        slots.push(timeString);
      }
    }

    // For now, return all slots as available
    // In a real implementation, you would check existing appointments
    // and staff availability here

    res.json({
      date: date,
      slots: slots
    });

  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;