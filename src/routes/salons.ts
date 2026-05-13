import { Router } from 'express';
import { prisma } from '../prisma.js';
import { BusinessError } from '../lib/errors.js';

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
            gender: true,
            title: true,
            bio: true,
            profileImageUrl: true,
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

    const gallery =
      salon.galleryImages.length > 0
        ? salon.galleryImages.map((item) => ({
            id: item.id,
            imageUrl: item.imageUrl,
            altText: item.altText,
            displayOrder: item.displayOrder,
          }))
        : DEFAULT_GALLERY_IMAGES.map((imageUrl, index) => ({
            id: `fallback-${index + 1}`,
            imageUrl,
            altText: `${salon.name} gallery image ${index + 1}`,
            displayOrder: index,
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
      experts: salon.staff.map((expert) => ({
        id: expert.id,
        name: expert.name,
        title: expert.title,
        bio: expert.bio,
        profileImageUrl: expert.profileImageUrl,
      })),
      gallery,
      testimonials,
      booking: {
        mode: bookingMode,
        whatsappPhone: normalizedWhatsappPhone,
        bookingUrl,
      },
    });
  } catch (error) {
    console.error('Error loading salon homepage:', error);
    throw new BusinessError('INTERNAL_ERROR', 'Internal server error', 500);
  }
});

export default router;
