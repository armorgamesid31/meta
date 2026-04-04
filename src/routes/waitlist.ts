import { Router } from 'express';
import { createWaitlistEntry, getWaitlistOfferByToken, acceptWaitlistOffer, rejectWaitlistOffer } from '../services/waitlist.js';
import type { PersonGroup } from '../modules/availability/types.js';

const router = Router();

function asGroups(input: unknown): PersonGroup[] {
  return Array.isArray(input) ? (input as PersonGroup[]) : [];
}

router.post('/', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Salon context is required.' });
  }

  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
  const timeWindowStart = typeof req.body?.timeWindowStart === 'string' ? req.body.timeWindowStart.trim() : '';
  const timeWindowEnd = typeof req.body?.timeWindowEnd === 'string' ? req.body.timeWindowEnd.trim() : '';
  const groups = asGroups(req.body?.groups);
  const customerId = Number(req.body?.customerId);
  const customerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
  const customerPhone = typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  if (!date || !timeWindowStart || !timeWindowEnd || !groups.length || !customerName || !customerPhone) {
    return res.status(400).json({ message: 'date, time window, groups, customerName and customerPhone are required.' });
  }

  try {
    const item = await createWaitlistEntry({
      salonId,
      date,
      timeWindowStart,
      timeWindowEnd,
      groups,
      source: 'CUSTOMER',
      customer: {
        customerId: Number.isInteger(customerId) && customerId > 0 ? customerId : null,
        customerName,
        customerPhone,
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
    return res.status(400).json({ message: 'token is required.' });
  }

  try {
    const offer = await getWaitlistOfferByToken(token);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found.' });
    }
    return res.status(200).json(offer);
  } catch (error) {
    console.error('Waitlist offer fetch error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/offers/:token/accept', async (req: any, res: any) => {
  const token = typeof req.params?.token === 'string' ? req.params.token.trim() : '';
  if (!token) {
    return res.status(400).json({ message: 'token is required.' });
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
    return res.status(400).json({ message: 'token is required.' });
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
