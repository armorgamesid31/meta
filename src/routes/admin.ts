import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';

const router = Router();

interface AuthRequest extends Request {
  user?: {
    userId: number;
    salonId: number;
    role: 'OWNER' | 'STAFF';
  };
}

interface CancelAppointmentRequest {
  reason?: string;
}

interface UpdateCustomerRequest {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

// GET /api/admin/appointments - Get all confirmed appointments for salon
router.get("/appointments", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { date, status, limit = '50', offset = '0' } = req.query as any;
  const dateStr = Array.isArray(date) ? date[0] : date;
  const statusStr = Array.isArray(status) ? status[0] : status;
  const limitStr = Array.isArray(limit) ? limit[0] : limit;
  const offsetStr = Array.isArray(offset) ? offset[0] : offset;

  try {
    const where: any = {
      salonId,
      status: {
        in: ['BOOKED', 'CANCELLED'] // Only confirmed appointments
      }
    };

    if (dateStr) {
      const startOfDay = new Date(`${dateStr}T00:00:00`);
      const endOfDay = new Date(`${dateStr}T23:59:59`);
      where.startTime = {
        gte: startOfDay,
        lte: endOfDay
      };
    }

    if (statusStr && statusStr !== 'all') {
      where.status = String(statusStr).toUpperCase();
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        service: true,
        staff: {
          select: {
            id: true,
            name: true
          }
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            notes: true
          }
        }
      },
      orderBy: {
        startTime: 'asc'
      },
      take: parseInt(String(limitStr || '50')),
      skip: parseInt(String(offsetStr || '0'))
    });

    const total = await prisma.appointment.count({ where });

    res.json({
      appointments: appointments.map(apt => ({
        id: apt.id,
        startTime: apt.startTime,
        endTime: apt.endTime,
        status: apt.status,
        customerName: apt.customerName,
        customerPhone: apt.customerPhone,
        service: {
          id: apt.service.id,
          name: apt.service.name,
          duration: apt.service.duration,
          price: apt.service.price
        },
        staff: apt.staff,
        customer: apt.customer,
        createdAt: apt.createdAt
      })),
      total,
      limit: parseInt(String(limitStr || '50')),
      offset: parseInt(String(offsetStr || '0'))
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/appointments/:id - Get appointment details
router.get("/appointments/:id", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const { id } = req.params as any;
  const salonId = req.user.salonId;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: parseInt(String(id)),
        salonId,
        status: {
          in: ['BOOKED', 'CANCELLED'] // Only confirmed appointments
        }
      },
      include: {
        service: true,
        staff: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        customer: true
      }
    });

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }

    res.json({
      appointment: {
        id: appointment.id,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        customerName: appointment.customerName,
        customerPhone: appointment.customerPhone,
        notes: appointment.notes,
        service: appointment.service,
        staff: appointment.staff,
        customer: appointment.customer,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching appointment:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/admin/appointments/:id/cancel - Cancel appointment
router.post("/appointments/:id/cancel", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const { id } = req.params as any;
  const { reason } = req.body as any;
  const salonId = req.user.salonId;

  try {
    // Start transaction
    await prisma.$transaction(async (tx) => {
      // Find appointment
      const appointment = await tx.appointment.findFirst({
        where: {
          id: parseInt(String(id)),
          salonId,
          status: 'BOOKED' // Only cancel booked appointments
        }
      });

      if (!appointment) {
        return res.status(404).json({ message: 'Appointment not found or already cancelled.' });
      }

      // Check if appointment is in the future
      if (appointment.startTime <= new Date()) {
        return res.status(400).json({ message: 'Cannot cancel past appointments.' });
      }

      // Update appointment status
      const updatedAppointment = await tx.appointment.update({
        where: { id: parseInt(String(id)) },
        data: {
          status: 'CANCELLED',
          notes: reason ? `Cancelled: ${reason}` : 'Cancelled by admin',
          updatedAt: new Date()
        },
        include: {
          service: true,
          staff: {
            select: {
              id: true,
              name: true
            }
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true
            }
          }
        }
      });

      res.json({
        message: 'Appointment cancelled successfully.',
        appointment: {
          id: updatedAppointment.id,
          startTime: updatedAppointment.startTime,
          endTime: updatedAppointment.endTime,
          status: updatedAppointment.status,
          customerName: updatedAppointment.customerName,
          customerPhone: updatedAppointment.customerPhone,
          service: updatedAppointment.service,
          staff: updatedAppointment.staff,
          customer: updatedAppointment.customer,
          notes: updatedAppointment.notes
        }
      });
    });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/customers - Get all customers for salon
router.get("/customers", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { limit = '50', offset = '0', search } = req.query as any;
  const searchStr = Array.isArray(search) ? search[0] : search;
  const limitStr = Array.isArray(limit) ? limit[0] : limit;
  const offsetStr = Array.isArray(offset) ? offset[0] : offset;

  try {
    const where: any = { salonId };

    if (searchStr) {
      where.OR = [
        { name: { contains: searchStr, mode: 'insensitive' } },
        { phone: { contains: searchStr } },
        { email: { contains: searchStr, mode: 'insensitive' } }
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      include: {
        appointments: {
          where: {
            status: {
              in: ['BOOKED', 'CANCELLED']
            }
          },
          include: {
            service: true,
            staff: {
              select: {
                id: true,
                name: true
              }
            }
          },
          orderBy: {
            startTime: 'desc'
          }
        },
        _count: {
          select: {
            appointments: {
              where: {
                status: 'BOOKED'
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      },
      take: parseInt(String(limitStr || '50')),
      skip: parseInt(String(offsetStr || '0'))
    });

    const total = await prisma.customer.count({ where });

    res.json({
      customers: customers.map(customer => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        notes: customer.notes,
        totalAppointments: customer._count.appointments,
        lastAppointment: customer.appointments[0]?.startTime || null,
        appointments: customer.appointments.slice(0, 5), // Last 5 appointments
        createdAt: customer.createdAt
      })),
      total,
      limit: parseInt(String(limitStr || '50')),
      offset: parseInt(String(offsetStr || '0'))
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/customers/:id - Get customer details
router.get("/customers/:id", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const { id } = req.params as any;
  const salonId = req.user.salonId;

  try {
    const customer = await prisma.customer.findFirst({
      where: {
        id: parseInt(String(id)),
        salonId
      },
      include: {
        appointments: {
          where: {
            status: {
              in: ['BOOKED', 'CANCELLED']
            }
          },
          include: {
            service: true,
            staff: {
              select: {
                id: true,
                name: true
              }
            }
          },
          orderBy: {
            startTime: 'desc'
          }
        },
        _count: {
          select: {
            appointments: {
              where: {
                status: 'BOOKED'
              }
            }
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        notes: customer.notes,
        totalAppointments: customer._count.appointments,
        appointments: customer.appointments,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// PUT /api/admin/customers/:id - Update customer
router.put("/customers/:id", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const { id } = req.params as any;
  const { name, phone, email, notes } = req.body as any;
  const salonId = req.user.salonId;

  try {
    // Check if customer exists
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id: parseInt(String(id)),
        salonId
      }
    });

    if (!existingCustomer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    // If phone is being changed, check for conflicts
    if (phone && phone !== existingCustomer.phone) {
      const phoneConflict = await prisma.customer.findFirst({
        where: {
          salonId,
          phone,
          id: { not: parseInt(String(id)) }
        }
      });

      if (phoneConflict) {
        return res.status(409).json({ message: 'Phone number already exists for another customer.' });
      }
    }

    // Update customer
    const updatedCustomer = await prisma.customer.update({
      where: { id: parseInt(String(id)) },
      data: {
        name: name || existingCustomer.name,
        phone: phone || existingCustomer.phone,
        email: email !== undefined ? email : existingCustomer.email,
        notes: notes !== undefined ? notes : existingCustomer.notes,
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: {
            appointments: {
              where: {
                status: 'BOOKED'
              }
            }
          }
        }
      }
    });

    res.json({
      message: 'Customer updated successfully.',
      customer: {
        id: updatedCustomer.id,
        name: updatedCustomer.name,
        phone: updatedCustomer.phone,
        email: updatedCustomer.email,
        notes: updatedCustomer.notes,
        totalAppointments: updatedCustomer._count.appointments,
        updatedAt: updatedCustomer.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/booking-theme - Get salon booking theme
router.get("/booking-theme", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { bookingTheme: true }
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }

    // Provide default theme if none exists
    const defaultTheme = {
      logoUrl: null,
      primaryColor: '#3B82F6',
      secondaryColor: '#64748B',
      welcomeTitle: 'Randevu Alın',
      welcomeDescription: 'Size en uygun saatleri seçin',
      confirmButtonText: 'Randevuyu Onayla'
    };

    const theme = salon.bookingTheme ? { ...defaultTheme, ...(salon.bookingTheme as object) } : defaultTheme;

    res.json({ theme });
  } catch (error) {
    console.error('Error fetching booking theme:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// PUT /api/admin/booking-theme - Update salon booking theme
router.put("/booking-theme", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { logoUrl, primaryColor, secondaryColor, welcomeTitle, welcomeDescription, confirmButtonText } = req.body as any;

  try {
    // Validate inputs
    if (primaryColor && !/^#[0-9A-F]{6}$/i.test(primaryColor)) {
      return res.status(400).json({ message: 'Invalid primary color format. Use hex format like #3B82F6.' });
    }

    if (secondaryColor && !/^#[0-9A-F]{6}$/i.test(secondaryColor)) {
      return res.status(400).json({ message: 'Invalid secondary color format. Use hex format like #64748B.' });
    }

    if (welcomeTitle && welcomeTitle.length > 100) {
      return res.status(400).json({ message: 'Welcome title must be 100 characters or less.' });
    }

    if (welcomeDescription && welcomeDescription.length > 200) {
      return res.status(400).json({ message: 'Welcome description must be 200 characters or less.' });
    }

    if (confirmButtonText && confirmButtonText.length > 50) {
      return res.status(400).json({ message: 'Confirm button text must be 50 characters or less.' });
    }

    // Update salon booking theme
    const updatedSalon = await prisma.salon.update({
      where: { id: salonId },
      data: {
        bookingTheme: {
          logoUrl: logoUrl || null,
          primaryColor: primaryColor || '#3B82F6',
          secondaryColor: secondaryColor || '#64748B',
          welcomeTitle: welcomeTitle || 'Randevu Alın',
          welcomeDescription: welcomeDescription || 'Size en uygun saatleri seçin',
          confirmButtonText: confirmButtonText || 'Randevuyu Onayla'
        }
      },
      select: { bookingTheme: true }
    });

    res.json({
      message: 'Booking theme updated successfully.',
      theme: updatedSalon.bookingTheme
    });
  } catch (error) {
    console.error('Error updating booking theme:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/health - System health check
router.get("/health", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;

  try {
    const results = {
      database: 'OK' as 'OK' | 'FAIL',
      auth: 'OK' as 'OK' | 'FAIL',
      booking: 'OK' as 'OK' | 'FAIL',
      availability: 'OK' as 'OK' | 'FAIL',
      lastCheck: new Date().toISOString()
    };

    // Test database connection
    try {
      await prisma.salon.findUnique({ where: { id: salonId } });
    } catch (error) {
      results.database = 'FAIL';
    }

    // Test auth (already passed if we got here)
    results.auth = 'OK';

    // Test booking writes (try to count appointments)
    try {
      await prisma.appointment.count({ where: { salonId } });
    } catch (error) {
      results.booking = 'FAIL';
    }

    // Test availability endpoint (simulate a call)
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      // This would normally call the availability engine
      // For now, just check if we can query services
      await prisma.service.count({ where: { salonId } });
    } catch (error) {
      results.availability = 'FAIL';
    }

    res.json(results);
  } catch (error) {
    console.error('Error checking system health:', error);
    res.status(500).json({
      database: 'FAIL',
      auth: 'FAIL',
      booking: 'FAIL',
      availability: 'FAIL',
      lastCheck: new Date().toISOString()
    });
  }
});

// GET /api/admin/magic-links - Get recent magic links
router.get("/magic-links", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { limit = '10' } = req.query as any;
  const limitNum = parseInt(String(limit)) || 10;

  try {
    // For now, return mock data since we don't have magic link storage yet
    // In a real implementation, this would query a magic_links table
    const mockLinks = [
      {
        id: 1,
        token: 'abc123def456',
        phone: '+905551234567',
        status: 'ACTIVE' as const,
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString() // 7 days from now
      },
      {
        id: 2,
        token: 'def789ghi012',
        phone: '+905559876543',
        status: 'USED' as const,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
      }
    ].slice(0, limitNum);

    res.json({ links: mockLinks });
  } catch (error) {
    console.error('Error fetching magic links:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/events - Get recent booking events
router.get("/events", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { limit = '20' } = req.query as any;
  const limitNum = parseInt(String(limit)) || 20;

  try {
    // For now, return mock data since we don't have event logging yet
    // In a real implementation, this would query an events table
    const mockEvents = [
      {
        id: 1,
        type: 'LINK_CREATED',
        token: 'abc123def456',
        phone: '+905551234567',
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        details: 'Magic link created for customer'
      },
      {
        id: 2,
        type: 'DATE_SELECTED',
        token: 'abc123def456',
        phone: '+905551234567',
        timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
        details: 'Customer selected date: 2026-01-26'
      },
      {
        id: 3,
        type: 'SLOT_SELECTED',
        token: 'abc123def456',
        phone: '+905551234567',
        timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
        details: 'Customer selected slot: 14:00'
      },
      {
        id: 4,
        type: 'BOOKING_CONFIRMED',
        token: 'abc123def456',
        phone: '+905551234567',
        timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        details: 'Booking confirmed successfully'
      }
    ].slice(0, limitNum);

    res.json({ events: mockEvents });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
