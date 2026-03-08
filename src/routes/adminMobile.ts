import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

router.get('/appointments', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const from = parseIsoDate(req.query.from);
  const to = parseIsoDate(req.query.to);

  if (!from || !to) {
    return res.status(400).json({ message: 'from and to query params are required ISO dates.' });
  }

  if (from >= to) {
    return res.status(400).json({ message: 'from must be earlier than to.' });
  }

  const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
  const staffId = typeof req.query.staffId === 'string' ? Number(req.query.staffId) : null;
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 250;
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 250;

  try {
    const where: any = {
      salonId: req.user.salonId,
      startTime: { lt: to },
      endTime: { gt: from },
    };

    if (statusFilter) {
      where.status = statusFilter;
    }
    if (staffId && staffId > 0) {
      where.staffId = staffId;
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        service: {
          select: {
            id: true,
            name: true,
            duration: true,
            price: true,
            requiresSpecialist: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return res.status(200).json({
      from: from.toISOString(),
      to: to.toISOString(),
      items: appointments,
      count: appointments.length,
    });
  } catch (error) {
    console.error('Admin appointments window query error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  const cursorRaw = typeof req.query.cursor === 'string' ? Number(req.query.cursor) : null;
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

  if (cursorRaw !== null && (!Number.isInteger(cursorRaw) || cursorRaw <= 0)) {
    return res.status(400).json({ message: 'cursor must be a positive integer.' });
  }

  try {
    const where: any = { salonId: req.user.salonId };

    if (cursorRaw) {
      where.id = { lt: cursorRaw };
    }

    const rows = await prisma.customer.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        name: true,
        phone: true,
        gender: true,
        birthDate: true,
        acceptMarketing: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1]?.id || '') : null;

    return res.status(200).json({
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        gender: row.gender,
        birthDate: row.birthDate,
        acceptMarketing: row.acceptMarketing,
        appointmentCount: row._count.appointments,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error('Admin customers cursor query error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
