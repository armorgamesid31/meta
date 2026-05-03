import { Router } from 'express';
import { checkSlugAvailability } from '../services/slugService.js';

const router = Router();

router.get('/slugs/check', async (req: any, res: any) => {
  const slug = String(req.query?.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ message: 'slug is required.' });
  }
  const result = await checkSlugAvailability(slug);
  return res.status(200).json(result);
});

export default router;

