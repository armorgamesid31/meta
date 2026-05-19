/**
 * Salon-facing actions inside an active conversation panel.
 *
 *   POST /api/conversations/:conversationKey/send-magic-link
 *     body: { type?: 'BOOKING'|'RESCHEDULE'|'CANCEL', appointmentId?: number, customMessage?: string }
 *
 * Returns the generated magic URL even when delivery fails, so the UI
 * can offer a "Manuel kopyala" fallback.
 */

import { Router } from 'express';
import { z } from 'zod';
import { MagicLinkType } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import { sendMagicLinkInConversation } from '../services/conversationMagicLink.js';

const router = Router();

router.use(authenticateToken);

const bodySchema = z.object({
  type: z.enum(['BOOKING', 'RESCHEDULE', 'FEEDBACK']).optional(),
  appointmentId: z.number().int().positive().optional(),
  customMessage: z.string().max(800).optional(),
});

router.post('/:conversationKey/send-magic-link', async (req: any, res: any) => {
  const salonId = Number(req.user?.salonId || 0);
  if (!salonId) throw new BusinessError('UNAUTHORIZED', 'Oturum eksik.', 401);

  const conversationKey = String(req.params.conversationKey || '').trim();
  if (!conversationKey) {
    throw new BusinessError('VALIDATION_FAILED', 'conversationKey gerekli.', 400);
  }

  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz istek.', 400, {
      issues: parsed.error.issues,
    });
  }
  const type = (parsed.data.type as MagicLinkType | undefined) || MagicLinkType.BOOKING;

  try {
    const result = await sendMagicLinkInConversation({
      salonId,
      conversationKey,
      type,
      appointmentId: parsed.data.appointmentId,
      customMessage: parsed.data.customMessage,
      senderUserId: Number(req.user?.userId || 0) || null,
      senderUserEmail: String(req.user?.email || '') || null,
    });
    res.json(result);
  } catch (err: any) {
    if (err?.message === 'CONVERSATION_NOT_FOUND') {
      throw new BusinessError('NOT_FOUND', 'Konuşma bulunamadı.', 404);
    }
    if (err?.message === 'APPOINTMENT_NOT_FOUND') {
      throw new BusinessError('NOT_FOUND', 'Randevu bulunamadı veya iptal edilemez durumda.', 404);
    }
    if (err?.message === 'APPOINTMENT_REQUIRED_FOR_TYPE') {
      throw new BusinessError(
        'VALIDATION_FAILED',
        'Yeniden planlama için appointmentId gerekli.',
        400,
      );
    }
    throw err;
  }
});

export default router;
