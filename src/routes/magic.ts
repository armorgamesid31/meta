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
  const startTime = Date.now();

  // Wrap entire handler in try/catch for safety
  try {
    console.log(`[MAGIC_LINK] token=${token} outcome=START`);

    // 1. Validate token exists
    if (!token || typeof token !== 'string' || token.length === 0) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=INVALID_TOKEN_FORMAT`);
      return res.status(400).json({
        ok: false,
        errorCode: 'INVALID_TOKEN',
        message: 'Geçersiz bağlantı. Lütfen yeni bir bağlantı isteyin.'
      });
    }

    // 2. Find magic link in database
    const magicLink = await prisma.magicLink.findUnique({
      where: { token },
    });

    if (!magicLink) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=TOKEN_NOT_FOUND`);
      return res.status(400).json({
        ok: false,
        errorCode: 'TOKEN_NOT_FOUND',
        message: 'Bu bağlantı bulunamadı. Lütfen yeni bir bağlantı isteyin.'
      });
    }

    // 3. Check if token is expired
    if (magicLink.expiresAt < new Date()) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=TOKEN_EXPIRED`);
      return res.status(400).json({
        ok: false,
        errorCode: 'TOKEN_EXPIRED',
        message: 'Bu bağlantının süresi dolmuş. Lütfen yeni bir bağlantı isteyin.'
      });
    }

    // 4. Check if token was already used
    if (magicLink.usedAt) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=TOKEN_ALREADY_USED`);
      return res.status(400).json({
        ok: false,
        errorCode: 'TOKEN_USED',
        message: 'Bu bağlantı daha önce kullanılmış. Her bağlantı sadece bir kez kullanılabilir.'
      });
    }

    // 5. Validate salon exists
    const salonId = (magicLink.context as any)?.salonId;
    console.log(`[MAGIC_LINK] token=${token} salonId from context=${salonId}`);

    if (!salonId || typeof salonId !== 'number') {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=INVALID_SALON_CONTEXT`);
      return res.status(400).json({
        ok: false,
        errorCode: 'INVALID_SALON',
        message: 'Salon bilgisi bulunamadı. Lütfen salon sahibi ile iletişime geçin.'
      });
    }

    const host = req.headers.host || '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

    let salon;

    if (isLocalhost) {
      // Localhost: get salon by salonId from token context
      salon = await prisma.salon.findUnique({
        where: { id: salonId },
        select: {
          id: true,
          name: true,
          address: true,
          bookingTheme: true
        }
      });
    } else {
      // Production: get salon from subdomain and validate it matches token salonId
      const slug = host.split('.')[0];
      salon = await prisma.salon.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          address: true,
          bookingTheme: true
        }
      });

      if (!salon || salon.id !== salonId) {
        console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=SALON_MISMATCH`);
        return res.status(400).json({
          ok: false,
          errorCode: 'SALON_MISMATCH',
          message: 'Salon bilgisi eşleşmiyor. Lütfen doğru adresten erişin.'
        });
      }
    }

    if (!salon) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=SALON_NOT_FOUND`);
      return res.status(400).json({
        ok: false,
        errorCode: 'SALON_NOT_FOUND',
        message: 'Salon bulunamadı. Lütfen salon sahibi ile iletişime geçin.'
      });
    }

    // 6. Check salon onboarding completion
    const salonSettings = await prisma.salonSettings.findUnique({
      where: { salonId: salon.id }
    });

    const hasWorkingHours = salonSettings?.workStartHour !== undefined && salonSettings?.workEndHour !== undefined;

    if (!hasWorkingHours) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=SALON_NO_WORKING_HOURS`);
      return res.status(400).json({
        ok: false,
        errorCode: 'SALON_NOT_READY',
        message: 'Bu salonun çalışma saatleri ayarlanmamış. Lütfen salon sahibi ile iletişime geçin.'
      });
    }

    // 7. Check salon has services
    const salonServices = await prisma.service.count({
      where: { salonId: salon.id }
    });

    if (salonServices === 0) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=SALON_NO_SERVICES`);
      return res.status(400).json({
        ok: false,
        errorCode: 'SALON_NO_SERVICES',
        message: 'Bu salonda henüz hiç hizmet tanımlanmamış. Lütfen salon sahibi ile iletişime geçin.'
      });
    }

    // 8. Check salon has staff
    const salonStaff = await prisma.staff.count({
      where: { salonId: salon.id }
    });

    if (salonStaff === 0) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=SALON_NO_STAFF`);
      return res.status(400).json({
        ok: false,
        errorCode: 'SALON_NO_STAFF',
        message: 'Bu salonda henüz hiç personel eklenmemiş. Lütfen salon sahibi ile iletişime geçin.'
      });
    }

    // 9. Validate slot generation won't return empty (basic sanity check)
    const now = new Date();
    const testDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
    const testDateStr = testDate.toISOString().split('T')[0];

    // This is a basic check - in production we'd call the actual availability engine
    const workStartHour = salonSettings.workStartHour;
    const workEndHour = salonSettings.workEndHour;

    if (workStartHour >= workEndHour) {
      console.log(`[MAGIC_LINK] token=${token} outcome=FAILURE reason=INVALID_WORKING_HOURS`);
      return res.status(400).json({
        ok: false,
        errorCode: 'INVALID_WORKING_HOURS',
        message: 'Salon çalışma saatleri geçersiz. Lütfen salon sahibi ile iletişime geçin.'
      });
    }

    // Check if customer exists (don't auto-create yet)
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        phone: magicLink.phone,
        salonId: salon.id
      }
    });

    // Determine customer type based on existence
    const isReturningCustomer = !!existingCustomer;

    // Prepare successful response
    const response: any = {
      ok: true,
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
        name: existingCustomer?.name || null,
        isReturningCustomer
      }
    };

    // Add reschedule context if applicable
    if (magicLink.type === 'RESCHEDULE' && magicLink.context) {
      response.rescheduleAppointmentId = (magicLink.context as any).appointmentId;
    }

    const duration = Date.now() - startTime;
    console.log(`[MAGIC_LINK] token=${token} outcome=SUCCESS duration=${duration}ms`);

    res.json(response);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MAGIC_LINK] token=${token} outcome=ERROR duration=${duration}ms`, error);
    return res.status(500).json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      message: 'Bir teknik hata oluştu. Lütfen daha sonra tekrar deneyin.'
    });
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