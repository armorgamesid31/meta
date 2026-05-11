// Feedback routes (public — token-authenticated, no JWT).
//
// Mounted at /api/feedback. The token in the URL is opaque — only a
// holder of the FEEDBACK magic link can read or submit.

import { Router } from 'express';
import { BusinessError } from '../lib/errors.js';
import { getFeedbackContext, submitFeedback } from '../services/feedbackService.js';

const router = Router();

// GET /api/feedback/:token
// Returns appointment context for the feedback form. Does NOT consume
// the link — that only happens on POST submit.
router.get('/:token', async (req: any, res: any) => {
  const token = String(req.params?.token || '').trim();
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token gereklidir.', 400);
  }
  try {
    const ctx = await getFeedbackContext(token);
    return res.status(200).json({
      appointmentId: ctx.appointmentId,
      salonId: ctx.salonId,
      salonName: ctx.salonName,
      serviceName: ctx.serviceName,
      staffName: ctx.staffName,
      appointmentDate: ctx.appointmentDate.toISOString(),
      customerName: ctx.customerName,
      alreadySubmitted: ctx.alreadySubmitted,
      existingServiceRating: ctx.existingServiceRating,
      existingSalonRating: ctx.existingSalonRating,
    });
  } catch (error: any) {
    const message = error?.message || 'feedback_error';
    const status =
      message === 'feedback_link_not_found' || message === 'feedback_appointment_not_found'
        ? 404
        : message === 'feedback_link_revoked' || message === 'feedback_link_wrong_type'
          ? 410
          : 400;
    throw new BusinessError(message, message, status);
  }
});

// POST /api/feedback/:token/submit
// Body: { serviceRating: 1..5, salonRating: 1..5, comment?: string }
// Atomic consume; rejects if already submitted.
router.post('/:token/submit', async (req: any, res: any) => {
  const token = String(req.params?.token || '').trim();
  const serviceRating = Number(req.body?.serviceRating);
  const salonRating = Number(req.body?.salonRating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment : null;

  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token gereklidir.', 400);
  }

  try {
    await submitFeedback({ token, serviceRating, salonRating, comment });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    const message = error?.message || 'feedback_error';
    const status =
      message === 'feedback_already_submitted'
        ? 409
        : message === 'feedback_link_not_found'
          ? 404
          : message === 'feedback_link_revoked'
            ? 410
            : 400;
    throw new BusinessError(message, message, status);
  }
});

export default router;
