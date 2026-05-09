import { Router } from 'express';
import { createWaitlistEntry, getWaitlistOfferByToken, acceptWaitlistOffer, rejectWaitlistOffer } from '../services/waitlist.js';
import type { PersonGroup } from '../modules/availability/types.js';
import { normalizeDigitsOnly } from '../services/phoneValidation.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

function asGroups(input: unknown): PersonGroup[] {
  return Array.isArray(input) ? (input as PersonGroup[]) : [];
}

router.post('/', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon context is required.', 400);
  }

  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
  const timeWindowStart = typeof req.body?.timeWindowStart === 'string' ? req.body.timeWindowStart.trim() : '';
  const timeWindowEnd = typeof req.body?.timeWindowEnd === 'string' ? req.body.timeWindowEnd.trim() : '';
  const groups = asGroups(req.body?.groups);
  const customerId = Number(req.body?.customerId);
  const customerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
  const customerPhone = typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
  const allowNearbyMatches = Boolean(req.body?.allowNearbyMatches);
  const nearbyToleranceMinutes = Number(req.body?.nearbyToleranceMinutes);

  if (!date || !timeWindowStart || !timeWindowEnd || !groups.length || !customerName || !customerPhone) {
    throw new BusinessError('VALIDATION_FAILED', 'date, time window, groups, customerName and customerPhone are required.', 400);
  }

  try {
    const normalizedPhone = normalizeDigitsOnly(customerPhone);
    if (!normalizedPhone) {
      throw new BusinessError('VALIDATION_FAILED', 'phone_required', 400);
    }
    const item = await createWaitlistEntry({
      salonId,
      date,
      timeWindowStart,
      timeWindowEnd,
      allowNearbyMatches,
      nearbyToleranceMinutes: Number.isFinite(nearbyToleranceMinutes) ? nearbyToleranceMinutes : 60,
      groups,
      source: 'CUSTOMER',
      customer: {
        customerId: Number.isInteger(customerId) && customerId > 0 ? customerId : null,
        customerName,
        customerPhone: normalizedPhone,
      },
      notes,
    });
    return res.status(201).json({ item });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /required|invalid/i.test(message) ? 400 : 500;
    if (status === 500) {
      console.error('Public waitlist create error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.get('/offers/:token', async (req: any, res: any) => {
  const token = typeof req.params?.token === 'string' ? req.params.token.trim() : '';
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token is required.', 400);
  }

  try {
    const offer = await getWaitlistOfferByToken(token);
    if (!offer) {
      throw new BusinessError('NOT_FOUND', 'Offer not found.', 404);
    }
    return res.status(200).json(offer);
  } catch (error) {
    console.error('Waitlist offer fetch error:', error);
    throw error;
  }
});

router.post('/offers/:token/accept', async (req: any, res: any) => {
  const token = typeof req.params?.token === 'string' ? req.params.token.trim() : '';
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token is required.', 400);
  }

  try {
    const result = await acceptWaitlistOffer(token);
    return res.status(200).json(result);
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status =
      /not_found/.test(message)
        ? 404
        : /expired|not_active|conflict/.test(message)
          ? 409
          : 500;
    if (status === 500) {
      console.error('Waitlist offer accept error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.post('/offers/:token/reject', async (req: any, res: any) => {
  const token = typeof req.params?.token === 'string' ? req.params.token.trim() : '';
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token is required.', 400);
  }

  try {
    await rejectWaitlistOffer(token);
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /not_found/.test(message) ? 404 : 500;
    if (status === 500) {
      console.error('Waitlist offer reject error:', error);
    }
    return res.status(status).json({ message });
  }
});

export default router;
