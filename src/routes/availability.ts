import { Router } from 'express';
import {
  buildSingleServiceGroups,
  generateAvailableDates,
  generateAvailability,
  normalizePersonGroups,
} from '../services/availabilityService.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

router.post('/dates', async (req: any, res: any) => {
  try {
    const { startDate, endDate } = req.body;
    const salonId = req.salon?.id;
    const groups = normalizePersonGroups(req.body?.groups);

    if (!salonId || !startDate || !endDate || !groups.length) {
      throw new BusinessError('VALIDATION_FAILED', 'Missing required fields or tenant context', 400);
    }

    const result = await generateAvailableDates({
      salonId,
      startDate,
      endDate,
      groups,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching available dates:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

router.post('/slots', async (req: any, res: any) => {
  try {
    const { date } = req.body;
    const salonId = req.salon?.id;
    const groups = normalizePersonGroups(req.body?.groups);

    if (!salonId || !date || !groups.length) {
      throw new BusinessError('VALIDATION_FAILED', 'Missing required fields or tenant context', 400);
    }

    const result = await generateAvailability({
      salonId,
      date,
      groups,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching slots:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

router.get('/', async (req: any, res: any) => {
  const serviceId = Number(req.query?.serviceId);
  const date = typeof req.query?.date === 'string' ? req.query.date : '';
  const peopleCount = Number(req.query?.peopleCount || 1);
  const salonId = req.salon?.id;

  if (!salonId || !Number.isInteger(serviceId) || serviceId <= 0 || !date) {
    throw new BusinessError('VALIDATION_FAILED', 'serviceId and date are required, and must be in a tenant subdomain', 400);
  }

  try {
    const result = await generateAvailability({
      salonId,
      date,
      groups: buildSingleServiceGroups(serviceId, Number.isInteger(peopleCount) && peopleCount > 0 ? peopleCount : 1),
    });

    res.json({
      date,
      slots: result.displaySlots.map((slot) => slot.label),
      displaySlots: result.displaySlots,
      lockToken: result.lockToken,
    });
  } catch (error) {
    console.error('Error fetching availability:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

export default router;
