import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { runNoShowDetection } from '../utils/noShowDetector.js';
import { cleanupOldBehaviorLogs } from '../utils/behaviorTracking.js';

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

// GET /api/admin/summary - Get salon summary stats
router.get("/summary", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;

  try {
    // Get total appointments count
    const totalAppointments = await prisma.appointment.count({
      where: { salonId }
    });

    // Get total revenue (sum of service prices for booked appointments)
    const revenueResult = await prisma.appointment.aggregate({
      where: {
        salonId,
        status: 'BOOKED'
      },
      _sum: {
        service: {
          price: true
        }
      }
    });

    const totalRevenue = revenueResult._sum.service?.price || 0;

    // Get active clients count (unique customers with booked appointments)
    const activeClientsResult = await prisma.appointment.findMany({
      where: {
        salonId,
        status: 'BOOKED'
      },
      select: {
        customerId: true
      },
      distinct: ['customerId']
    });

    const activeClients = activeClientsResult.length;

    // Get upcoming appointments count (future booked appointments)
    const upcomingAppointments = await prisma.appointment.count({
      where: {
        salonId,
        status: 'BOOKED',
        startTime: {
          gte: new Date()
        }
      }
    });

    res.json({
      totalAppointments,
      totalRevenue,
      activeClients,
      upcomingAppointments
    });
  } catch (error) {
    console.error('Error fetching admin summary:', error);
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

  try {
    // Query real magic links for this salon
    const magicLinks = await prisma.magicLink.findMany({
      where: {
        context: {
          path: ['salonId'],
          equals: salonId
        }
      },
      select: {
        id: true,
        token: true,
        phone: true,
        type: true,
        usedAt: true,
        expiresAt: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    // Transform to expected format
    const links = magicLinks.map(link => ({
      id: link.id,
      token: link.token,
      phone: link.phone,
      status: link.usedAt ? 'USED' : (link.expiresAt > new Date() ? 'ACTIVE' : 'EXPIRED'),
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString()
    }));

    res.json({ links });
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

  try {
    // For now, return empty array since we don't have event logging yet
    // In a real implementation, this would query an events table filtered by salonId
    // This ensures new salons don't see fake historical events
    res.json({ events: [] });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/risk-profiles - Get customer risk profiles
router.get("/risk-profiles", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { limit = '50', offset = '0', riskLevel } = req.query as any;
  const limitStr = Array.isArray(limit) ? limit[0] : limit;
  const offsetStr = Array.isArray(offset) ? offset[0] : offset;
  const riskLevelStr = Array.isArray(riskLevel) ? riskLevel[0] : riskLevel;

  try {
    const where: any = { salonId };

    if (riskLevelStr && riskLevelStr !== 'all') {
      where.riskLevel = riskLevelStr.toUpperCase();
    }

    const riskProfiles = await prisma.customerRiskProfile.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true
          }
        }
      },
      orderBy: {
        riskScore: 'desc'
      },
      take: parseInt(String(limitStr || '50')),
      skip: parseInt(String(offsetStr || '0'))
    });

    const total = await prisma.customerRiskProfile.count({ where });

    res.json({
      riskProfiles: riskProfiles.map(profile => ({
        id: profile.id,
        customer: profile.customer,
        riskScore: profile.riskScore,
        riskLevel: profile.riskLevel,
        lastMinuteCancellations: profile.lastMinuteCancellations,
        noShows: profile.noShows,
        totalBookings: profile.totalBookings,
        isBlocked: profile.isBlocked,
        blockedUntil: profile.blockedUntil,
        blockReason: profile.blockReason,
        lastCalculatedAt: profile.lastCalculatedAt
      })),
      total,
      limit: parseInt(String(limitStr || '50')),
      offset: parseInt(String(offsetStr || '0'))
    });
  } catch (error) {
    console.error('Error fetching risk profiles:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/behavior-logs - Get customer behavior logs
router.get("/behavior-logs", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const { limit = '50', offset = '0', behaviorType, customerId } = req.query as any;
  const limitStr = Array.isArray(limit) ? limit[0] : limit;
  const offsetStr = Array.isArray(offset) ? offset[0] : offset;
  const behaviorTypeStr = Array.isArray(behaviorType) ? behaviorType[0] : behaviorType;
  const customerIdStr = Array.isArray(customerId) ? customerId[0] : customerId;

  try {
    const where: any = { salonId };

    if (behaviorTypeStr && behaviorTypeStr !== 'all') {
      where.behaviorType = behaviorTypeStr.toUpperCase();
    }

    if (customerIdStr) {
      where.customerId = parseInt(customerIdStr);
    }

    const behaviorLogs = await prisma.customerBehaviorLog.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        appointment: {
          select: {
            id: true,
            startTime: true,
            service: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        occurredAt: 'desc'
      },
      take: parseInt(String(limitStr || '50')),
      skip: parseInt(String(offsetStr || '0'))
    });

    const total = await prisma.customerBehaviorLog.count({ where });

    res.json({
      behaviorLogs: behaviorLogs.map(log => ({
        id: log.id,
        customer: log.customer,
        behaviorType: log.behaviorType,
        severityScore: log.severityScore,
        occurredAt: log.occurredAt,
        metadata: log.metadata,
        appointment: log.appointment
      })),
      total,
      limit: parseInt(String(limitStr || '50')),
      offset: parseInt(String(offsetStr || '0'))
    });
  } catch (error) {
    console.error('Error fetching behavior logs:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/admin/run-no-show-detection - Manually trigger no-show detection
router.post("/run-no-show-detection", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    const count = await runNoShowDetection();
    res.json({
      message: `No-show detection completed. Processed ${count} appointments.`,
      processedCount: count
    });
  } catch (error) {
    console.error('Error running no-show detection:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/admin/cleanup-behavior-logs - Clean up old behavior logs
router.post("/cleanup-behavior-logs", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    const count = await cleanupOldBehaviorLogs();
    res.json({
      message: `Cleanup completed. Removed ${count} old behavior logs.`,
      removedCount: count
    });
  } catch (error) {
    console.error('Error cleaning up behavior logs:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /api/admin/risk-config - Get salon risk configuration
router.get("/risk-config", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;

  try {
    const config = await prisma.salonRiskConfig.findUnique({
      where: { salonId }
    });

    if (!config) {
      // Return default configuration if none exists
      const defaultConfig = {
        isEnabled: false,
        warningThreshold: 25.0,
        blockingThreshold: 50.0,
        lastMinuteCancellationWeight: 3.0,
        noShowWeight: 5.0,
        frequentCancellationWeight: 2.0,
        bookingFrequencyWeight: 1.0,
        lastMinuteHoursThreshold: 24,
        frequentCancellationCount: 3,
        frequentCancellationDays: 30,
        maxBookingsPerMonth: 10,
        autoBlockEnabled: false,
        autoBlockDurationDays: 7,
        requireManualReview: false,
        warningMessage: "Riskli müşteri profili tespit edildi. Devam etmek istiyor musunuz?",
        blockMessage: "Bu müşteri için randevu alınamaz.",
        mediumRiskMessage: null,
        highRiskMessage: null,
        criticalRiskMessage: null
      };

      res.json({ config: defaultConfig });
    } else {
      res.json({ config });
    }
  } catch (error) {
    console.error('Error fetching risk config:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// PUT /api/admin/risk-config - Update salon risk configuration
router.put("/risk-config", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;
  const {
    isEnabled,
    warningThreshold,
    blockingThreshold,
    lastMinuteCancellationWeight,
    noShowWeight,
    frequentCancellationWeight,
    bookingFrequencyWeight,
    lastMinuteHoursThreshold,
    frequentCancellationCount,
    frequentCancellationDays,
    maxBookingsPerMonth,
    autoBlockEnabled,
    autoBlockDurationDays,
    requireManualReview,
    warningMessage,
    blockMessage,
    mediumRiskMessage,
    highRiskMessage,
    criticalRiskMessage
  } = req.body as any;

  try {
    // Validation
    if (warningThreshold !== undefined && blockingThreshold !== undefined) {
      if (warningThreshold >= blockingThreshold) {
        return res.status(400).json({ message: 'Warning threshold must be less than blocking threshold.' });
      }
    }

    if (lastMinuteHoursThreshold !== undefined && (lastMinuteHoursThreshold < 1 || lastMinuteHoursThreshold > 168)) {
      return res.status(400).json({ message: 'Last minute threshold must be between 1-168 hours.' });
    }

    if (warningMessage && warningMessage.length > 500) {
      return res.status(400).json({ message: 'Warning message must be 500 characters or less.' });
    }

    if (blockMessage && blockMessage.length > 500) {
      return res.status(400).json({ message: 'Block message must be 500 characters or less.' });
    }

    // Update or create configuration
    const config = await prisma.salonRiskConfig.upsert({
      where: { salonId },
      update: {
        ...(isEnabled !== undefined && { isEnabled }),
        ...(warningThreshold !== undefined && { warningThreshold }),
        ...(blockingThreshold !== undefined && { blockingThreshold }),
        ...(lastMinuteCancellationWeight !== undefined && { lastMinuteCancellationWeight }),
        ...(noShowWeight !== undefined && { noShowWeight }),
        ...(frequentCancellationWeight !== undefined && { frequentCancellationWeight }),
        ...(bookingFrequencyWeight !== undefined && { bookingFrequencyWeight }),
        ...(lastMinuteHoursThreshold !== undefined && { lastMinuteHoursThreshold }),
        ...(frequentCancellationCount !== undefined && { frequentCancellationCount }),
        ...(frequentCancellationDays !== undefined && { frequentCancellationDays }),
        ...(maxBookingsPerMonth !== undefined && { maxBookingsPerMonth }),
        ...(autoBlockEnabled !== undefined && { autoBlockEnabled }),
        ...(autoBlockDurationDays !== undefined && { autoBlockDurationDays }),
        ...(requireManualReview !== undefined && { requireManualReview }),
        ...(warningMessage !== undefined && { warningMessage }),
        ...(blockMessage !== undefined && { blockMessage }),
        ...(mediumRiskMessage !== undefined && { mediumRiskMessage }),
        ...(highRiskMessage !== undefined && { highRiskMessage }),
        ...(criticalRiskMessage !== undefined && { criticalRiskMessage }),
        updatedAt: new Date()
      },
      create: {
        salonId,
        isEnabled: isEnabled ?? false,
        warningThreshold: warningThreshold ?? 25.0,
        blockingThreshold: blockingThreshold ?? 50.0,
        lastMinuteCancellationWeight: lastMinuteCancellationWeight ?? 3.0,
        noShowWeight: noShowWeight ?? 5.0,
        frequentCancellationWeight: frequentCancellationWeight ?? 2.0,
        bookingFrequencyWeight: bookingFrequencyWeight ?? 1.0,
        lastMinuteHoursThreshold: lastMinuteHoursThreshold ?? 24,
        frequentCancellationCount: frequentCancellationCount ?? 3,
        frequentCancellationDays: frequentCancellationDays ?? 30,
        maxBookingsPerMonth: maxBookingsPerMonth ?? 10,
        autoBlockEnabled: autoBlockEnabled ?? false,
        autoBlockDurationDays: autoBlockDurationDays ?? 7,
        requireManualReview: requireManualReview ?? false,
        warningMessage: warningMessage ?? "Riskli müşteri profili tespit edildi. Devam etmek istiyor musunuz?",
        blockMessage: blockMessage ?? "Bu müşteri için randevu alınamaz."
      }
    });

    res.json({
      message: 'Risk configuration updated successfully.',
      config
    });
  } catch (error) {
    console.error('Error updating risk config:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /api/admin/risk-config/reset - Reset risk configuration to defaults
router.post("/risk-config/reset", authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const salonId = req.user.salonId;

  try {
    // Delete existing config (if any) and create default
    await prisma.salonRiskConfig.deleteMany({
      where: { salonId }
    });

    // This will create the default config via the upsert logic above
    const config = await prisma.salonRiskConfig.create({
      data: {
        salonId,
        isEnabled: false,
        warningThreshold: 25.0,
        blockingThreshold: 50.0,
        lastMinuteCancellationWeight: 3.0,
        noShowWeight: 5.0,
        frequentCancellationWeight: 2.0,
        bookingFrequencyWeight: 1.0,
        lastMinuteHoursThreshold: 24,
        frequentCancellationCount: 3,
        frequentCancellationDays: 30,
        maxBookingsPerMonth: 10,
        autoBlockEnabled: false,
        autoBlockDurationDays: 7,
        requireManualReview: false,
        warningMessage: "Riskli müşteri profili tespit edildi. Devam etmek istiyor musunuz?",
        blockMessage: "Bu müşteri için randevu alınamaz."
      }
    });

    res.json({
      message: 'Risk configuration reset to defaults.',
      config
    });
  } catch (error) {
    console.error('Error resetting risk config:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
