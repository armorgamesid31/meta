import { Router } from 'express';
import { prisma } from '../prisma.js';
import { DatesEngine, SlotsEngine } from '../modules/availability/index.js';

const router = Router();

// POST /availability/dates
router.post('/dates', async (req: any, res: any) => {
  try {
    const { salonId, startDate, endDate, groups } = req.body;

    if (!salonId || !startDate || !endDate || !groups) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const engine = new DatesEngine();
    const result = await engine.getAvailableDates({
      salonId,
      startDate,
      endDate,
      groups
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching available dates:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /availability/slots
router.post('/slots', async (req: any, res: any) => {
  try {
    const { salonId, date, groups } = req.body;

    if (!salonId || !date || !groups) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const engine = new SlotsEngine();
    const result = await engine.generateSlots({
      salonId,
      date,
      groups
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching slots:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /availability?salonId=ID&serviceId=ID&date=YYYY-MM-DD
router.get('/', async (req: any, res: any) => {
  const { salonId, serviceId, date } = req.query as any;

  console.log('typeof salonId:', typeof salonId, 'salonId:', salonId, 'serviceId:', serviceId);

  if (!salonId || !serviceId || !date) {
    return res.status(400).json({ message: 'salonId, serviceId and date are required' });
  }

  try {
    // Parse and validate date
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Get staff IDs for this salon
    const staffIds = await prisma.staff.findMany({
      where: { salonId: parseInt(salonId) },
      select: { id: true }
    });

    // Get StaffService mappings for this service and staff in salon
    const staffServices = await prisma.staffService.findMany({
      where: {
        serviceId: parseInt(serviceId),
        staffId: { in: staffIds.map(s => s.id) },
        isactive: true
      }
    });

    console.log('staffService count:', staffServices.length);

    if (staffServices.length === 0) {
      return res.status(400).json({ message: 'No staff available for this service' });
    }

    // Get salon settings as fallback
    const salonSettings = await prisma.salonSettings.findUnique({
      where: { salonId: parseInt(salonId) }
    });

    if (!salonSettings) {
      return res.status(404).json({ message: 'Salon settings not found' });
    }

    // Get working hours for all staff
    const staffWorkingHours = await prisma.staffWorkingHours.findMany({
      where: {
        staffId: { in: staffServices.map(ss => ss.staffId) }
      }
    });

    // Collect all possible working hours from staff
    const workingHoursMap = new Map<number, { start: number, end: number }>();

    for (const wh of staffWorkingHours) {
      const dayOfWeek = wh.dayOfWeek;
      if (dayOfWeek === null) continue;
      const existing = workingHoursMap.get(dayOfWeek);
      if (!existing || wh.startHour < existing.start) {
        workingHoursMap.set(dayOfWeek, { start: wh.startHour, end: wh.endHour });
      }
    }

    // If no working hours, use salon settings
    const targetDayOfWeek = targetDate.getDay(); // 0 = Sunday
    const dayHours = workingHoursMap.get(targetDayOfWeek) || {
      start: salonSettings.workStartHour,
      end: salonSettings.workEndHour
    };

    console.log('working hours used:', dayHours);

    // Get duration from StaffService (use the first one, or min/max?)
    const durations = staffServices.map(ss => ss.duration);
    const slotDuration = Math.min(...durations); // Use shortest duration for slots
    console.log('duration used:', slotDuration);

    // Get existing appointments for this date and staff
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffId: { in: staffServices.map(ss => ss.staffId) },
        startTime: {
          gte: startOfDay,
          lte: endOfDay
        },
        status: { in: ['BOOKED', 'COMPLETED'] } // Exclude cancelled/no-show
      },
      select: {
        startTime: true,
        endTime: true
      }
    });

    console.log('existing appointments count:', existingAppointments.length);

    // Get leaves for this date and staff
    const leaves = await prisma.leave.findMany({
      where: {
        staffId: { in: staffServices.map(ss => ss.staffId) },
        startDate: { lte: targetDate },
        endDate: { gte: targetDate }
      }
    });

    console.log('leaves count:', leaves.length);

    // Generate time slots
    const slots: string[] = [];
    const startHour = dayHours.start;
    const endHour = dayHours.end;
    const interval = salonSettings.slotInterval;

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += interval) {
        const slotStart = new Date(targetDate);
        slotStart.setHours(hour, minute, 0, 0);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotStart.getMinutes() + slotDuration);

        // Check if slot conflicts with appointments
        const conflictsWithAppointment = existingAppointments.some(apt => {
          return (slotStart < apt.endTime && slotEnd > apt.startTime);
        });

        // Check if slot conflicts with leaves
        const conflictsWithLeave = leaves.some(leave => {
          const leaveStart = new Date(leave.startDate);
          const leaveEnd = new Date(leave.endDate);
          leaveEnd.setHours(23, 59, 59, 999);
          return (slotStart >= leaveStart && slotStart <= leaveEnd);
        });

        if (!conflictsWithAppointment && !conflictsWithLeave) {
          const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
          slots.push(timeString);
        }
      }
    }

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