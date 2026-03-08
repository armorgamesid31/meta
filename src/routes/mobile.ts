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
            address: true,
          },
        },
      },
    });

    if (!user || !user.salon || user.salon.id !== req.user.salonId) {
      return res.status(404).json({ message: 'User or salon not found.' });
    }

    const normalizedWhatsapp = (user.salon.whatsappPhone || '').replace(/[^\d]/g, '');

    const [settings, serviceCount, staffCount] = await prisma.$transaction([
      prisma.salonSettings.findUnique({
        where: { salonId: user.salon.id },
        select: {
          workStartHour: true,
          workEndHour: true,
          slotInterval: true,
          workingDays: true,
        },
      }),
      prisma.service.count({ where: { salonId: user.salon.id } }),
      prisma.staff.count({ where: { salonId: user.salon.id } }),
    ]);

    const setupChecklist = {
      workingHours:
        typeof settings?.workStartHour === 'number' && typeof settings?.workEndHour === 'number',
      address: Boolean((user.salon.address || '').trim()),
      phone: Boolean(normalizedWhatsapp),
      service: serviceCount > 0,
      staff: staffCount > 0,
    };

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
      setupChecklist: {
        ...setupChecklist,
        completed: Object.values(setupChecklist).every(Boolean),
      },
      setup: {
        workStartHour: settings?.workStartHour ?? null,
        workEndHour: settings?.workEndHour ?? null,
        slotInterval: settings?.slotInterval ?? null,
        workingDays: settings?.workingDays ?? null,
      },
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Mobile bootstrap error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
