// W2 — n8n'deki 4 gömülü-SQL tool'unun backend portu (faithful). n8n
// `{{ $fromAI(...) }}` template'leri yerine PARAMETRELİ `$queryRaw` (Prisma
// güvenli kaçışlar; n8n'in .replace(/'/g) hilesi gereksiz). gender/region
// türetme + related_terms regexp_split + match_rank + faq jsonb birebir korundu.

import type { ChannelType } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { resolveStaffProfile } from '../../services/staffProfileResolver.js';
import { canonicalPhoneDigits } from '../../services/phoneValidation.js';
import {
  findBoundCustomer,
  normalizeInstagramIdentity,
  normalizePhoneDigits,
} from '../../services/identityService.js';
import {
  findHolidayOnDate,
  resolveDateExpression,
  todayInIstanbul,
  ymdToWeekdayKey,
  ymdToWeekdayLongTr,
} from '../../services/holidayCalendar.js';

/** tool_get_prices portu: hizmet adına/eşanlamlılara göre fiyat (gender/region türetmeli). */
export async function queryServicePrices(
  salonId: number,
  serviceName: string,
  relatedTerms: string,
): Promise<Array<Record<string, unknown>>> {
  const q = (serviceName || '').toLowerCase().trim();
  const rt = (relatedTerms || '').toLowerCase().trim();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH inp AS (SELECT ${q}::text AS q, ${rt}::text AS related_terms),
    terms AS (SELECT trim(value) AS term FROM inp, regexp_split_to_table(inp.related_terms, ',') AS value WHERE trim(value) <> '')
    SELECT s."name", s."price", s."duration", s."category", sr."name" AS "region",
      CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id")
        THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'female'::"CustomerGender") ELSE true END AS "female",
      CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id")
        THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'male'::"CustomerGender") ELSE true END AS "male"
    FROM "Service" s
    LEFT JOIN "ServiceRegion" sr ON sr."id" = s."regionId"
    WHERE s."salonId" = ${salonId} AND COALESCE(s."isActive", true) = true
      AND ((SELECT q FROM inp) = ''
        OR s."name" ILIKE '%' || (SELECT q FROM inp) || '%'
        OR COALESCE(s."category",'') ILIKE '%' || (SELECT q FROM inp) || '%'
        OR EXISTS (SELECT 1 FROM terms t WHERE s."name" ILIKE '%' || t.term || '%' OR COALESCE(s."category",'') ILIKE '%' || t.term || '%'))
    ORDER BY s."price" ASC LIMIT 5`;
  // Decimal price'ı serileştirilebilir Number'a çevir.
  return rows.map((r) => ({ ...r, price: r.price != null ? Number(r.price as any) : null }));
}

/** tool_get_services portu: hizmet arama (match_rank sıralı, gender/region türetmeli). */
export async function searchServices(
  salonId: number,
  q: string,
  relatedTerms: string,
  limit = 10,
): Promise<unknown> {
  const qraw = (q || '').toLowerCase().trim();
  const rt = (relatedTerms || '').toLowerCase().trim();
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const rows = await prisma.$queryRaw<Array<{ services: unknown }>>`
    WITH inp AS (SELECT ${qraw}::text AS q_raw, ${rt}::text AS related_terms_raw),
    norm AS (SELECT CASE WHEN q_raw IN ('hizmet','hizmetler','servis','servisler','işlem','işlemler','uygulama','uygulamalar') THEN '' ELSE q_raw END AS q, related_terms_raw AS related_terms FROM inp),
    terms AS (SELECT trim(value) AS term FROM norm, regexp_split_to_table(norm.related_terms, ',') AS value WHERE trim(value) <> ''),
    rows AS (
      SELECT s."id", s."name", s."category", s."description", s."price", s."duration", sr."name" AS "region",
        COALESCE(s."requiresSpecialist", false) AS "requiresSpecialist",
        CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id") THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'female'::"CustomerGender") ELSE true END AS "female",
        CASE WHEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id") THEN EXISTS (SELECT 1 FROM "ServiceGender" sg WHERE sg."serviceId" = s."id" AND sg."gender" = 'male'::"CustomerGender") ELSE true END AS "male",
        CASE
          WHEN (SELECT q FROM norm) <> '' AND s."name" ILIKE '%' || (SELECT q FROM norm) || '%' THEN 1
          WHEN (SELECT q FROM norm) <> '' AND COALESCE(s."category",'') ILIKE '%' || (SELECT q FROM norm) || '%' THEN 2
          WHEN (SELECT q FROM norm) <> '' AND COALESCE(s."description",'') ILIKE '%' || (SELECT q FROM norm) || '%' THEN 3
          WHEN EXISTS (SELECT 1 FROM terms t WHERE s."name" ILIKE '%' || t.term || '%' OR COALESCE(s."category",'') ILIKE '%' || t.term || '%' OR COALESCE(s."description",'') ILIKE '%' || t.term || '%') THEN 4
          ELSE 9 END AS match_rank
      FROM "Service" s LEFT JOIN "ServiceRegion" sr ON sr."id" = s."regionId"
      WHERE s."salonId" = ${salonId} AND COALESCE(s."isActive", true) = true
        AND ((SELECT q FROM norm) = ''
          OR s."name" ILIKE '%' || (SELECT q FROM norm) || '%'
          OR COALESCE(s."category",'') ILIKE '%' || (SELECT q FROM norm) || '%'
          OR COALESCE(s."description",'') ILIKE '%' || (SELECT q FROM norm) || '%'
          OR EXISTS (SELECT 1 FROM terms t WHERE s."name" ILIKE '%' || t.term || '%' OR COALESCE(s."category",'') ILIKE '%' || t.term || '%' OR COALESCE(s."description",'') ILIKE '%' || t.term || '%'))
      ORDER BY match_rank, s."category" NULLS LAST, s."name" LIMIT ${lim}
    )
    SELECT COALESCE(jsonb_agg(row_to_json(rows)), '[]'::jsonb) AS services FROM rows`;
  return rows[0]?.services ?? [];
}

/** tool_get_faq portu: salon-geneli + (varsa) kategori SSS'leri (jsonb). */
export async function getSalonFaq(
  salonId: number,
  categoryId?: string,
  categoryName?: string,
): Promise<{ salon_faq: unknown; category_faq: unknown }> {
  const cid = (categoryId || '').trim() || null;
  const cname = (categoryName || '').trim() || null;
  const rows = await prisma.$queryRaw<Array<{ salon_faq: unknown; category_faq: unknown }>>`
    WITH inp AS (SELECT ${cid}::text AS category_id_raw, ${cname}::text AS category_name_raw),
    category_faq AS (
      SELECT sc."commonQuestions" AS faq FROM "ServiceCategory" sc, inp
      WHERE sc."salonId" = ${salonId}
        AND ((inp.category_id_raw IS NOT NULL AND inp.category_id_raw ~ '^[0-9]+$' AND sc."id" = inp.category_id_raw::int)
          OR (inp.category_id_raw IS NULL AND inp.category_name_raw IS NOT NULL AND sc."name" ILIKE '%' || inp.category_name_raw || '%'))
      ORDER BY sc."id" DESC LIMIT 1)
    SELECT COALESCE((SELECT ss."commonQuestions" FROM "SalonSettings" ss WHERE ss."salonId" = ${salonId} LIMIT 1), '[]'::jsonb) AS salon_faq,
      COALESCE((SELECT faq FROM category_faq), '[]'::jsonb) AS category_faq`;
  return rows[0] ?? { salon_faq: [], category_faq: [] };
}

/** tool_customer_lookup portu (internalAgent /customer-lookup birebir): kanal+subject
 *  → müşteri profili + son 5 randevu. IdentityBinding kanonik; yoksa Customer fallback. */
export async function lookupCustomer(
  salonId: number,
  channel: ChannelType,
  subjectRaw: string,
): Promise<Record<string, unknown>> {
  const subject = (subjectRaw || '').trim();
  if (!subject) return { found: false };
  const subjectNormalized =
    channel === 'WHATSAPP' ? normalizePhoneDigits(subject) : normalizeInstagramIdentity(subject);

  let customer = await findBoundCustomer({ salonId, channel, subjectNormalized });
  if (!customer && subjectNormalized) {
    if (channel === 'WHATSAPP') {
      const e164 = canonicalPhoneDigits(subjectNormalized);
      const tail = (e164 || subjectNormalized).slice(-10);
      customer = await prisma.customer.findFirst({
        where: {
          salonId,
          OR: [
            ...(e164 ? [{ phone: { contains: e164 } }] : []),
            ...(tail ? [{ phone: { contains: tail } }] : []),
          ],
        },
        select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
      });
    } else {
      customer = await prisma.customer.findFirst({
        where: { salonId, instagram: { equals: subjectNormalized, mode: 'insensitive' } },
        select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
      });
    }
  }
  if (!customer) return { found: false };

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
          membership: { select: { identity: { select: { firstName: true, lastName: true, displayName: true } } } },
        },
      },
    },
  });

  return {
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
        resolveStaffProfile(a.staff as any, (a.staff as any)?.membership?.identity ?? null).name || null,
    })),
  };
}

const VALID_DAYS: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'> = [
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
];

/** tool_check_day_open portu (internalAgent /check-day-open birebir): doğal-dil gün
 *  ifadesi → açık/kapalı (SalonClosure → haftalık → tatil → yarım gün karar zinciri). */
export async function checkDayOpen(
  salonId: number,
  expression: string,
): Promise<Record<string, unknown>> {
  const expr = (expression || '').trim();
  if (!expr) return { ok: false, error: 'dateExpression_required' };

  const today = todayInIstanbul();
  const resolved = resolveDateExpression(expr, { today });

  if (resolved.unresolved || resolved.dates.length === 0) {
    return {
      interpretation: resolved.interpretation || 'çözümlenemedi',
      ambiguous: false,
      unresolved: true,
      outOfRange: resolved.outOfRange,
      days: [],
    };
  }

  const settings = await prisma.salonSettings.findUnique({
    where: { salonId },
    select: { workingDays: true, workStartHour: true, workEndHour: true, workingHoursByDay: true, timezone: true },
  });

  const minDate = resolved.dates[0];
  const maxDate = resolved.dates[resolved.dates.length - 1];
  const rangeStart = new Date(`${minDate}T00:00:00+03:00`);
  const rangeEnd = new Date(`${maxDate}T23:59:59+03:00`);

  const closures = await prisma.salonClosure.findMany({
    where: { salonId, startAt: { lte: rangeEnd }, endAt: { gte: rangeStart } },
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
  // Gün-bazlı saat override'ı (varsa o günün düz saati yerine geçer).
  const whbd =
    settings?.workingHoursByDay && typeof settings.workingHoursByDay === 'object' && !Array.isArray(settings.workingHoursByDay)
      ? (settings.workingHoursByDay as Record<string, { start?: number; end?: number }>)
      : null;
  const pad2h = (h: number) => String(h).padStart(2, '0');

  const days = resolved.dates.map((date) => {
    const dayName = ymdToWeekdayLongTr(date);
    const weekKey = ymdToWeekdayKey(date);
    const dayStart = new Date(`${date}T00:00:00+03:00`);
    const dayEnd = new Date(`${date}T23:59:59+03:00`);
    const overlappingClosure = closures.find((c) => c.startAt <= dayEnd && c.endAt >= dayStart);
    const holiday = findHolidayOnDate(date);

    // O güne özel saat (yoksa düz saat).
    const perDay = whbd?.[weekKey];
    const dStart = typeof perDay?.start === 'number' ? perDay.start : workStart;
    const dEnd = typeof perDay?.end === 'number' ? perDay.end : workEnd;

    let isOpen = true;
    let reason: string | null = null;
    let isHalfDay = false;
    let workHours: string | null = `${pad2h(dStart)}:00–${pad2h(dEnd)}:00`;
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
      workHours = `${pad2h(dStart)}:00–13:00`;
    }

    // holidayName/holidayType: tatil kapatma NEDENİ olduğunda dön.
    // weekly_off / salon_closure durumunda tatil adı döndürme — model ikinci
    // neden olarak yorumlayıp yanlış cevap verir (örn. Babalar Günü + weekly_off).
    const holidayIsReason =
      reason === 'religious_holiday' ||
      reason === 'national_holiday' ||
      isHalfDay;

    return {
      date,
      dayName,
      isOpen,
      reason,
      isHalfDay,
      holidayName: holidayIsReason ? (holiday?.name || null) : null,
      holidayType: holidayIsReason ? (holiday?.type || null) : null,
      salonClosureNote,
      workHours,
    };
  });

  return {
    interpretation: resolved.interpretation,
    ambiguous: resolved.ambiguous,
    unresolved: false,
    outOfRange: resolved.outOfRange,
    days,
  };
}
