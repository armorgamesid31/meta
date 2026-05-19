/**
 * DEPRECATED: Public lead capture endpoints.
 *
 * The /baslayalim email-code round-trip has been retired. Marketing
 * site now points users straight at the app stores (or app.kedyapp.com
 * for the web panel); registration happens inside the app via the
 * onboarding magic-link flow:
 *
 *   POST /api/auth/onboarding/start              (no invite)
 *   POST /api/auth/onboarding/:id/send-phone-link
 *   POST /api/auth/onboarding/:id/send-email-link
 *   POST /api/auth/onboarding/:id/activate       → identity-only tokens
 *   POST /api/salons                             → create salon, full tokens
 *
 * Kept here only so old client builds that still hit /api/leads get a
 * structured 410 with the new endpoint hint instead of a 404. Will be
 * deleted in a follow-up cleanup once telemetry shows traffic is
 * effectively zero.
 */

import { Router } from 'express';

const router = Router();

function gone(res: any) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Fri, 19 Jun 2026 00:00:00 GMT');
  res.status(410).json({
    error: 'GONE',
    message:
      'Bu uç nokta artık kullanımda değil. Yeni akış: önce hesabını aç, sonra salonunu uygulamadan oluştur.',
    nextSteps: {
      register: 'POST /api/auth/onboarding/start',
      createSalon: 'POST /api/salons',
      mobile: 'https://kedyapp.com (App Store / Google Play)',
    },
  });
}

router.post('/', (_req: any, res: any) => gone(res));
router.get('/:token/preview', (_req: any, res: any) => gone(res));
router.post('/:token/activate', (_req: any, res: any) => gone(res));

export default router;
