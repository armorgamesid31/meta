import { Router } from 'express';
import {
  buildSingleServiceGroups,
  generateAvailableDates,
  generateAvailability,
  normalizePersonGroups,
} from '../services/availabilityService.js';
import { BusinessError } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import { invalidateAvailabilityForSalon } from '../services/availabilityCache.js';

const SLOT_LOCK_TTL_SECONDS = 120;

type SlotLockEntry = {
  staffId: number;
  startTime: string;
  endTime: string;
};

function parseSlotLockEntries(input: unknown): SlotLockEntry[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const parsed: SlotLockEntry[] = [];
  for (const raw of input) {
    const staffId = Number((raw as any)?.staffId);
    const startTimeIso = String((raw as any)?.startTime || '');
    const endTimeIso = String((raw as any)?.endTime || '');
    if (!Number.isInteger(staffId) || staffId <= 0) return null;
    const start = new Date(startTimeIso);
    const end = new Date(endTimeIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (start >= end) return null;
    parsed.push({ staffId, startTime: start.toISOString(), endTime: end.toISOString() });
  }
  return parsed;
}

function entriesCollideWithLock(
  newEntries: SlotLockEntry[],
  lockEntries: unknown,
): boolean {
  if (!Array.isArray(lockEntries)) return false;
  for (const newEntry of newEntries) {
    const newStart = new Date(newEntry.startTime).getTime();
    const newEnd = new Date(newEntry.endTime).getTime();
    for (const existing of lockEntries as Array<Record<string, unknown>>) {
      if (Number(existing?.staffId) !== newEntry.staffId) continue;
      const existingStart = new Date(String(existing?.startTime || '')).getTime();
      const existingEnd = new Date(String(existing?.endTime || '')).getTime();
      if (Number.isNaN(existingStart) || Number.isNaN(existingEnd)) continue;
      if (newStart < existingEnd && newEnd > existingStart) {
        return true;
      }
    }
  }
  return false;
}

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
    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();

      // 1. Çakışan BOOKED randevu var mı?
      for (const entry of entries) {
        const conflict = await tx.appointment.findFirst({
          where: {
            salonId,
            staffId: entry.staffId,
            status: 'BOOKED',
            startTime: { lt: new Date(entry.endTime) },
            endTime: { gt: new Date(entry.startTime) },
          },
          select: { id: true },
        });
        if (conflict) {
          return { error: 'SLOT_TAKEN', message: 'Slot is already booked.' } as const;
        }
      }

      // 2. Aktif başka bir SlotLock var mı?
      const activeLocks = await tx.slotLock.findMany({
        where: { salonId, expiresAt: { gt: now } },
        select: { entries: true },
      });
      for (const lock of activeLocks) {
        if (entriesCollideWithLock(entries, lock.entries)) {
          return { error: 'SLOT_TAKEN', message: 'Slot is locked by another customer.' } as const;
        }
      }

      const expiresAt = new Date(Date.now() + SLOT_LOCK_TTL_SECONDS * 1000);
      const created = await tx.slotLock.create({
        data: {
          salonId,
          entries: entries as any,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });

      return { id: created.id, expiresAt: created.expiresAt } as const;
    }, { isolationLevel: 'Serializable' });

    if ('error' in result) {
      return res.status(409).json({ code: result.error, message: result.message });
    }

    // Lock motorun blocked listesine girer; cache stale olabilir.
    invalidateAvailabilityForSalon(salonId).catch(() => undefined);

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

  await prisma.slotLock.deleteMany({ where: { id, salonId } });
  invalidateAvailabilityForSalon(salonId).catch(() => undefined);
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
