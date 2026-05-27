import { Router } from 'express';
import { UserRole, SalonCategory } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { BusinessError } from '../lib/errors.js';
import { resolveStaffProfile } from '../services/staffProfileResolver.js';
import { authenticateIdentity } from '../middleware/auth.js';
import { createAuthTokens } from '../services/mobileAuth.js';
import { ensureSalonServiceCategories } from '../services/salonCategorySetup.js';
import { ensureSalonAccessSeed } from '../services/accessControl.js';
import { startSetupPeriod } from '../services/onboarding/lifecycle.js';
import { ensureSalonReferralCode, attachReferredSalon } from '../services/referralService.js';
import {
  PRESET_DEFAULT_BRAND,
  deriveTones,
  isPresetId,
  type PresetId,
  type ResolvedThemeTokens,
} from '../lib/theme/derive.js';

const router = Router();
const DEFAULT_GALLERY_IMAGES = ['/placeholder.jpg', '/placeholder.jpg?slide=2', '/placeholder.jpg?slide=3'];
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6];
const GENERIC_TESTIMONIAL_TEMPLATES = [
  'Çok tatlı bir ekip var, insan kendini gerçekten rahat hissediyor. Ben çok sevdim 😊',
  'İlk kez gittim ama sanki daha önce gitmişim gibi rahat ettim. Çok güzel ilgilendiler.',
  'Temiz, düzenli ve ilgili bir salon. Genel olarak iyi bir deneyimdi.',
  'Randevu süreci de hizmet de sorunsuz geçti. Bence gayet iyi bir yer.',
  'Memnun kaldım, özellikle çalışanların ilgisi güzeldi.',
];
const SERVICE_ONLY_TESTIMONIAL_TEMPLATES = [
  '{service} hizmetinden gerçekten çok memnun kaldım. Sonuç beklediğimden de güzel oldu.',
  '{service} için iyi ki burayı tercih etmişim dedim. Sonuç tam içime sindi.',
  'Açıkçası {service} bu kadar iyi olur mu diye düşünüyordum ama çok beğendim.',
  '{service} hizmeti beklentimin üstündeydi. Çıkarken gerçekten mutlu ayrıldım.',
  '{service} için gittim, çok güzel ilgilendiler. Ortam da baya rahattı 😊',
  '{service} süreci çok rahat geçti, hiç kasılmadan hizmet aldım diyebilirim.',
  '{service} hizmetinden memnun kaldım. Süreç gayet temiz ve özenliydi.',
  'Genel olarak {service} deneyimim güzeldi. Tekrar tercih edebilirim.',
  '{service} için geldim, valla beklediğimden çok daha güzel oldu. Ellerine sağlık 🌸',
  '{service} sonucuna bayıldım desem abartmış olmam. Çok tatlı ilgilendiler, çok memnun kaldım.',
];
const SERVICE_EXPERT_TESTIMONIAL_TEMPLATES = [
  '{expert} gerçekten harika ilgilendi. {service} sonucu tam istediğim gibi oldu, çok beğendim 😊',
  '{expert} o kadar tatlı ve özenliydi ki süreç çok rahat geçti. {service} için kesinlikle yine gelirim.',
  '{expert} ne istediğimi hemen anladı, {service} sonucunu da baya beğendim. Ellerine sağlık.',
  '{expert} sağolsun çok güzel ilgilendi. {service} beklediğimden daha iyi oldu, içime sindi.',
  '{expert} hem çok samimiydi hem de işini gerçekten güzel yaptı. {service} sonucuna bayıldım ✨',
];

function normalizeWhatsappPhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

function normalizeServiceNameForCopy(name?: string | null): string {
  const value = (name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr-TR');
  return value;
}

function formatExpertReferenceForTestimonial(expert: {
  name?: string | null;
  firstName?: string | null;
  gender?: 'female' | 'male' | 'other' | null;
}): string {
  const firstName = String(expert?.firstName || '').trim();
  if (firstName) {
    if (expert.gender === 'female') return `${firstName} Hanım`;
    if (expert.gender === 'male') return `${firstName} Bey`;
    return firstName;
  }
  return String(expert?.name || 'Uzman').trim() || 'Uzman';
}

function fillTemplate(template: string, values: { expert?: string; service?: string }): string {
  return template
    .replaceAll('{expert}', values.expert || 'Uzman')
    .replaceAll('{service}', values.service || 'hizmet');
}

// Authenticated salon creation. The caller's UserIdentity becomes the
// OWNER. Replaces the legacy POST /api/auth/register-salon by letting
// users register first (identity-only token) and create the salon
// from inside the app/web panel afterwards.
const SALON_CATEGORY_VALUES = Object.values(SalonCategory) as [SalonCategory, ...SalonCategory[]];
const createSalonSchema = z.object({
  salonName: z.string().trim().min(2).max(120),
  salonCategory: z.enum(SALON_CATEGORY_VALUES).optional(),
  referralCode: z.string().trim().max(64).optional(),
});

router.post('/', authenticateIdentity, async (req: any, res: any) => {
  const parsed = createSalonSchema.safeParse(req.body || {});
  if (!parsed.success) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon bilgileri eksik.', 400, {
      issues: parsed.error.issues,
    });
  }
  const identity = req.identity as { identityId: number; email: string | null; phone: string | null };
  if (!identity?.identityId) {
    throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);
  }

  const identityRow = await prisma.userIdentity.findUnique({
    where: { id: identity.identityId },
    select: {
      id: true,
      email: true,
      phone: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
      firstName: true,
      lastName: true,
      displayName: true,
      passwordHash: true,
    },
  });
  if (!identityRow) {
    throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);
  }

  // Second gate against the verification bypass we caught in prod
  // (referral signup minted a salon for identity #1 whose phone +
  // email were both stamped but never verified — `activateOnboarding`
  // had the right guard but the identity already existed from the
  // legacy `/api/auth/register-salon` path which never checked).
  // Salon creation is the right place to lock this down: it's a
  // one-time per-identity action, and anyone reaching it without
  // verification has skipped a step.
  if (!identityRow.phoneVerifiedAt) {
    throw new BusinessError(
      'PHONE_NOT_VERIFIED',
      'Telefon numaranızı doğrulamadan salon oluşturamazsınız.',
      403,
    );
  }
  if (!identityRow.emailVerifiedAt) {
    throw new BusinessError(
      'EMAIL_NOT_VERIFIED',
      'E-posta adresinizi doğrulamadan salon oluşturamazsınız.',
      403,
    );
  }

  const salonName = parsed.data.salonName;
  const salonCategory = parsed.data.salonCategory ?? null;

  const created = await prisma.$transaction(async (tx) => {
    const salon = await tx.salon.create({
      data: {
        name: salonName,
        ...(salonCategory ? { category: salonCategory } : {}),
      },
    });

    // Mirror the legacy SalonUser row so downstream queries that still
    // join through the legacy table keep working.
    const legacyUser = await tx.salonUser.create({
      data: {
        salonId: salon.id,
        email: identityRow.email || '',
        phone: identityRow.phone || null,
        firstName: identityRow.firstName || null,
        lastName: identityRow.lastName || null,
        displayName: identityRow.displayName || null,
        passwordHash: identityRow.passwordHash,
        role: UserRole.OWNER,
        isActive: true,
        activationCompletedAt: new Date(),
      },
    });

    const membership = await tx.salonMembership.create({
      data: {
        salonId: salon.id,
        identityId: identityRow.id,
        role: UserRole.OWNER,
        isActive: true,
        legacySalonUserId: legacyUser.id,
      },
    });

    return { salon, legacyUser, membership };
  });

  // Best-effort setup tasks — failures here shouldn't block the user.
  try {
    await ensureSalonServiceCategories(created.salon.id);
  } catch (err) {
    console.error('[salons:create] ensureSalonServiceCategories failed', err);
  }
  try {
    await ensureSalonAccessSeed(created.salon.id);
  } catch (err) {
    console.error('[salons:create] ensureSalonAccessSeed failed', err);
  }
  // Reviewer accounts (App Store / Play Console review team) need
  // full access without hitting the 14-day setup clock — reviewers
  // typically test signup + a few core flows in one sitting and
  // would otherwise see a PAYMENT_REQUIRED lockout before they
  // approve the app. Pin their salon to ACTIVE_PAID up front; the
  // lifecycle cron only scans SETUP/BONUS/GRACE so it'll never
  // touch this row again. Comma-separated env list of identity
  // emails — typically the per-store reviewer fake account(s).
  const reviewerEmails = (process.env.REVIEWER_IDENTITY_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isReviewer =
    identityRow.email && reviewerEmails.includes(identityRow.email.toLowerCase());

  if (isReviewer) {
    try {
      await prisma.salon.update({
        where: { id: created.salon.id },
        data: { setupAccessStatus: 'ACTIVE_PAID', status: 'ACTIVE' },
      });
    } catch (err) {
      console.error('[salons:create] reviewer pinning failed', err);
    }
  } else {
    try {
      await startSetupPeriod(created.salon.id);
    } catch (err) {
      console.error('[salons:create] startSetupPeriod failed', err);
    }
  }
  // Mint this salon's own referral code so it can refer others. The
  // reward for the *referrer* (this salon's introducer, if any) lands
  // below.
  try {
    await ensureSalonReferralCode(created.salon.id);
  } catch (err) {
    console.error('[salons:create] ensureSalonReferralCode failed', err);
  }
  // If the caller pasted a referral code at signup, link this new
  // salon as the referee and queue a PENDING reward for the referrer.
  // Reward is only granted (status → REWARDED) once this salon
  // converts to ACTIVE_PAID — see stripeBilling subscription webhook.
  if (parsed.data.referralCode) {
    try {
      const result = await attachReferredSalon({
        referralCode: parsed.data.referralCode,
        referredSalonId: created.salon.id,
      });
      if (!result.linked) {
        console.info('[salons:create] referral not linked', {
          reason: result.reason,
          code: parsed.data.referralCode,
        });
      }
    } catch (err) {
      console.error('[salons:create] attachReferredSalon failed', err);
    }
  }

  // Issue a full salon-scoped token; the client should replace the
  // identity-only token it currently holds.
  const tokens = await createAuthTokens({
    legacyUserId: created.legacyUser.id,
    identityId: identityRow.id,
    membershipId: created.membership.id,
    salonId: created.salon.id,
    role: UserRole.OWNER,
  });

  return res.status(201).json({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    salon: {
      id: created.salon.id,
      name: created.salon.name,
      slug: created.salon.slug,
    },
    user: {
      id: identityRow.id,
      membershipId: created.membership.id,
      email: identityRow.email,
      role: UserRole.OWNER,
      salonId: created.salon.id,
    },
  });
});

// Schedule salon deletion. 30-day grace. Caller must be an OWNER
// of the salon. If the salon has an active Stripe subscription
// the deletion is blocked — the user is told to cancel billing
// first via the Stripe customer portal, which keeps Kedy's
// subscription state aligned with Stripe's.
router.post('/:id/delete', authenticateIdentity, async (req: any, res: any) => {
  const salonId = Number(req.params.id);
  const identityId = Number(req.identity?.identityId || 0);
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz salon id.', 400);
  }
  if (!identityId) throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);

  // Owner check
  const membership = await prisma.salonMembership.findFirst({
    where: { salonId, identityId, role: 'OWNER', isActive: true },
    select: { id: true },
  });
  if (!membership) {
    throw new BusinessError('FORBIDDEN', 'Bu salonu yalnızca OWNER silebilir.', 403);
  }

  // Active subscription guard
  const sub = await prisma.salonSubscription.findFirst({
    where: { salonId, status: { in: ['active', 'trialing', 'past_due'] } },
    select: { id: true, status: true, stripeSubscriptionId: true },
  });
  if (sub && sub.stripeSubscriptionId) {
    return res.status(409).json({
      code: 'SUBSCRIPTION_ACTIVE',
      message: 'Aktif aboneliğin var. Önce Stripe üzerinden iptal etmen lazım.',
      subscriptionStatus: sub.status,
    });
  }

  const { scheduleSalonDeletion } = await import('../services/deletionService.js');
  const { scheduledAt } = await scheduleSalonDeletion({ salonId, initiatedByIdentityId: identityId });
  return res.json({ deletionScheduledAt: scheduledAt.toISOString() });
});

router.post('/:id/cancel-deletion', authenticateIdentity, async (req: any, res: any) => {
  const salonId = Number(req.params.id);
  const identityId = Number(req.identity?.identityId || 0);
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz salon id.', 400);
  }
  if (!identityId) throw new BusinessError('UNAUTHORIZED', 'Kimlik bulunamadı.', 401);

  const membership = await prisma.salonMembership.findFirst({
    where: { salonId, identityId, role: 'OWNER', isActive: true },
    select: { id: true },
  });
  if (!membership) {
    throw new BusinessError('FORBIDDEN', 'Sadece OWNER silme işlemini iptal edebilir.', 403);
  }

  const { cancelSalonDeletion } = await import('../services/deletionService.js');
  await cancelSalonDeletion(salonId);
  return res.json({ ok: true });
});

router.get('/:slug/homepage', async (req: any, res: any) => {
  const { slug } = req.params;

  if (!slug || typeof slug !== 'string') {
    throw new BusinessError('VALIDATION_FAILED', 'Salon slug is required', 400);
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { slug: slug.toLowerCase() },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        tagline: true,
        about: true,
        heroImageUrl: true,
        instagramUrl: true,
        whatsappPhone: true,
        bookingMode: true,
        address: true,
        googleMapsUrl: true,
        city: true,
        district: true,
        themePreset: true,
        brandColor: true,
        themeUpdatedAt: true,
        themeResolved: true,
        settings: {
          select: {
            workStartHour: true,
            workEndHour: true,
            timezone: true,
          },
        },
        ServiceCategory: {
          where: {
            Service: {
              some: {},
            },
          },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            marketingDescription: true,
            icon: true,
            coverImageUrl: true,
            displayOrder: true,
            _count: {
              select: {
                Service: true,
              },
            },
            Service: {
              where: {
                isActive: true,
              },
              orderBy: [{ id: 'asc' }],
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        staff: {
          orderBy: { id: 'asc' },
          take: 30,
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            gender: true,
            title: true,
            bio: true,
            profileImageUrl: true,
            // Pull the linked identity for the cross-salon profile
            // resolver. Orphan staff (no membership) fall back to
            // the Staff columns above.
            membership: {
              select: {
                identity: {
                  select: {
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    gender: true,
                    profileImageUrl: true,
                  },
                },
              },
            },
            // NOTE: StaffService is used here for testimonial-category matching only;
            // 10 is enough to find a category match. For the full staff-service mapping
            // a dedicated endpoint should be used (TODO: GET /api/salons/:slug/staff/:id/services).
            StaffService: {
              take: 10,
              select: {
                serviceId: true,
                Service: {
                  select: {
                    categoryId: true,
                  },
                },
              },
            },
          },
        },
        galleryImages: {
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          take: 24,
          select: {
            id: true,
            imageUrl: true,
            altText: true,
            displayOrder: true,
            categoryId: true,
          },
        },
        testimonials: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 12,
          select: {
            id: true,
            templateType: true,
            generatedText: true,
            isGenerated: true,
            expert: {
              select: {
                id: true,
                name: true,
                title: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!salon) {
      throw new BusinessError('NOT_FOUND', 'Salon not found', 404);
    }

    const workingDayRows = await prisma.staffWorkingHours.findMany({
      where: {
        Staff: {
          salonId: salon.id,
        },
      },
      distinct: ['dayOfWeek'],
      select: {
        dayOfWeek: true,
      },
    });

    const workingDays = workingDayRows
      .map((row) => row.dayOfWeek)
      .filter((day): day is number => typeof day === 'number')
      .sort((a, b) => a - b);

    const bookingMode = salon.bookingMode || 'INTERNAL';
    const normalizedWhatsappPhone = normalizeWhatsappPhone(salon.whatsappPhone);
    const bookingUrl =
      bookingMode === 'WHATSAPP' && normalizedWhatsappPhone
        ? `https://wa.me/${normalizedWhatsappPhone}`
        : '/randevu';

    const themePreset: PresetId = isPresetId(salon.themePreset) ? salon.themePreset : 'classic';
    const themeBrandColor = salon.brandColor || PRESET_DEFAULT_BRAND[themePreset];
    const themeResolved: ResolvedThemeTokens =
      (salon.themeResolved as unknown as ResolvedThemeTokens | null) ??
      deriveTones(PRESET_DEFAULT_BRAND[themePreset], themePreset);
    const theme = {
      preset: themePreset,
      brandColor: themeBrandColor,
      logoUrl: salon.logoUrl,
      resolved: themeResolved,
    };

    const gallery =
      salon.galleryImages.length > 0
        ? salon.galleryImages.map((item) => ({
            id: item.id,
            imageUrl: item.imageUrl,
            altText: item.altText,
            displayOrder: item.displayOrder,
            // Surfaces the per-photo category binding the mobile admin
            // writes; the public site uses it to assemble per-category
            // slide groups in the Stories viewer.
            categoryId: item.categoryId ?? null,
          }))
        : DEFAULT_GALLERY_IMAGES.map((imageUrl, index) => ({
            id: `fallback-${index + 1}`,
            imageUrl,
            altText: `${salon.name} gallery image ${index + 1}`,
            displayOrder: index,
            categoryId: null,
          }));

    const testimonials =
      salon.testimonials.length > 0
        ? salon.testimonials.map((item) => ({
            id: item.id,
            templateType: item.templateType,
            generatedText: item.generatedText,
            isGenerated: item.isGenerated,
            expert: item.expert,
            category: item.category,
          }))
        : (() => {
            const categories = salon.ServiceCategory.slice(0, 3);
            const experts = salon.staff.slice(0, 3);
            const generated: any[] = [];

            if (categories.length === 0 || experts.length === 0) {
            return [
              {
                id: 'generated-1',
                  templateType: 'GENERIC',
                  generatedText:
                    'Profesyonel ekip, hijyenik ortam ve yüksek hizmet kalitesiyle çok memnun kaldım. Kesinlikle tavsiye ederim.',
                  isGenerated: true,
                  expert: null,
                  category: null,
                },
              ];
            }

            categories.forEach((category, index) => {
              const matchedExperts = experts.filter((expert) =>
                expert.StaffService.some((staffService) => staffService.Service?.categoryId === category.id),
              );
              const fallbackExperts = matchedExperts.length > 0 ? matchedExperts : experts;
              const expert = fallbackExperts[index % fallbackExperts.length];
              const preferredServiceName = normalizeServiceNameForCopy(category.Service[0]?.name);
              const expertReference = formatExpertReferenceForTestimonial(expert);
              const useServiceExpert = Boolean(preferredServiceName) && index % 2 === 0;
              const template = useServiceExpert
                ? SERVICE_EXPERT_TESTIMONIAL_TEMPLATES[index % SERVICE_EXPERT_TESTIMONIAL_TEMPLATES.length]
                : preferredServiceName
                  ? SERVICE_ONLY_TESTIMONIAL_TEMPLATES[index % SERVICE_ONLY_TESTIMONIAL_TEMPLATES.length]
                  : GENERIC_TESTIMONIAL_TEMPLATES[index % GENERIC_TESTIMONIAL_TEMPLATES.length];

              generated.push({
                id: `generated-${index + 1}`,
                templateType: useServiceExpert ? 'SERVICE_EXPERT' : preferredServiceName ? 'SERVICE_ONLY' : 'GENERIC',
                generatedText: fillTemplate(template, {
                  expert: expertReference,
                  service: preferredServiceName || 'hizmet',
                }),
                isGenerated: true,
                expert: {
                  id: expert.id,
                  name: expert.name,
                  title: expert.title,
                },
                category: {
                  id: category.id,
                  name: category.name,
                },
              });
            });

            return generated;
          })();

    const coverImageByCategoryId = new Map<number, string>();
    for (const image of salon.galleryImages) {
      if (!image.categoryId) continue;
      if (!coverImageByCategoryId.has(image.categoryId)) {
        coverImageByCategoryId.set(image.categoryId, image.imageUrl);
      }
    }

    res.status(200).json({
      salon: {
        id: salon.id,
        slug: salon.slug,
        name: salon.name,
        logoUrl: salon.logoUrl,
        tagline: salon.tagline,
        about: salon.about,
        heroImageUrl: salon.heroImageUrl,
        instagramUrl: salon.instagramUrl,
        address: salon.address,
        googleMapsUrl: salon.googleMapsUrl,
        city: salon.city,
        district: salon.district,
        workingHours: {
          workStartHour: salon.settings?.workStartHour ?? 9,
          workEndHour: salon.settings?.workEndHour ?? 18,
          timezone: salon.settings?.timezone ?? 'Europe/Istanbul',
          workingDays: workingDays.length > 0 ? workingDays : DEFAULT_WORKING_DAYS,
        },
      },
      categories: salon.ServiceCategory.map((category) => ({
        id: category.id,
        name: category.name,
        marketingDescription: category.marketingDescription,
        icon: category.icon,
        coverImageUrl: category.coverImageUrl || coverImageByCategoryId.get(category.id) || null,
        displayOrder: category.displayOrder,
        serviceCount: category._count.Service,
      })),
      experts: salon.staff.map((expert) => {
        const resolved = resolveStaffProfile(expert, expert.membership?.identity ?? null);
        return {
          id: expert.id,
          name: resolved.name,
          title: expert.title,
          bio: expert.bio,
          profileImageUrl: resolved.profileImageUrl,
        };
      }),
      gallery,
      testimonials,
      booking: {
        mode: bookingMode,
        whatsappPhone: normalizedWhatsappPhone,
        bookingUrl,
      },
      theme,
    });
  } catch (error) {
    console.error('Error loading salon homepage:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

export default router;
