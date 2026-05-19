/**
 * Public lead capture endpoints (no auth).
 *
 *   POST /api/leads                          — marketing site form submit
 *   GET  /api/leads/:token/preview           — activation page pre-fill
 *   POST /api/leads/:token/activate          — set password, create salon, log in
 *
 * Rate-limited at the mount-level (authRateLimiter) by server.ts to
 * stop email-spamming abuse. CORS allowed origins are the marketing
 * site domains; localhost is fine for dev.
 */

import { Router } from 'express';
import { z } from 'zod';
import { SalonCategory } from '@prisma/client';
import { BusinessError } from '../lib/errors.js';
import { createLead, previewLead, activateLead } from '../services/leadService.js';

const router = Router();

const SALON_CATEGORY_VALUES = Object.values(SalonCategory) as [SalonCategory, ...SalonCategory[]];

const createSchema = z.object({
  contactName: z.string().min(2).max(80),
  phone: z.string().min(9).max(30),
  email: z.string().email().max(160),
  salonName: z.string().min(2).max(120),
  salonCategory: z.enum(SALON_CATEGORY_VALUES).optional(),
  acceptMarketing: z.boolean().optional(),
  kvkkConsent: z
    .boolean()
    .refine((v) => v === true, { message: 'KVKK metnini onaylamalısın.' }),
  utmSource: z.string().max(120).optional(),
  utmMedium: z.string().max(120).optional(),
  utmCampaign: z.string().max(120).optional(),
  utmContent: z.string().max(120).optional(),
  utmTerm: z.string().max(120).optional(),
  referrer: z.string().max(1024).optional(),
  landingPath: z.string().max(512).optional(),
});

router.post('/', async (req: any, res: any) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Form bilgilerinde eksik veya hata var.', 400, {
      issues: parsed.error.issues,
    });
  }
  const ipAddress =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512);

  const result = await createLead({
    ...parsed.data,
    ipAddress,
    userAgent,
  });
  res.status(201).json({
    ok: true,
    leadId: result.leadId,
    status: result.status,
    emailSent: result.emailSent,
    webhookSent: result.webhookSent,
  });
});

router.get('/:token/preview', async (req: any, res: any) => {
  const token = String(req.params.token || '').trim();
  if (!token) throw new BusinessError('VALIDATION_FAILED', 'Token gerekli.', 400);
  const preview = await previewLead(token);
  res.json(preview);
});

const activateSchema = z.object({
  password: z.string().min(8).max(120),
});

router.post('/:token/activate', async (req: any, res: any) => {
  const token = String(req.params.token || '').trim();
  if (!token) throw new BusinessError('VALIDATION_FAILED', 'Token gerekli.', 400);
  const parsed = activateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Şifre kuralı: en az 8 karakter.', 400, {
      issues: parsed.error.issues,
    });
  }
  const result = await activateLead({ rawToken: token, password: parsed.data.password });
  res.status(201).json({
    ok: true,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
  });
});

export default router;
