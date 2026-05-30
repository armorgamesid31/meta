import { Router } from 'express';
import {
  buildSingleServiceGroups,
  generateAvailableDates,
  generateAvailability,
  normalizePersonGroups,
} from '../services/availabilityService.js';
import { BusinessError } from '../lib/errors.js';
import { createSlotLock, deleteSlotLock, parseSlotLockEntries } from '../services/slotLock.js';

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

// POST /availability/lock — reserve a specific display slot for 120s.
// Müşteri spesifik bir slot seçtiğinde çağrılır. Lock motorun sonraki
// availability sorgularında ilgili staff×saat kombinasyonunu "dolu"
// olarak işaretler; başka müşteri o slotu boş göremez.
router.post('/lock', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon context is required.', 400);
  }

  const entries = parseSlotLockEntries(req.body?.entries);
  if (!entries) {
    throw new BusinessError('VALIDATION_FAILED', 'entries must be a non-empty array of { staffId, startTime, endTime }.', 400);
  }

  try {
    const result = await createSlotLock(salonId, entries);
    if (!result.ok) {
      return res.status(409).json({ code: result.code, message: result.message });
    }
    return res.status(201).json({ id: result.id, expiresAt: result.expiresAt });
  } catch (error) {
    console.error('Error creating slot lock:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Failed to create slot lock.', 500);
  }
});

// DELETE /availability/lock/:id — best-effort release. UI calls this when
// the customer abandons the slot (geri butonu, başka slot seç, vs).
// 120s sonra otomatik expire ettiği için cleanup kritik değil.
router.delete('/lock/:id', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon context is required.', 400);
  }

  const id = String(req.params?.id || '').trim();
  if (!id) {
    throw new BusinessError('VALIDATION_FAILED', 'lock id is required.', 400);
  }

  await deleteSlotLock(salonId, id);
  return res.status(200).json({ ok: true });
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
