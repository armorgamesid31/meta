import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  buildBootstrapUser,
  buildCapabilities,
  buildFeatureFlags,
  buildSubscription,
} from '../services/mobileBootstrap.js';

const router = Router();

router.get('/bootstrap', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    const user = await prisma.salonUser.findUnique({
      where: { id: req.user.userId },
      include: {
        salon: {
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            countryCode: true,
            bookingMode: true,
            whatsappPhone: true,
          },
        },
      },
    });

    if (!user || !user.salon || user.salon.id !== req.user.salonId) {
      return res.status(404).json({ message: 'User or salon not found.' });
    }

    const normalizedWhatsapp = (user.salon.whatsappPhone || '').replace(/[^\d]/g, '');

    const payload = {
      user: buildBootstrapUser(user),
      salon: {
        id: user.salon.id,
        name: user.salon.name,
        slug: user.salon.slug,
        city: user.salon.city,
        country: user.salon.countryCode,
      },
      capabilities: buildCapabilities(user.role),
      featureFlags: buildFeatureFlags(user.role, user.salon.bookingMode, Boolean(normalizedWhatsapp)),
      subscription: buildSubscription(),
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Mobile bootstrap error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
