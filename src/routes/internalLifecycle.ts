// Internal lifecycle notification endpoints — called by n8n hourly workflow.
//
// Each endpoint takes a small payload (salonId + ids) and orchestrates
// the full send via lifecycleNotificationSender. n8n queries the DB for
// rows that need notification, then POSTs each row here.
//
// Auth: Bearer INTERNAL_API_KEY (or N8N_INTERNAL_API_KEY) via the
// `requireInternalApiKey` middleware.

import { Router } from 'express';
import { BusinessError } from '../lib/errors.js';
import { requireInternalApiKey } from '../middleware/internal.js';
import {
  sendAppointmentConfirmation,
  sendReminder1Day,
  sendReminder3Day,
  sendReminder2Hour,
  sendNoShow,
  sendSatisfactionSurvey,
  sendGoogleMapsReview,
  sendBirthday,
  sendWinback,
  sendWaitlistOfferTemplate,
  type NotificationResult,
} from '../services/lifecycleNotificationSender.js';

const router = Router();

router.use(requireInternalApiKey);

function asInt(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BusinessError('VALIDATION_FAILED', `${label} must be a positive integer.`, 400);
  }
  return n;
}

function respond(result: NotificationResult, res: any) {
  const status = result.ok ? (result.skipped ? 200 : 200) : 502;
  return res.status(status).json(result);
}

// ─────────────────────────────────────────────────────────────────
// Appointment-bound sends
// ─────────────────────────────────────────────────────────────────

router.post('/appointment-confirmation', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    appointmentId: asInt(req.body?.appointmentId, 'appointmentId'),
  };
  return respond(await sendAppointmentConfirmation(input), res);
});

router.post('/reminder-1-day', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    appointmentId: asInt(req.body?.appointmentId, 'appointmentId'),
  };
  return respond(await sendReminder1Day(input), res);
});

router.post('/reminder-3-day', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    appointmentId: asInt(req.body?.appointmentId, 'appointmentId'),
  };
  return respond(await sendReminder3Day(input), res);
});

router.post('/reminder-2-hour', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    appointmentId: asInt(req.body?.appointmentId, 'appointmentId'),
  };
  return respond(await sendReminder2Hour(input), res);
});

router.post('/no-show', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    appointmentId: asInt(req.body?.appointmentId, 'appointmentId'),
  };
  return respond(await sendNoShow(input), res);
});

router.post('/satisfaction-survey', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    appointmentId: asInt(req.body?.appointmentId, 'appointmentId'),
  };
  return respond(await sendSatisfactionSurvey(input), res);
});

// ─────────────────────────────────────────────────────────────────
// Customer-bound sends
// ─────────────────────────────────────────────────────────────────

router.post('/google-maps-review', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
  };
  return respond(await sendGoogleMapsReview(input), res);
});

router.post('/birthday', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
  };
  return respond(await sendBirthday(input), res);
});

router.post('/winback', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
  };
  return respond(await sendWinback(input), res);
});

router.post('/waitlist-offer', async (req: any, res: any) => {
  const input = {
    salonId: asInt(req.body?.salonId, 'salonId'),
    customerId: asInt(req.body?.customerId, 'customerId'),
    offerToken: String(req.body?.offerToken || '').trim(),
  };
  if (!input.offerToken) {
    throw new BusinessError('VALIDATION_FAILED', 'offerToken is required.', 400);
  }
  return respond(await sendWaitlistOfferTemplate(input), res);
});

// ─────────────────────────────────────────────────────────────────
// Health probe — for n8n to verify the endpoint is up
// ─────────────────────────────────────────────────────────────────

router.get('/health', (_req: any, res: any) => res.json({ ok: true, timestamp: new Date().toISOString() }));

export default router;
