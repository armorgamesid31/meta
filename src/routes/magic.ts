import { Router } from 'express';
import { prisma } from '../prisma.js';
import { randomBytes } from 'crypto';

const router = Router();

// POST /magic-link/create - Create a magic link for customer actions
router.post('/create', async (req: any, res: any) => {
  const { phone, type, context, salonId } = req.body as any;

  if (!phone || !type || !salonId) {
    return res.status(400).json({ message: 'Phone, type, and salonId are required' });
  }

  // Validate type
  const validTypes = ['BOOKING', 'CANCEL', 'RESCHEDULE'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ message: 'Invalid type. Must be BOOKING, CANCEL, or RESCHEDULE' });
  }

  // Validate context based on type
  if (type === 'CANCEL' || type === 'RESCHEDULE') {
    if (!context || !context.appointmentId) {
      return res.status(400).json({ message: 'appointmentId is required in context for CANCEL/RESCHEDULE' });
    }
  }

  try {
    // Verify salon exists
    const salon = await prisma.salon.findUnique({
      where: { id: salonId }
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    // For CANCEL/RESCHEDULE, verify appointment exists and belongs to customer
    if (type === 'CANCEL' || type === 'RESCHEDULE') {
      const appointment = await prisma.appointment.findFirst({
        where: {
          id: context.appointmentId,
          customerPhone: phone,
          salonId,
          status: 'BOOKED'
        }
      });

      if (!appointment) {
        return res.status(404).json({ message: 'Appointment not found or does not belong to this customer' });
      }
    }

    // Generate secure token
    const token = randomBytes(32).toString('hex');

    // Set expiration based on type
    const expiresAt = new Date();
    switch (type) {
      case 'BOOKING':
        expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours for booking
        break;
      case 'CANCEL':
        expiresAt.setHours(expiresAt.getHours() + 2); // 2 hours for cancel
        break;
      case 'RESCHEDULE':
        expiresAt.setHours(expiresAt.getHours() + 2); // 2 hours for reschedule
        break;
    }

    // Create magic link
    const magicLink = await prisma.magicLink.create({
      data: {
        token,
        phone,
        type: type as any,
        context,
        expiresAt
      }
    });

    // Generate magic link URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const magicUrl = `${baseUrl}/m/${token}`;

    res.status(201).json({
      magicUrl,
      token,
      expiresAt: magicLink.expiresAt,
      type: magicLink.type
    });

  } catch (error) {
    console.error('Error creating magic link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /m/:token - Resolve magic link and return action data
router.get('/:token', async (req: any, res: any) => {
  const { token } = req.params as any;

  if (!token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  try {
    // Extract salon slug from subdomain
    const host = req.headers.host || '';
    const salonSlug = host.split('.')[0]; // e.g., "mysalon" from "mysalon.salonasistan.com"

    if (!salonSlug || salonSlug === 'salonasistan' || salonSlug === 'localhost:3000') {
      return res.status(400).json({ message: 'Invalid salon subdomain' });
    }

    // Find salon by slug
    const salon = await prisma.salon.findUnique({
      where: { slug: salonSlug },
      select: {
        id: true,
        name: true,
        address: true,
        bookingTheme: true
      }
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    // Find and validate magic link
    const magicLink = await prisma.magicLink.findUnique({
      where: { token }
    });

    if (!magicLink) {
      return res.status(404).json({ message: 'Magic link not found' });
    }

    // Validate token belongs to this salon
    const tokenSalonId = (magicLink.context as any)?.salonId;
    if (tokenSalonId !== salon.id) {
      return res.status(403).json({ message: 'Token does not belong to this salon' });
    }

    // Check token state
    if (magicLink.usedAt) {
      return res.status(410).json({
        status: 'USED',
        message: 'Bu randevu bağlantısı daha önce kullanılmış.',
        salon: {
          name: salon.name,
          address: salon.address
        }
      });
    }

    if (magicLink.expiresAt < new Date()) {
      return res.status(410).json({
        status: 'EXPIRED',
        message: 'Bu randevu bağlantısının süresi dolmuş.',
        salon: {
          name: salon.name,
          address: salon.address,
          phone: '0555-123-4567' // This should come from salon settings
        }
      });
    }

    // Auto-create customer if not exists
    let customer = await prisma.customer.findFirst({
      where: {
        phone: magicLink.phone,
        salonId: salon.id
      }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          phone: magicLink.phone,
          name: `Customer ${magicLink.phone}`, // Placeholder name
          salonId: salon.id
        }
      });
    }

    // Prepare response based on type
    const response: any = {
      type: magicLink.type,
      expiresAt: magicLink.expiresAt.toISOString(),
      salon: {
        id: salon.id,
        name: salon.name,
        address: salon.address,
        theme: salon.bookingTheme || {
          primaryColor: '#10b981',
          secondaryColor: '#064e3b'
        }
      },
      customer: {
        phone: magicLink.phone,
        name: customer.name
      }
    };

    // Add reschedule context if applicable
    if (magicLink.type === 'RESCHEDULE' && magicLink.context) {
      response.rescheduleAppointmentId = (magicLink.context as any).appointmentId;
    }

    res.json(response);

  } catch (error) {
    console.error('Error resolving magic link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /m/:token/complete - Mark magic link as used (called after successful action)
router.post('/:token/complete', async (req: any, res: any) => {
  const { token } = req.params as any;

  if (!token) {
    return res.status(400).json({ message: 'Token is required' });
  }

  try {
    // Mark link as used
    const updatedLink = await prisma.magicLink.update({
      where: { token },
      data: {
        usedAt: new Date()
      }
    });

    res.json({
      message: 'Magic link marked as used',
      usedAt: updatedLink.usedAt
    });

  } catch (error) {
    console.error('Error completing magic link:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;