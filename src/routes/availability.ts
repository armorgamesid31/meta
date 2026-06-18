import { Router } from 'express';
import {
  buildSingleServiceGroups,
  generateAvailableDates,
  generateAvailability,
  normalizePersonGroups,
} from '../services/availabilityService.js';
import { BusinessError } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import type { DisplaySlot } from '../modules/availability/types.js';
import { createSlotLock, deleteSlotLock, refreshSlotLock, parseSlotLockEntries } from '../services/slotLock.js';

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

    const result = await generateAvailability({ salonId, date, groups });

    // OFF_PEAK kampanyası varsa slot saatlerini etiketle.
    const offPeakCampaigns = await prisma.campaign.findMany({
      where: { salonId, isActive: true, type: 'OFF_PEAK' },
      select: { config: true },
    }).catch(() => []);

    const offPeakRanges = offPeakCampaigns
      .map((c) => {
        const cfg = (c.config || {}) as Record<string, any>;
        const sh = String(cfg.startHour || '').trim();
        const eh = String(cfg.endHour || '').trim();
        const dt = String(cfg.discountType || cfg.rewardType || '').toLowerCase();
        const dv = Number(cfg.discountValue ?? cfg.rewardValue ?? 0);
        if (!/^\d{2}:\d{2}$/.test(sh) || !/^\d{2}:\d{2}$/.test(eh)) return null;
        const label = dt.includes('percent') && dv > 0
          ? `%${dv} indirim`
          : dt.includes('fixed') && dv > 0
            ? `${dv}₺ indirim`
            : 'özel fiyat';
        return { startHour: sh, endHour: eh, label };
      })
      .filter(Boolean) as { startHour: string; endHour: string; label: string }[];

    let displaySlots = result.displaySlots as DisplaySlot[];
    if (offPeakRanges.length > 0) {
      displaySlots = displaySlots.map((slot) => {
        const matched = offPeakRanges.find(
          (r) => slot.startTime >= r.startHour && slot.startTime < r.endHour,
        );
        return matched ? { ...slot, offPeakLabel: `Sakin saat – ${matched.label}` } : slot;
      });
    }

    // Uzman tercihi etiketleme (matchesPreferred). Frontend uzman seçimini artık
    // KATI FİLTRE (allowedStaffIds) yerine TERCİH (preferredStaffIds) olarak
    // gönderir: motor tüm uzmanları hesaplar, biz her slotu "tercih edilen
    // uzmanla mı dolu?" diye işaretleriz. normalizePersonGroups bu alanı yok
    // sayar (motor algoritması değişmez) → ham body'den person+service bazında
    // okuyoruz. personId frontend ile aynı kuralla (p1, p2…) hizalanır.
    const preferenceByPersonService = new Map<string, Set<number>>();
    let anyPreference = false;
    const rawGroups = Array.isArray(req.body?.groups) ? req.body.groups : [];
    rawGroups.forEach((g: any, gi: number) => {
      const personId = typeof g?.personId === 'string' && g.personId.trim() ? g.personId.trim() : `p${gi + 1}`;
      const svcs = Array.isArray(g?.services) ? g.services : [];
      for (const s of svcs) {
        if (!s || typeof s !== 'object') continue;
        const serviceId = Number(s.serviceId);
        if (!Number.isInteger(serviceId) || serviceId <= 0) continue;
        const pref = Array.isArray(s.preferredStaffIds)
          ? s.preferredStaffIds.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0)
          : [];
        if (pref.length) {
          anyPreference = true;
          preferenceByPersonService.set(`${personId}:${serviceId}`, new Set(pref));
        }
      }
    });

    displaySlots = displaySlots.map((slot) => {
      // Tercih yoksa her slot "istediği gibi" (yeşil) sayılır.
      if (!anyPreference) return { ...slot, matchesPreferred: true };
      let matchesPreferred = true;
      for (const ps of slot.personSlots) {
        for (const seq of ps.serviceSequence) {
          const pref = preferenceByPersonService.get(`${ps.personId}:${seq.serviceId}`);
          if (pref && !pref.has(seq.staffId)) {
            matchesPreferred = false;
            break;
          }
        }
        if (!matchesPreferred) break;
      }
      return { ...slot, matchesPreferred };
    });

    res.json({ ...result, displaySlots });
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
    if (result.ok === true) {
      return res.status(201).json({ id: result.id, expiresAt: result.expiresAt });
    }
    return res.status(409).json({ code: result.code, message: result.message });
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

// POST /availability/lock/:id/refresh — extend a still-valid lock's TTL.
// The booking UI calls this on an interval while the (multi-step) registration
// modal is open, so the customer doesn't lose the slot mid-form. Returns 409 if
// the lock already expired/was taken so the UI can react.
router.post('/lock/:id/refresh', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon context is required.', 400);
  }
  const id = String(req.params?.id || '').trim();
  if (!id) {
    throw new BusinessError('VALIDATION_FAILED', 'lock id is required.', 400);
  }
  const result = await refreshSlotLock(salonId, id);
  if (result.ok) {
    return res.status(200).json({ ok: true, expiresAt: result.expiresAt });
  }
  return res.status(409).json({ ok: false, code: 'LOCK_EXPIRED', message: 'Slot lock expired or taken.' });
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
