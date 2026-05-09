import { Router } from 'express';
import { checkSlugAvailability } from '../services/slugService.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

router.get('/slugs/check', async (req: any, res: any) => {
  const slug = String(req.query?.slug || '').trim();
  if (!slug) {
    throw new BusinessError('VALIDATION_FAILED', 'slug is required.', 400);
  }
  const result = await checkSlugAvailability(slug);
  return res.status(200).json(result);
});

export default router;

