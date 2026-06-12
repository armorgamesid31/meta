import { Router } from 'express';
import { prisma } from '../prisma.js';
import { loadSalonAgentContext } from '../services/salonAgentContext.js';
import { resolveStaffProfile } from '../services/staffProfileResolver.js';
import {
  findBoundCustomer,
  normalizeInstagramIdentity,
  normalizePhoneDigits,
} from '../services/identityService.js';
import {
  findHolidayOnDate,
  resolveDateExpression,
  todayInIstanbul,
  ymdToWeekdayKey,
  ymdToWeekdayLongTr,
} from '../services/holidayCalendar.js';
import { mintPortalToken } from '../services/profilePortalService.js';
import { lookupGlobalIdentityByChannel } from '../services/globalCustomerIdentity.js';
import { resolveMapsLink } from '../services/mapsResolver.js';
import { createNotification, type NotificationEventType } from '../services/notifications.js';
import type { ChannelType } from '@prisma/client';

/**
 * n8n AI agent tool çağrılarının bağlandığı dahili API.
 * Tüm endpoint'ler /api/internal/agent altında — requireInternalApiKey
 * middleware'i server.ts'de zaten /api/internal genelinde takılı.
 *
 * Endpoints:
 *   GET  /salon-context?salonId=...       → tek kaynak: salon info + tone_directive
 *   POST /customer-lookup                 → channel + subject → müşteri profili + son randevular
 *   POST /check-day-open                  → "bayramda açık mısınız?" / "X günü açık mı?" çözümleyici
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
        staff: {
          select: {
            name: true,
            firstName: true,
            lastName: true,
            membership: {
              select: {
                identity: {
                  select: { firstName: true, lastName: true, displayName: true },
                },
              },
            },
          },
        },
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
        staffName:
          resolveStaffProfile(
            a.staff as any,
            (a.staff as any)?.membership?.identity ?? null,
          ).name || null,
      })),
    });
  } catch (err: any) {
    console.error('[internalAgent.customer-lookup] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * POST /check-day-open
 * Body: { salonId, dateExpression: string }
 *   dateExpression: "yarın" / "cumartesi" / "29 ekim" / "bayram" / "kurban bayramı" /
 *                   "anneler günü" / "2026-12-31" — agent ne duyduysa ham geçirir.
 *
 * Dönüş: { interpretation, ambiguous, days: [{ date, dayName, isOpen, reason,
 *          holidayName, isHalfDay, salonClosureNote, workHours }] }
 *
 * Karar mantığı (her gün için):
 *   1. SalonClosure (salon manuel kapama) varsa → kapalı.
 *   2. Haftalık çalışma günü değilse (workingDays) → kapalı.
 *   3. closesByDefault=true olan tatil ise → kapalı (national/religious bayram).
 *   4. closesByDefault='half' ise → yarım gün açık.
 *   5. Aksi halde → açık.
 *
 * Saat bilgisi vermez, slot vermez. Spesifik saat sorusunda agent doğrudan
 * tool_booking_link kullanmalı.
 */
const VALID_DAYS: Array<'MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN'> =
  ['MON','TUE','WED','THU','FRI','SAT','SUN'];

router.post('/check-day-open', async (req: any, res: any) => {
  const salonId = parseSalonId(req.body?.salonId);
  const expression = typeof req.body?.dateExpression === 'string' ? req.body.dateExpression : '';
  if (!salonId) return res.status(400).json({ ok: false, error: 'salonId_required' });
  if (!expression.trim()) return res.status(400).json({ ok: false, error: 'dateExpression_required' });

  try {
    const today = todayInIstanbul();
    const resolved = resolveDateExpression(expression, { today });

    if (resolved.unresolved || resolved.dates.length === 0) {
      return res.json({
        ok: true,
        interpretation: resolved.interpretation || 'çözümlenemedi',
        ambiguous: false,
        unresolved: true,
        outOfRange: resolved.outOfRange,
        days: [],
      });
    }

    // Tek-sorguda salon ayarlarını + tüm tarih aralığını kapsayan kapamaları çek
    const settings = await prisma.salonSettings.findUnique({
      where: { salonId },
      select: { workingDays: true, workStartHour: true, workEndHour: true, timezone: true },
    });

    const minDate = resolved.dates[0];
    const maxDate = resolved.dates[resolved.dates.length - 1];
    const rangeStart = new Date(`${minDate}T00:00:00+03:00`);
    const rangeEnd = new Date(`${maxDate}T23:59:59+03:00`);

    const closures = await prisma.salonClosure.findMany({
      where: {
        salonId,
        startAt: { lte: rangeEnd },
        endAt: { gte: rangeStart },
      },
      select: { startAt: true, endAt: true, reason: true },
    });

    const workingDaySet = new Set<string>(
      Array.isArray(settings?.workingDays)
        ? (settings!.workingDays as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim().toUpperCase())
            .filter((v) => VALID_DAYS.includes(v as any))
        : VALID_DAYS,
    );
    if (workingDaySet.size === 0) for (const d of VALID_DAYS) workingDaySet.add(d);

    const workStart = settings?.workStartHour ?? 9;
    const workEnd = settings?.workEndHour ?? 18;
    const workHoursFull = `${String(workStart).padStart(2, '0')}:00–${String(workEnd).padStart(2, '0')}:00`;

    const days = resolved.dates.map((date) => {
      const dayName = ymdToWeekdayLongTr(date);
      const weekKey = ymdToWeekdayKey(date);
      const dayStart = new Date(`${date}T00:00:00+03:00`);
      const dayEnd = new Date(`${date}T23:59:59+03:00`);
      const overlappingClosure = closures.find((c) => c.startAt <= dayEnd && c.endAt >= dayStart);
      const holiday = findHolidayOnDate(date);

      let isOpen = true;
      let reason: string | null = null;
      let isHalfDay = false;
      let workHours: string | null = workHoursFull;
      let salonClosureNote: string | null = null;

      if (overlappingClosure) {
        isOpen = false;
        reason = 'salon_closure';
        salonClosureNote = overlappingClosure.reason || null;
        workHours = null;
      } else if (!workingDaySet.has(weekKey)) {
        isOpen = false;
        reason = 'weekly_off';
        workHours = null;
      } else if (holiday && holiday.closesByDefault === true) {
        isOpen = false;
        reason = holiday.type === 'religious' ? 'religious_holiday' : 'national_holiday';
        workHours = null;
      } else if (holiday && holiday.closesByDefault === 'half') {
        isOpen = true;
        isHalfDay = true;
        // Yarım gün ifadesi → sabah açık varsayımı
        workHours = `${String(workStart).padStart(2, '0')}:00–13:00`;
      }

      return {
        date,
        dayName,
        isOpen,
        reason,
        isHalfDay,
        holidayName: holiday?.name || null,
        holidayType: holiday?.type || null,
        salonClosureNote,
        workHours,
      };
    });

    return res.json({
      ok: true,
      interpretation: resolved.interpretation,
      ambiguous: resolved.ambiguous,
      unresolved: false,
      outOfRange: resolved.outOfRange,
      days,
    });
  } catch (err: any) {
    console.error('[internalAgent.check-day-open] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * POST /location-intent
 * Body: { salonId, channel: 'WHATSAPP'|'INSTAGRAM', conversationKey, canonicalUserId?, customerId? }
 *
 * Müşteri konum/adres sorduğunda n8n tool_request_location bunu çağırır.
 * Booking magic-link deseniyle aynı mantık: burada SADECE "pending location"
 * işareti bırakılır; Google Maps butonunu AI'ın cevabına agent-outbound/send
 * gömerek tek mesajda yollar (ve pendingLocationAt'ı temizler).
 *
 * Dönüş:
 *   { ok:true, hasButton:true,  address }  → Maps URL kayıtlı, buton gömülecek
 *   { ok:true, hasButton:false, address }  → Maps URL yok; AI adresi metinle söylesin
 */
router.post('/location-intent', async (req: any, res: any) => {
  const salonId = parseSalonId(req.body?.salonId);
  const channel = parseChannel(req.body?.channel);
  const conversationKey =
    typeof req.body?.conversationKey === 'string' ? req.body.conversationKey.trim() : '';

  if (!salonId || !channel || !conversationKey) {
    return res
      .status(400)
      .json({ ok: false, error: 'salonId_channel_conversationKey_required' });
  }

  const canonicalUserId =
    typeof req.body?.canonicalUserId === 'string' && req.body.canonicalUserId.trim()
      ? req.body.canonicalUserId.trim()
      : null;
  const customerId =
    Number.isInteger(Number(req.body?.customerId)) && Number(req.body?.customerId) > 0
      ? Number(req.body.customerId)
      : null;

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { googleMapsUrl: true, mapsPlaceId: true, address: true, district: true, city: true },
    });

    const mapsUrl =
      typeof salon?.googleMapsUrl === 'string' ? salon.googleMapsUrl.trim() : '';
    const addressText = [salon?.address, salon?.district, salon?.city]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean)
      .join(', ');

    if (!mapsUrl) {
      // Harita linki kayıtlı değil — buton gömülemez; AI adresi metinle söylesin.
      return res.json({ ok: true, hasButton: false, address: addressText || null });
    }

    // Yer-profili butonu: googleMapsUrl bir paylaşım/kısa link ise (share.google /
    // goo.gl / maps.app) resolver redirect+geocode ile place_id üretir; salon başına
    // BİR KEZ cache'lenir. Buton outbound'da bu place_id'den "Maps yer-profili" linki
    // kurar (coğrafi koordinat DEĞİL). Başarısızsa buton ham URL'e düşer (best-effort).
    const isProperMapsUrl = /^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(mapsUrl);
    if (!salon?.mapsPlaceId && !isProperMapsUrl) {
      try {
        const resolved = await resolveMapsLink(mapsUrl);
        if (resolved.place_id) {
          await prisma.salon.update({
            where: { id: salonId },
            data: { mapsPlaceId: resolved.place_id },
          });
        }
      } catch (err: any) {
        console.warn('[location-intent] maps resolve failed:', err?.message || err);
      }
    }

    // Pending location işaretle — agent-outbound/send bunu görüp butonu cevaba gömecek.
    await prisma.conversationState.upsert({
      where: { salonId_channel_conversationKey: { salonId, channel, conversationKey } },
      update: { pendingLocationAt: new Date() },
      create: {
        salonId,
        channel,
        conversationKey,
        canonicalUserId,
        customerId,
        pendingLocationAt: new Date(),
      },
    });

    return res.json({ ok: true, hasButton: true, address: addressText || null });
  } catch (err: any) {
    console.error('[internalAgent.location-intent] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * POST /profile-edit-intent
 * Body: { salonId, channel:'WHATSAPP'|'INSTAGRAM', conversationKey, canonicalUserId?, customerId? }
 *
 * Müşteri "bilgilerimi/numaramı değiştirmek istiyorum" dediğinde n8n
 * tool_request_profile_edit bunu çağırır. Müşterinin GLOBAL kimliğini çözer,
 * tek-kullanımlık salon-nötr portal linki mint'ler ve ConversationState.
 * pendingProfileEditUrl'e yazar; "Bilgilerimi güncelle" butonunu AI'ın cevabına
 * agent-outbound/send gömer (token modele tekrar ettirilmez → kopyalama hatası yok).
 *
 * Dönüş:
 *   { ok:true, found:true,  hasButton:true }  → link hazır, buton gömülecek
 *   { ok:true, found:false }                  → tanınan kayıt yok; AI önce kayıt önersin
 */
router.post('/profile-edit-intent', async (req: any, res: any) => {
  const salonId = parseSalonId(req.body?.salonId);
  const channel = parseChannel(req.body?.channel);
  const conversationKey =
    typeof req.body?.conversationKey === 'string' ? req.body.conversationKey.trim() : '';
  if (!salonId || !channel || !conversationKey) {
    return res.status(400).json({ ok: false, error: 'salonId_channel_conversationKey_required' });
  }
  const canonicalUserId =
    typeof req.body?.canonicalUserId === 'string' && req.body.canonicalUserId.trim()
      ? req.body.canonicalUserId.trim()
      : null;
  const customerId =
    Number.isInteger(Number(req.body?.customerId)) && Number(req.body?.customerId) > 0
      ? Number(req.body.customerId)
      : null;

  try {
    // Global kimliği çöz: önce customerId (en güvenilir), sonra kanal subject'i.
    let globalIdentityId: string | null = null;
    let originSubject = canonicalUserId || conversationKey;
    if (customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { globalIdentityId: true, phone: true },
      });
      globalIdentityId = customer?.globalIdentityId ?? null;
      if (channel === 'WHATSAPP' && customer?.phone) originSubject = customer.phone;
    }
    if (!globalIdentityId && canonicalUserId) {
      const identity = await lookupGlobalIdentityByChannel(channel, canonicalUserId);
      globalIdentityId = identity?.id ?? null;
    }
    if (!globalIdentityId) {
      // Tanınan müşteri yok → düzenlenecek bir şey yok; AI önce kayıt/randevu önersin.
      return res.json({ ok: true, found: false });
    }

    const { token } = await mintPortalToken({
      globalIdentityId,
      originChannel: channel,
      originSubject,
    });
    const base = (process.env.PROFILE_PORTAL_URL || 'https://kedyapp.com/hesabim')
      .trim()
      .replace(/\/+$/, '');
    const url = `${base}?token=${token}`;

    await prisma.conversationState.upsert({
      where: { salonId_channel_conversationKey: { salonId, channel, conversationKey } },
      update: { pendingProfileEditUrl: url, pendingProfileEditAt: new Date() },
      create: {
        salonId,
        channel,
        conversationKey,
        canonicalUserId,
        customerId,
        pendingProfileEditUrl: url,
        pendingProfileEditAt: new Date(),
      },
    });

    return res.json({ ok: true, found: true, hasButton: true });
  } catch (err: any) {
    console.error('[internalAgent.profile-edit-intent] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

/**
 * POST /test-notification  (internal-key korumalı)
 * Body: { salonId, eventType?, title?, body? }
 * Gerçek push hattından (FCM) salon ekibine test bildirimi gönderir. createNotification
 * eventType'a göre alıcıları (OWNER/MANAGER/...) çözer + uygulama-içi + push gönderir.
 * Dönüş: alıcı sayısı + push teslim özeti (SENT/SKIPPED/FAILED) — push çalışıyor mu görülür.
 */
router.post('/test-notification', async (req: any, res: any) => {
  const salonId = parseSalonId(req.body?.salonId);
  if (!salonId) return res.status(400).json({ ok: false, error: 'salonId_required' });
  const eventType = (typeof req.body?.eventType === 'string' ? req.body.eventType : 'HANDOVER_REQUIRED') as NotificationEventType;
  const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Test bildirimi';
  const body =
    typeof req.body?.body === 'string' && req.body.body.trim()
      ? req.body.body.trim()
      : 'Bu bir test bildirimidir. Telefonunda gördüysen push çalışıyor.';
  try {
    const r = await createNotification({ salonId, eventType, title, body });
    return res.json({
      ok: true,
      eventType,
      recipientCount: r.recipientUserIds.length,
      inAppDeliveryCount: r.inAppDeliveryCount,
      pushDeliveryCount: r.pushDeliveryCount,
      pushDeliverySummary: r.pushDeliverySummary,
    });
  } catch (err: any) {
    console.error('[internalAgent.test-notification] failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error', detail: String(err?.message || err) });
  }
});

export default router;
