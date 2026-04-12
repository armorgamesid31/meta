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
  const body = req.body || {};
  
  // Accept 'generated' at root or as a nested property
  const generated = body.generated || (body.heroText ? body : null);

  console.log(`[Internal/WebsiteCallback] Received callback for Salon ID: ${req.params.salonId} (parsed: ${salonId})`);
  console.log(`[Internal/WebsiteCallback] Body keys:`, Object.keys(body));

  if (Number.isNaN(salonId) || !generated || !generated.heroText) {
    console.warn(`[Internal/WebsiteCallback] Bad request: salonId=${salonId}, hasGenerated=${!!generated}, hasHeroText=${!!(generated?.heroText)}`);
    return res.status(400).json({ 
      message: 'salonId and generated content (including heroText) are required.',
      receivedBodyKeys: Object.keys(body)
    });
  }

  try {
    await prisma.salon.update({
      where: { id: salonId },
      data: {
        heroText: generated.heroText || undefined,
        tagline: generated.tagline || undefined,
        about: generated.description || generated.about || undefined,
      },
    });

    console.log(`[Internal/WebsiteCallback] Website content updated successfully for salon ${salonId}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Internal website generate callback error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
