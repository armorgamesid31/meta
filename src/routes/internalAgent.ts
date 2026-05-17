import { Router } from 'express';
import { prisma } from '../prisma.js';
import { loadSalonAgentContext } from '../services/salonAgentContext.js';
import {
  findBoundCustomer,
  normalizeInstagramIdentity,
  normalizePhoneDigits,
} from '../services/identityService.js';
import {
  buildSingleServiceGroups,
  generateAvailability,
} from '../services/availabilityService.js';
import type { ChannelType } from '@prisma/client';

/**
 * n8n AI agent tool çağrılarının bağlandığı dahili API.
 * Tüm endpoint'ler /api/internal/agent altında — requireInternalApiKey
 * middleware'i server.ts'de zaten /api/internal genelinde takılı.
 *
 * Endpoints:
 *   GET  /salon-context?salonId=...       → tek kaynak: salon info + tone_directive
 *   POST /customer-lookup                 → channel + subject → müşteri profili + son randevular
 *   GET  /availability                    → boş slot listesi (servis + tarih bazlı)
 */

const router = Router();

function parseSalonId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'WHATSAPP' || upper === 'INSTAGRAM') return upper as ChannelType;
  return null;
}

/**
 * GET /salon-context?salonId=123
 *
 * n8n her isteğin başında bunu çağırır. Dönüş: salon adı, saat, ton_direktifi,
 * stil direktifi, oneLiner. Bu sayede n8n sistem prompt'unda 3 ton + 6 davranış
 * matrisi tutmasına gerek kalmıyor.
 */
router.get('/salon-context', async (req: any, res: any) => {
  const salonId = parseSalonId(req.query?.salonId);
  if (!salonId) {
    return res.status(400).json({ ok: false, error: 'salonId_required' });
  }
  try {
    const ctx = await loadSalonAgentContext(salonId);
    if (!ctx) {
      return res.status(404).json({ ok: false, error: 'salon_not_found' });
    }
    return res.json({ ok: true, ...ctx });
  } catch (err: any) {
    console.error('[internalAgent.salon-context] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * POST /customer-lookup
 * Body: { salonId, channel: 'WHATSAPP'|'INSTAGRAM', subject }
 *   - subject: WhatsApp için telefon ('905551234567' veya '+90...'), Instagram için handle/ID.
 *
 * Stratejisi: önce IdentityBinding'de ara (kanonik). Bulamazsa Customer tablosunda
 * normalize edilmiş telefon/instagram alanında ara. Bulursa son 5 randevu özetini
 * de ekle — agent "Geçen ay saç boyatmıştınız, aynı hizmeti mi istersiniz?" diyebilsin.
 */
router.post('/customer-lookup', async (req: any, res: any) => {
  const salonId = parseSalonId(req.body?.salonId);
  const channel = parseChannel(req.body?.channel);
  const subjectRaw = typeof req.body?.subject === 'string' ? req.body.subject : '';

  if (!salonId) return res.status(400).json({ ok: false, error: 'salonId_required' });
  if (!channel) return res.status(400).json({ ok: false, error: 'channel_required' });
  if (!subjectRaw.trim()) return res.status(400).json({ ok: false, error: 'subject_required' });

  const subjectNormalized =
    channel === 'WHATSAPP'
      ? normalizePhoneDigits(subjectRaw)
      : normalizeInstagramIdentity(subjectRaw);

  try {
    let customer = await findBoundCustomer({ salonId, channel, subjectNormalized });

    // Fallback: IdentityBinding henüz yoksa Customer tablosunda direkt ara.
    if (!customer && subjectNormalized) {
      if (channel === 'WHATSAPP') {
        customer = await prisma.customer.findFirst({
          where: { salonId, phone: { contains: subjectNormalized } },
          select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
        });
      } else {
        customer = await prisma.customer.findFirst({
          where: {
            salonId,
            instagram: { equals: subjectNormalized, mode: 'insensitive' },
          },
          select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
        });
      }
    }

    if (!customer) {
      return res.json({ ok: true, found: false });
    }

    const recentAppointments = await prisma.appointment.findMany({
      where: { salonId, customerId: customer.id },
      orderBy: { startTime: 'desc' },
      take: 5,
      select: {
        id: true,
        startTime: true,
        status: true,
        service: { select: { name: true } },
        staff: { select: { name: true } },
      },
    });

    return res.json({
      ok: true,
      found: true,
      customer: {
        id: customer.id,
        name: customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || null,
        phone: customer.phone || null,
        instagram: customer.instagram || null,
      },
      recentAppointments: recentAppointments.map((a) => ({
        id: a.id,
        startTime: a.startTime.toISOString(),
        status: a.status,
        serviceName: a.service?.name || null,
        staffName: a.staff?.name || null,
      })),
    });
  } catch (err: any) {
    console.error('[internalAgent.customer-lookup] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * GET /availability?salonId=...&serviceId=...&date=YYYY-MM-DD&peopleCount=1
 *
 * Tek-servis, tek-kişi varsayılan. Daha karmaşık durumlar için (çoklu hizmet,
 * grup randevusu) public /api/availability/slots zaten var; agent'a şimdilik
 * gerek yok — magic-link akışı koruyor.
 */
router.get('/availability', async (req: any, res: any) => {
  const salonId = parseSalonId(req.query?.salonId);
  const serviceId = parseSalonId(req.query?.serviceId);
  const date = typeof req.query?.date === 'string' ? req.query.date : '';
  const peopleCount = Number(req.query?.peopleCount) || 1;

  if (!salonId) return res.status(400).json({ ok: false, error: 'salonId_required' });
  if (!serviceId) return res.status(400).json({ ok: false, error: 'serviceId_required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: 'date_must_be_yyyy_mm_dd' });
  }

  try {
    const result = await generateAvailability({
      salonId,
      date,
      groups: buildSingleServiceGroups(serviceId, peopleCount > 0 ? peopleCount : 1),
    });

    return res.json({
      ok: true,
      date,
      slots: result.displaySlots.map((s) => s.label),
      slotCount: result.displaySlots.length,
    });
  } catch (err: any) {
    console.error('[internalAgent.availability] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

export default router;
