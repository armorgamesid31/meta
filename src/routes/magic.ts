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
    // Find and validate magic link
    const magicLink = await prisma.magicLink.findUnique({
      where: { token }
    });

    if (!magicLink) {
      return res.status(404).json({ message: 'Magic link not found' });
    }

    if (magicLink.expiresAt < new Date()) {
      return res.status(410).json({ message: 'Magic link has expired' });
    }

    if (magicLink.usedAt) {
      return res.status(410).json({ message: 'Magic link has already been used' });
    }

    // Auto-create customer if not exists
    const salonId = (magicLink.context as any)?.salonId || 481; // Use the salon from context or default to our test salon

    let customer = await prisma.customer.findFirst({
      where: {
        phone: magicLink.phone,
        salonId: salonId
      }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          phone: magicLink.phone,
          name: `Customer ${magicLink.phone}`, // Placeholder name
          salonId: salonId
        }
      });
    }

    // Prepare response based on type
    const response: any = {
      type: magicLink.type,
      expiresAt: magicLink.expiresAt.toISOString()
    };

    // Add type-specific data
    switch (magicLink.type) {
      case 'BOOKING':
        // For booking, return salon info with theme
        const salon = await prisma.salon.findUnique({
          where: { id: (magicLink.context as any)?.salonId || 481 },
          select: {
            id: true,
            name: true,
            bookingTheme: true
          }
        });

        if (salon) {
          response.salon = {
            id: salon.id,
            name: salon.name,
            theme: salon.bookingTheme || {
              primaryColor: '#10b981',
              secondaryColor: '#064e3b'
            }
          };
        }

        // Return customer info (name may be null)
        response.customer = {
          phone: magicLink.phone,
          name: customer.name
        };
        break;

      case 'CANCEL':
      case 'RESCHEDULE':
        // For cancel/reschedule, return appointment details
        if (magicLink.context && (magicLink.context as any).appointmentId) {
          const appointment = await prisma.appointment.findUnique({
            where: { id: (magicLink.context as any).appointmentId },
            include: {
              service: true,
              staff: {
                select: {
                  id: true,
                  name: true
                }
              },
              salon: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          });

          if (appointment) {
            response.appointment = {
              id: appointment.id,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              status: appointment.status,
              service: appointment.service,
              staff: appointment.staff,
              salon: appointment.salon
            };
          }
        }
        break;
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