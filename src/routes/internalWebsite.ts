import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.N8N_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;
  if (!configured) return true;
  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

router.post('/:salonId/generate-callback', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = Number(req.params.salonId);
  const { generated } = req.body;

  if (!salonId || !generated) {
    return res.status(400).json({ message: 'salonId and generated content are required.' });
  }

  try {
    await prisma.salon.update({
      where: { id: salonId },
      data: {
        heroText: generated.heroText || undefined,
        tagline: generated.tagline || undefined,
        about: generated.description || undefined,
      },
    });

    console.log(`[Internal] Website content updated via callback for salon ${salonId}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Internal website generate callback error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
