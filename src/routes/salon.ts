import { Router } from 'express';
import QRCode from 'qrcode';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { logCustomerBehavior, calculateCancellationSeverity, BehaviorType } from '../utils/behaviorTracking.js';
import { CATEGORIES, CATEGORY_ORDER } from '../constants/categories.js';
import { normalizeLocale } from '../constants/locales.js';
import { resolveServiceTranslations } from '../services/serviceTranslations.js';
import { syncSubscriptionQuantity } from '../services/seatBilling.js';
import { BusinessError } from '../lib/errors.js';
import { normalizeWorkingHoursByDay } from '../lib/workingHours.js';
import { slugify, withSlugCollision } from '../utils/slug.js';
import { resolveStaffProfile } from '../services/staffProfileResolver.js';
import { resolveServicePricing } from '../services/servicePricing.js';
import { OnboardingStatus, OnboardingStep, Prisma } from '@prisma/client';
import { markTaskComplete } from '../services/journeyService.js';
import { deriveTones, PRESET_DEFAULT_BRAND, isPresetId } from '../lib/theme/derive.js';
import { syncAgentSettingsTone, type AgentTone } from '../services/salonAgentContext.js';

const ONBOARDING_STEP_VALUES = new Set<string>([
  'NOT_STARTED',
  'WELCOME',
  'SALON_NAME',
  'SLUG',
  'ADDRESS',
  'PHONE',
  'WORKING_HOURS',
  'LOGO',
  'GALLERY',
  'SERVICES',
  'TONE',
  'COMPLETED',
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const router = Router();

function splitStaffNameParts(name: string): { firstName: string; lastName: string | null } {
  const normalized = String(name || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return { firstName: 'Uzman', lastName: null };
  const [firstName, ...rest] = normalized.split(' ');
  return {
    firstName: firstName || 'Uzman',
    lastName: rest.length ? rest.join(' ') : null,
  };
}

// GET /api/salon/public - Get salon info (public for tenant subdomain)
router.get('/public', async (req: any, res: any) => {
  const salonId = req.salon?.id;

  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Tenant context required', 400);
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        settings: true
      }
    });

    if (!salon) {
      throw new BusinessError('NOT_FOUND', 'Salon not found', 404);
    }

    const rawPreset = (salon as any).themePreset;
    const themePreset = isPresetId(rawPreset) ? rawPreset : 'classic';
    const themeBrand = ((salon as any).brandColor as string | null)
      || PRESET_DEFAULT_BRAND[themePreset];
    const themeResolved = (salon as any).themeResolved
      || deriveTones(themeBrand, themePreset);

    res.json({
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        logoUrl: salon.logoUrl,
        whatsappPhone: salon.whatsappPhone,
        city: salon.city,
        citySlug: salon.citySlug,
        district: salon.district,
        districtSlug: salon.districtSlug,
        countryCode: salon.countryCode,
        googleMapsUrl: salon.googleMapsUrl,
        contentSourceLocale: salon.settings?.contentSourceLocale || 'tr',
        workStartHour: salon.settings?.workStartHour || 9,
        workEndHour: salon.settings?.workEndHour || 18,
        slotInterval: salon.settings?.slotInterval || 30,
        categoryOrder: salon.settings?.categoryOrder || null,
        theme: {
          preset: themePreset,
          brandColor: themeBrand,
          logoUrl: salon.logoUrl,
          resolved: themeResolved,
        },
      },
      theme: {
        preset: themePreset,
        brandColor: themeBrand,
        logoUrl: salon.logoUrl,
        resolved: themeResolved,
      },
    });
  } catch (error) {
    console.error('Error fetching salon public info:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/me - Get salon info and settings
router.get('/me', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: req.user.salonId },
      include: {
        settings: true,
        _count: {
          select: {
            services: true,
            staff: true
          }
        }
      }
    });

    if (!salon) {
      throw new BusinessError('NOT_FOUND', 'Salon not found', 404);
    }

    const hasServices = salon._count.services > 0;
    const hasWorkingHours = (salon.settings?.workStartHour !== undefined &&
                            salon.settings?.workEndHour !== undefined);
    const onboardingComplete = hasServices && hasWorkingHours;
    const subscriptionStatus = 'trial';

    res.json({
      salon: {
        id: salon.id,
        name: salon.name,
        logoUrl: salon.logoUrl,
        workStartHour: salon.settings?.workStartHour || 9,
        workEndHour: salon.settings?.workEndHour || 18,
        slotInterval: salon.settings?.slotInterval || 30,
        onboardingComplete,
        subscriptionStatus
      }
    });
  } catch (error) {
    console.error('Error fetching salon:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/booking-qr — salon owner için public booking sayfasının PNG QR kodu.
// Query: ?size=512 (default 512, clamp 128-1024).
// Davranış:
//   1. Auth'lu salonun slug'ını oku (yoksa 404).
//   2. Public booking URL'sini üret. `buildBookingUrl` helper'ı per-customer
//      magic-link token gerektirdiği için (`/m/{token}`) burada owner'ın
//      paylaşabileceği token'sız landing URL'sini codebase'in geri kalanıyla
//      (salons.ts, seo.ts, slugService.ts) tutarlı şekilde slug subdomain
//      konvansiyonundan inşa ediyoruz: `https://{slug}.kedyapp.com/randevu`.
//      BOOKING_PUBLIC_URL_TEMPLATE veya FRONTEND_URL ile override edilebilir.
//   3. QR PNG buffer'ı response'a yaz (Content-Type: image/png).
router.get('/booking-qr', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const salon = await prisma.salon.findUnique({
    where: { id: req.user.salonId },
    select: { slug: true },
  });

  if (!salon || !salon.slug) {
    throw new BusinessError('NOT_FOUND', 'Salon slug bulunamadı', 404);
  }

  // Size: parse + clamp [128, 1024], default 512.
  const rawSize = parseInt(String(req.query?.size ?? ''), 10);
  const size =
    Number.isFinite(rawSize) && rawSize > 0
      ? Math.max(128, Math.min(1024, rawSize))
      : 512;

  // Public booking URL — slug subdomain konvansiyonu.
  const template =
    (process.env.BOOKING_PUBLIC_URL_TEMPLATE || '').trim() ||
    'https://{slug}.kedyapp.com/randevu';
  const bookingUrl = template.includes('{slug}')
    ? template.replace(/\{slug\}/g, salon.slug)
    : `${template.replace(/\/+$/, '')}/randevu`;

  let buffer: Buffer;
  try {
    buffer = await QRCode.toBuffer(bookingUrl, {
      type: 'png',
      width: size,
      errorCorrectionLevel: 'M',
      margin: 2,
    });
  } catch (err) {
    console.error('Error generating booking QR:', err);
    throw new BusinessError('INTERNAL_ERROR', 'QR kodu üretilemedi', 500);
  }

  res.set({
    'Content-Type': 'image/png',
    'Content-Disposition': `inline; filename="${salon.slug}-booking-qr.png"`,
    'Cache-Control': 'private, max-age=3600',
  });
  return res.send(buffer);
});

// PUT /api/salon/settings - Update salon settings
// GET /api/salon/communication-tone — read salon's tone preference
// (drives WhatsApp template variation tier AND AI agent response tone).
router.get('/communication-tone', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }
  const salon = await prisma.salon.findUnique({
    where: { id: req.user.salonId },
    select: { communicationTone: true },
  });
  if (!salon) {
    throw new BusinessError('NOT_FOUND', 'Salon bulunamadı.', 404);
  }
  return res.json({ tone: salon.communicationTone });
});

// GET /api/salon/offer-config — read birthday + winback offer config.
router.get('/offer-config', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  const salon = await prisma.salon.findUnique({
    where: { id: req.user.salonId },
    select: {
      birthdayDiscountText: true,
      birthdayValidityText: true,
      winbackDiscountText: true,
      winbackValidityText: true,
    },
  });
  if (!salon) throw new BusinessError('NOT_FOUND', 'Salon bulunamadı.', 404);
  return res.json({
    birthday: {
      discountText: salon.birthdayDiscountText || '',
      validityText: salon.birthdayValidityText || '',
      enabled: Boolean(salon.birthdayDiscountText && salon.birthdayValidityText),
    },
    winback: {
      discountText: salon.winbackDiscountText || '',
      validityText: salon.winbackValidityText || '',
      enabled: Boolean(salon.winbackDiscountText && salon.winbackValidityText),
    },
  });
});

// PATCH /api/salon/offer-config — update birthday + winback offer config.
// Empty string → disable that offer (template won't send).
router.patch('/offer-config', authenticateToken, async (req: any, res: any) => {
  if (!req.user) throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  const body = req.body || {};
  const data: any = {};
  if (body.birthday) {
    if (typeof body.birthday.discountText === 'string') {
      data.birthdayDiscountText = body.birthday.discountText.trim() || null;
    }
    if (typeof body.birthday.validityText === 'string') {
      data.birthdayValidityText = body.birthday.validityText.trim() || null;
    }
  }
  if (body.winback) {
    if (typeof body.winback.discountText === 'string') {
      data.winbackDiscountText = body.winback.discountText.trim() || null;
    }
    if (typeof body.winback.validityText === 'string') {
      data.winbackValidityText = body.winback.validityText.trim() || null;
    }
  }
  const updated = await prisma.salon.update({
    where: { id: req.user.salonId },
    data,
    select: {
      birthdayDiscountText: true,
      birthdayValidityText: true,
      winbackDiscountText: true,
      winbackValidityText: true,
    },
  });
  return res.json({
    birthday: {
      discountText: updated.birthdayDiscountText || '',
      validityText: updated.birthdayValidityText || '',
      enabled: Boolean(updated.birthdayDiscountText && updated.birthdayValidityText),
    },
    winback: {
      discountText: updated.winbackDiscountText || '',
      validityText: updated.winbackValidityText || '',
      enabled: Boolean(updated.winbackDiscountText && updated.winbackValidityText),
    },
  });
});

// PATCH /api/salon/communication-tone — update salon's tone preference.
router.patch('/communication-tone', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }
  const raw = String(req.body?.tone || '').toUpperCase();
  if (raw !== 'FRIENDLY' && raw !== 'BALANCED' && raw !== 'PROFESSIONAL') {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'tone FRIENDLY | BALANCED | PROFESSIONAL olmalı.',
      400,
    );
  }
  const updated = await prisma.salon.update({
    where: { id: req.user.salonId },
    data: { communicationTone: raw as any },
    select: { communicationTone: true },
  });

  // SalonAiAgentSettings.tone artık kullanılmıyor (kanonik kaynak Salon.communicationTone)
  // ama legacy n8n versiyonları hâlâ okuyor olabilir. Defansif sync — best effort.
  try {
    await syncAgentSettingsTone(req.user.salonId, raw.toLowerCase() as AgentTone);
  } catch (err) {
    console.warn('[salon.communication-tone] agent settings sync failed (non-fatal)', err);
  }

  return res.json({ tone: updated.communicationTone });
});

router.put('/settings', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const {
    name,
    slug,
    address,
    city,
    district,
    googleMapsUrl,
    whatsappPhone,
    contactPhone, // alias for whatsappPhone — frontend may send either
    phone, // legacy alias
    category,
    workStartHour,
    workEndHour,
    slotInterval,
    categoryOrder,
    workingDays,
    workingHoursByDay,
  } = req.body;

  const effectivePhone =
    typeof whatsappPhone === 'string'
      ? whatsappPhone
      : typeof contactPhone === 'string'
        ? contactPhone
        : typeof phone === 'string'
          ? phone
          : undefined;

  // Slug uniqueness pre-check (case-insensitive collision against other salons)
  if (typeof slug === 'string' && slug.trim().length > 0) {
    const conflict = await prisma.salon.findFirst({
      where: { slug: slug.trim(), NOT: { id: req.user.salonId } },
      select: { id: true },
    });
    if (conflict) {
      throw new BusinessError('SLUG_TAKEN', 'Bu slug başka bir salon tarafından kullanılıyor.', 409);
    }
  }

  try {
    const salonFieldsTouched =
      name !== undefined ||
      typeof slug === 'string' ||
      typeof address === 'string' ||
      typeof city === 'string' ||
      typeof district === 'string' ||
      typeof googleMapsUrl === 'string' ||
      effectivePhone !== undefined ||
      typeof category === 'string';

    if (salonFieldsTouched) {
      try {
        await prisma.salon.update({
          where: { id: req.user.salonId },
          data: {
            ...(name !== undefined && { name }),
            ...(typeof slug === 'string' && { slug: slug.trim() }),
            ...(typeof address === 'string' && { address }),
            ...(typeof city === 'string' && { city }),
            ...(typeof district === 'string' && { district }),
            ...(typeof googleMapsUrl === 'string' && { googleMapsUrl }),
            ...(effectivePhone !== undefined && { whatsappPhone: effectivePhone }),
            ...(typeof category === 'string' && { category: category as any }),
          },
        });
      } catch (updateError: any) {
        // TOCTOU race: pre-check passed but another salon claimed the slug
        // before our update landed. Surface as a 409 instead of a 500.
        if (updateError?.code === 'P2002') {
          throw new BusinessError('SLUG_TAKEN', 'Bu slug başka bir salon tarafından kullanılıyor.', 409);
        }
        throw updateError;
      }
    }

    const normalizedWhbd =
      workingHoursByDay !== undefined ? normalizeWorkingHoursByDay(workingHoursByDay) : undefined;

    if (workStartHour !== undefined || workEndHour !== undefined || slotInterval !== undefined || categoryOrder !== undefined || workingDays !== undefined || workingHoursByDay !== undefined) {
      const settings = await prisma.salonSettings.upsert({
        where: { salonId: req.user.salonId },
        update: {
          ...(workStartHour !== undefined && { workStartHour }),
          ...(workEndHour !== undefined && { workEndHour }),
          ...(slotInterval !== undefined && { slotInterval }),
          ...(categoryOrder !== undefined && { categoryOrder }),
          ...(workingDays !== undefined && { workingDays }),
          // Gün-bazlı saat: geçersiz/boş → null (düz saate düş).
          ...(workingHoursByDay !== undefined && { workingHoursByDay: normalizedWhbd ?? Prisma.DbNull }),
        },
        create: {
          salonId: req.user.salonId,
          ...(workStartHour !== undefined && { workStartHour }),
          ...(workEndHour !== undefined && { workEndHour }),
          ...(slotInterval !== undefined && { slotInterval }),
          ...(categoryOrder !== undefined && { categoryOrder }),
          ...(workingDays !== undefined && { workingDays }),
          ...(normalizedWhbd && { workingHoursByDay: normalizedWhbd }),
        }
      });

      res.json({ settings });
    } else {
      res.json({ message: 'Settings updated successfully' });
    }
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    console.error('Error updating salon settings:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/services - Get authenticated salon's services
router.get('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const salonId = req.user.salonId;
  const locale = normalizeLocale(typeof req.query.locale === 'string' ? req.query.locale : 'tr');

  try {
    const settings = await prisma.salonSettings.findUnique({
      where: { salonId },
      select: { contentSourceLocale: true },
    });
    const sourceLocale = settings?.contentSourceLocale || 'tr';

    const services = await prisma.service.findMany({
      where: {
        salonId: salonId
      },
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        regionId: true,
        ServiceRegion: {
          select: {
            id: true,
            name: true,
            categoryId: true,
          },
        },
      },
      orderBy: { name: 'asc' }
    });

    const translationMap = await resolveServiceTranslations({
      serviceIds: services.map((service) => service.id),
      locale,
      sourceLocale,
    });

    res.json({
      locale,
      sourceLocale,
      services: services.map((service) => {
        const translated = translationMap.get(service.id);
        return {
          ...service,
          name: translated?.name || service.name,
          description: translated?.description || service.description || null,
          regionId: service.regionId,
          regionName: service.ServiceRegion?.name || null,
          regionCategoryId: service.ServiceRegion?.categoryId || null,
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/services/public - Get salon services grouped by category
router.get('/services/public', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const { gender } = req.query;
  const locale = normalizeLocale(typeof req.query.locale === 'string' ? req.query.locale : 'tr');

  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Tenant context required', 400);
  }

  try {
    // 1. Fetch salon settings for category order
    const settings = await prisma.salonSettings.findUnique({
      where: { salonId },
      select: { categoryOrder: true, contentSourceLocale: true }
    });

    const sourceLocale = settings?.contentSourceLocale || 'tr';

    // 1b. Salon's per-category display order, set via the admin/mobile
    // drag-reorder (writes ServiceCategory.displayOrder). Used when the
    // legacy salon-level SalonSettings.categoryOrder array isn't set, so the
    // reorder in the app actually surfaces on the public booking page.
    const categoryRows = await prisma.serviceCategory.findMany({
      where: { salonId },
      select: { displayOrder: true, categoryRef: { select: { key: true } } },
      orderBy: { displayOrder: 'asc' },
    });
    const dbCategoryOrder = categoryRows
      .map((c) => c.categoryRef?.key?.toUpperCase().trim())
      .filter((k): k is string => Boolean(k));

    // 2. Fetch services with optional gender filter
    const rawServices = await prisma.service.findMany({
      where: {
        salonId,
        ...(gender && {
            OR: [
                { ServiceGender: { some: { gender: gender as any } } },
                { ServiceGender: { none: {} } } // Fallback for services with no specific gender
            ]
        })
      },
      select: {
        id: true,
        name: true,
        description: true,
        duration: true,
        price: true,
        category: true,
        categoryId: true,
        requiresSpecialist: true,
        regionId: true,
        ServiceCategory: {
          select: {
            id: true,
            categoryRef: {
              select: {
                key: true,
              },
            },
          },
        },
        ServiceRegion: {
          select: {
            id: true,
            name: true,
            categoryId: true,
          },
        },
      },
      // Honor the admin/mobile reorder. displayOrder is per-category; the
      // id tiebreaker keeps a stable, insertion-like order when several
      // rows share the same displayOrder (e.g. not yet reordered = all 0).
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });

    const translationMap = await resolveServiceTranslations({
      serviceIds: rawServices.map((service) => service.id),
      locale,
      sourceLocale,
    });

    // Cinsiyet-bazlı fiyat/süre: katalog da müşterinin gördüğü fiyatı sepet/commit
    // ile TUTARLI göstermeli. gender verildiyse ServiceVariant(gender) fiyat+süresini
    // bindir (uzman bilinmediği için staff katmanı yok → variant ya da base).
    const pricedByServiceId = new Map<number, { price: number; duration: number }>();
    if (gender) {
      const resolved = await resolveServicePricing(
        salonId,
        rawServices.map((s) => ({ serviceId: s.id, gender: String(gender) })),
      );
      for (const r of resolved) pricedByServiceId.set(r.serviceId, { price: r.price, duration: r.duration });
    }

    // Pre-compute per-service campaign badges so the booking UI can
    // show small pills like "⭐ Sadakat sayar" / "🎯 Çoklu uygun" at
    // the bottom of a service card. We only badge the campaign types
    // where being included actually changes how the customer thinks
    // about that service. Things like OFF_PEAK or WINBACK depend on
    // timing / customer state, not the service itself, so we skip them
    // here — those still surface as their own cards in HEDİYELER.
    const badgeableTypes = ['LOYALTY', 'MULTI_SERVICE_DISCOUNT', 'BILL_THRESHOLD', 'BIRTHDAY', 'WELCOME_FIRST_VISIT'] as const;
    const activeCampaigns = await prisma.campaign.findMany({
      where: { salonId, isActive: true, type: { in: badgeableTypes as any } },
      select: { id: true, type: true, config: true },
    });
    const badgeLabelByType: Record<string, string> = {
      LOYALTY: 'Sadakat sayar',
      MULTI_SERVICE_DISCOUNT: 'Çoklu uygun',
      BILL_THRESHOLD: 'Tutar ödülü',
      BIRTHDAY: 'Doğum günü',
      WELCOME_FIRST_VISIT: 'Hoş geldin',
    };
    function serviceBadgesFor(serviceId: number): Array<{ type: string; label: string }> {
      const out: Array<{ type: string; label: string }> = [];
      for (const c of activeCampaigns) {
        const cfg = (c.config || {}) as Record<string, any>;
        const included = Array.isArray(cfg.eligibleServiceIds) ? cfg.eligibleServiceIds.map((n: any) => Number(n)).filter(Boolean) : [];
        const excluded = Array.isArray(cfg.excludedServiceIds) ? cfg.excludedServiceIds.map((n: any) => Number(n)).filter(Boolean) : [];
        // Excluded wins; otherwise empty include list = "all services".
        if (excluded.includes(serviceId)) continue;
        if (included.length > 0 && !included.includes(serviceId)) continue;
        const label = badgeLabelByType[String(c.type)];
        if (label) out.push({ type: String(c.type), label });
      }
      return out;
    }

    // 3. Group services by category
    const groupedMap: Record<string, any[]> = {};
    
    rawServices.forEach(service => {
      const linkedKey = service.ServiceCategory?.categoryRef?.key?.toUpperCase().trim();
      const dbCat = (service.category || '').toUpperCase().trim();
      let finalKey = linkedKey || 'OTHER';

      // Legacy fallback for old rows without categoryId relation
      if (!linkedKey) {
        if (dbCat.includes('LAZER') || dbCat === 'LASER') finalKey = 'LASER';
        else if (dbCat.includes('AĞDA') || dbCat.includes('AGDA') || dbCat === 'WAX') finalKey = 'WAX';
        else if (dbCat.includes('TIRNAK') || dbCat.includes('MANİKÜR') || dbCat.includes('PEDİKÜR') || dbCat === 'NAIL') finalKey = 'NAIL';
        else if (dbCat.includes('CİLT') || dbCat.includes('YÜZ') || dbCat === 'FACIAL') finalKey = 'FACIAL';
        else if (dbCat.includes('MASAJ') || dbCat.includes('BODY') || dbCat.includes('VÜCUT')) finalKey = 'BODY';
        else if (dbCat.includes('SAÇ') || dbCat.includes('HAIR')) finalKey = 'HAIR';
        else if (dbCat.includes('MEDİKAL') || dbCat === 'MEDICAL') finalKey = 'MEDICAL';
        else if (dbCat.includes('DANIŞMANLIK') || dbCat === 'CONSULTATION') finalKey = 'CONSULTATION';
      }

      if (!groupedMap[finalKey]) {
        groupedMap[finalKey] = [];
      }

      const translated = translationMap.get(service.id);
      
      groupedMap[finalKey].push({
        id: service.id,
        name: translated?.name || service.name,
        description: translated?.description || service.description || null,
        duration: pricedByServiceId.get(service.id)?.duration ?? service.duration,
        price: pricedByServiceId.get(service.id)?.price ?? service.price,
        requiresSpecialist: service.requiresSpecialist || false,
        regionId: service.regionId,
        regionName: service.ServiceRegion?.name || null,
        regionCategoryId: service.ServiceRegion?.categoryId || null,
        campaignBadges: serviceBadgesFor(service.id),
      });
    });

    // 4. Use custom order if exists, otherwise default order
    const customOrder = settings?.categoryOrder as string[] | null;
    // Only trust ServiceCategory.displayOrder when the salon has actually
    // reordered (distinct values). A salon that never touched order has all
    // 0/null displayOrder — there we keep the curated CATEGORY_ORDER default
    // instead of an arbitrary insertion order.
    const hasExplicitCategoryOrder = new Set(categoryRows.map((c) => c.displayOrder ?? 0)).size > 1;
    const finalOrder = (customOrder && Array.isArray(customOrder) && customOrder.length > 0)
      ? customOrder
      : (hasExplicitCategoryOrder && dbCategoryOrder.length > 0 ? dbCategoryOrder : CATEGORY_ORDER);

    // 5. Build response
    const response = finalOrder
      .filter(key => groupedMap[key] && groupedMap[key].length > 0)
      .map(key => ({
        key: key,
        name: CATEGORIES[key] || key,
        services: groupedMap[key]
      }));

    // Add any categories present in DB but missing from the order (safety fallback)
    Object.keys(groupedMap).forEach(key => {
        if (!finalOrder.includes(key)) {
            response.push({
                key,
                name: CATEGORIES[key] || key,
                services: groupedMap[key]
            });
        }
    });

    res.json({
      locale,
      sourceLocale,
      categories: response,
    });
  } catch (error) {
    console.error('Error fetching grouped services:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/services/:serviceId/staff - Get staff for a specific service
router.get('/services/:serviceId/staff', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const { serviceId } = req.params;

  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Tenant context required', 400);
  }

  try {
    const staffServices = await prisma.staffService.findMany({
      where: {
        serviceId: parseInt(serviceId),
        Staff: { salonId },
        isactive: true
      },
      include: {
        Staff: {
          select: {
            id: true,
            // Legacy Staff profile columns are kept as a fallback
            // for orphan staff (no membership/identity). For
            // membership-linked staff the identity values win via
            // resolveStaffProfile.
            name: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true,
            title: true,
            membership: {
              select: {
                identity: {
                  select: {
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    profileImageUrl: true,
                  },
                },
              },
            },
          }
        }
      }
    });

    const response = staffServices.map(ss => {
      const resolved = resolveStaffProfile(ss.Staff, ss.Staff.membership?.identity ?? null);
      return {
        id: ss.Staff.id,
        name: resolved.name,
        title: ss.Staff.title || null,
        profileImageUrl: resolved.profileImageUrl,
        price: ss.price,
        duration: ss.duration,
      };
    });

    res.json({ staff: response });
  } catch (error) {
    console.error('Error fetching service-specific staff:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// POST /api/salon/services - Create a new service
router.post('/services', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const { name, duration, price, category, requiresSpecialist, regionId } = req.body;

  if (!name || !duration || price === undefined) {
    throw new BusinessError('VALIDATION_FAILED', 'Name, duration, and price are required', 400);
  }

  try {
    let parsedRegionId: number | null = null;
    if (regionId !== undefined && regionId !== null && regionId !== '') {
      parsedRegionId = Number(regionId);
      if (!Number.isInteger(parsedRegionId) || parsedRegionId <= 0) {
        throw new BusinessError('VALIDATION_FAILED', 'regionId must be a positive integer.', 400);
      }
      const regionExists = await prisma.serviceRegion.findFirst({
        where: { id: parsedRegionId, salonId: req.user.salonId },
        select: { id: true },
      });
      if (!regionExists) {
        throw new BusinessError('VALIDATION_FAILED', 'regionId is not valid for this salon.', 400);
      }
    }

    const service = await prisma.service.create({
      data: {
        name,
        duration: parseInt(duration),
        price: parseFloat(price),
        category: category || 'OTHER',
        requiresSpecialist: !!requiresSpecialist,
        salonId: req.user.salonId,
        regionId: parsedRegionId,
      },
    });

    // Kurulum yolculuğu: salon en az 5 hizmete ulaştıysa services_added_min_5
    // görevini işaretle. POST /services per-create çağrılır, bu yüzden 5.
    // hizmette bir kez tetiklenir (markTaskComplete idempotent).
    try {
      const count = await prisma.service.count({ where: { salonId: req.user.salonId } });
      if (count >= 5) {
        await markTaskComplete(req.user.salonId, 'services_added_min_5');
      }
    } catch (err) {
      console.error('[journey] services_added_min_5 mark failed', { salonId: req.user.salonId, err });
    }

    res.status(201).json({ service });
  } catch (error) {
    console.error('Error creating service:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/staff - Get authenticated salon's staff
router.get('/staff', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  try {
    const rows = await prisma.staff.findMany({
      where: { salonId: req.user.salonId },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        title: true,
        membership: {
          select: {
            identity: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                profileImageUrl: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const staff = rows.map((row) => {
      const resolved = resolveStaffProfile(row, row.membership?.identity ?? null);
      return {
        id: row.id,
        name: resolved.name,
        title: row.title || null,
        profileImageUrl: resolved.profileImageUrl,
      };
    });

    res.json({ staff });
  } catch (error) {
    console.error('Error fetching staff:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/staff/public - Get salon staff (public for tenant subdomain)
router.get('/staff/public', async (req: any, res: any) => {
  const salonId = req.salon?.id;

  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Tenant context required', 400);
  }

  try {
    const rows = await prisma.staff.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        title: true,
        membership: {
          select: {
            identity: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                profileImageUrl: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const staff = rows.map((row) => {
      const resolved = resolveStaffProfile(row, row.membership?.identity ?? null);
      return {
        id: row.id,
        name: resolved.name,
        title: row.title || null,
        profileImageUrl: resolved.profileImageUrl,
      };
    });

    res.json({ staff });
  } catch (error) {
    console.error('Error fetching staff:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// POST /api/salon/staff - Create a new staff member
router.post('/staff', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new BusinessError('VALIDATION_FAILED', 'Name is required and must be a non-empty string', 400);
  }

  try {
    const normalizedName = name.trim();
    const parts = splitStaffNameParts(normalizedName);
    const staff = await prisma.staff.create({
      data: {
        name: normalizedName,
        firstName: parts.firstName,
        lastName: parts.lastName,
        gender: 'other',
        salonId: req.user.salonId,
      },
    });

    // KURAL 4: seat count changed -> reconcile Stripe subscription quantity.
    // Best-effort + idempotent + no-op when seat billing is disabled.
    void syncSubscriptionQuantity(req.user.salonId).catch((err) => {
      console.error('[salon:staff:create] syncSubscriptionQuantity failed', err);
    });

    res.status(201).json({ staff });
  } catch (error) {
    console.error('Error creating staff:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// PUT /api/salon/staff/:id - Update specific staff member
router.put('/staff/:id', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const { id } = req.params;
  const { name } = req.body;

  try {
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      throw new BusinessError('NOT_FOUND', 'Staff member not found', 404);
    }

    const normalizedName = typeof name === 'string' ? name.trim() : '';
    if (!normalizedName) {
      throw new BusinessError('VALIDATION_FAILED', 'Name is required and must be a non-empty string', 400);
    }
    const parts = splitStaffNameParts(normalizedName);

    const updatedStaff = await prisma.staff.update({
      where: { id: parseInt(id) },
      data: {
        name: normalizedName,
        firstName: parts.firstName,
        lastName: parts.lastName,
      },
    });

    res.json({ staff: updatedStaff });
  } catch (error) {
    console.error('Error updating staff:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// DELETE /api/salon/staff/:id - Delete specific staff member
router.delete('/staff/:id', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const { id } = req.params;

  try {
    const existingStaff = await prisma.staff.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId
      }
    });

    if (!existingStaff) {
      throw new BusinessError('NOT_FOUND', 'Staff member not found', 404);
    }

    await prisma.staff.delete({
      where: { id: parseInt(id) },
    });

    // KURAL 4: seat count changed -> reconcile Stripe subscription quantity.
    void syncSubscriptionQuantity(req.user.salonId).catch((err) => {
      console.error('[salon:staff:delete] syncSubscriptionQuantity failed', err);
    });

    res.json({ message: 'Staff member deleted successfully' });
  } catch (error) {
    console.error('Error deleting staff:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/appointments - Get salon appointments
router.get('/appointments', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const { date, limit = '50', offset = '0' } = req.query;

  const targetDate = date ? new Date(date as string) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        salonId: req.user.salonId,
        startTime: {
          gte: startOfDay,
          lte: endOfDay
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
        startTime: 'asc'
      },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    res.json({
      appointments: appointments.map(apt => ({
        id: apt.id,
        datetime: apt.startTime,
        status: apt.status === 'BOOKED' ? 'CONFIRMED' : apt.status,
        customer: {
          name: apt.customerName,
          phone: apt.customerPhone
        },
        services: [{
          name: apt.service.name
        }]
      }))
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// POST /api/salon/appointments/:id/cancel - Cancel appointment
router.post('/appointments/:id/cancel', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const { id } = req.params;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: parseInt(id),
        salonId: req.user.salonId,
        status: 'BOOKED'
      },
      include: {
        customer: true,
        service: true
      }
    });

    if (!appointment) {
      throw new BusinessError('NOT_FOUND', 'Appointment not found or cannot be cancelled', 404);
    }

    if (appointment.startTime <= new Date()) {
      throw new BusinessError('VALIDATION_FAILED', 'Cannot cancel past appointments', 400);
    }

    const hoursUntilAppointment = (appointment.startTime.getTime() - Date.now()) / (1000 * 60 * 60);

    const { getSalonRiskConfig } = await import('../utils/behaviorTracking.js');
    const config = await getSalonRiskConfig(req.user.salonId);

    if (config?.isEnabled && config.lastMinuteHoursThreshold && hoursUntilAppointment < config.lastMinuteHoursThreshold && appointment.customerId) {
      const severityScore = calculateCancellationSeverity(hoursUntilAppointment);
      await logCustomerBehavior({
        customerId: appointment.customerId,
        salonId: req.user.salonId,
        appointmentId: appointment.id,
        behaviorType: BehaviorType.LAST_MINUTE_CANCELLATION,
        severityScore,
        metadata: {
          hoursUntilAppointment,
          appointmentDateTime: appointment.startTime,
          serviceName: appointment.service?.name
        }
      });
    }

    await prisma.appointment.update({
      where: { id: parseInt(id) },
      data: {
        status: 'CANCELLED',
        updatedAt: new Date()
      }
    });

    res.json({ message: 'Appointment cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling appointment:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

// GET /api/salon/slug-available?slug=xxx
// PUBLIC — onboarding sırasında auth olmadan da çağrılabilir.
// Slug uygunsa { available: true } döner; alınmışsa 3 alternatif önerir.
// Auth header gönderilmişse ve kullanıcının kendi salonu bu slug'a sahipse
// "available: true" döner (kendi slug'ına çakışma yaratmaz).
router.get('/slug-available', async (req: any, res: any) => {
  const rawSlug = String(req.query?.slug || '').trim().toLowerCase();
  if (!rawSlug || rawSlug.length < 3 || rawSlug.length > 40 || !SLUG_PATTERN.test(rawSlug)) {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'slug 3-40 karakter, sadece küçük harf, rakam ve tire içerebilir.',
      400,
    );
  }

  const normalized = slugify(rawSlug);

  const existing = await prisma.salon.findUnique({
    where: { slug: normalized },
    select: { id: true },
  });

  if (!existing) {
    return res.status(200).json({ available: true });
  }

  // Alternatif öner: salonadi-1, salonadi-2, salonadi-istanbul ... DB'de boş olanları al.
  const suggestions: string[] = [];
  for (let attempt = 1; attempt <= 20 && suggestions.length < 3; attempt += 1) {
    const candidate = withSlugCollision(normalized, attempt + 1);
    if (candidate === normalized) continue;
    const taken = await prisma.salon.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) suggestions.push(candidate);
  }

  return res.status(200).json({
    available: false,
    suggestions,
  });
});

// PATCH /api/salon/onboarding-step
// Onboarding wizard ilerleme adımını günceller. Body:
//   { step: OnboardingStep, skipped?: boolean }
// `skipped === true` ise current step `onboardingSkipped` array'ine (dedupe ile) eklenir.
// `step === 'COMPLETED'` ise onboardingStatus=COMPLETED ve onboardingCompletedAt set edilir.
router.patch('/onboarding-step', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }
  const body = req.body || {};

  const rawStep = body.step;
  if (rawStep === undefined || rawStep === null) {
    throw new BusinessError('VALIDATION_FAILED', 'step alanı zorunludur.', 400);
  }
  const step = String(rawStep).toUpperCase();
  if (!ONBOARDING_STEP_VALUES.has(step)) {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'step geçersiz bir OnboardingStep değeri.',
      400,
    );
  }

  const skipped = body.skipped === true;

  const data: Prisma.SalonUpdateInput = {
    onboardingStep: step as OnboardingStep,
  };

  if (step === 'COMPLETED') {
    data.onboardingStatus = 'COMPLETED' as OnboardingStatus;
    data.onboardingCompletedAt = new Date();
  } else if (step !== 'NOT_STARTED') {
    data.onboardingStatus = 'IN_PROGRESS' as OnboardingStatus;
  }

  if (skipped) {
    const current = await prisma.salon.findUnique({
      where: { id: req.user.salonId },
      select: { onboardingSkipped: true },
    });
    const existing = current?.onboardingSkipped ?? [];
    const next = Array.from(new Set([...existing, step]));
    data.onboardingSkipped = { set: next };
  }

  const updated = await prisma.salon.update({
    where: { id: req.user.salonId },
    data,
    select: {
      id: true,
      onboardingStep: true,
      onboardingSkipped: true,
    },
  });

  // Kurulum yolculuğu trigger: wizard 'COMPLETED' adımına ulaştığında salonun
  // journey'inde wizard_completed görevini işaretle. Bu journey servisinin
  // başarısız olması ana akışı bozmamalı.
  if (step === 'COMPLETED') {
    try {
      await markTaskComplete(req.user.salonId, 'wizard_completed');
    } catch (err) {
      console.error('[journey] wizard_completed mark failed', { salonId: req.user.salonId, err });
    }
  }

  return res.status(200).json({
    id: updated.id,
    onboardingStep: updated.onboardingStep,
    onboardingSkipped: updated.onboardingSkipped,
  });
});

export default router;
