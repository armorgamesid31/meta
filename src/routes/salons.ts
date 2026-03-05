import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();
const DEFAULT_GALLERY_IMAGES = ['/placeholder.jpg', '/placeholder.jpg?slide=2', '/placeholder.jpg?slide=3'];

function normalizeWhatsappPhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

router.get('/:slug/homepage', async (req: any, res: any) => {
  const { slug } = req.params;

  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ message: 'Salon slug is required' });
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
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            marketingDescription: true,
            icon: true,
            displayOrder: true,
            _count: {
              select: {
                Service: true,
              },
            },
          },
        },
        staff: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            name: true,
            title: true,
            bio: true,
          },
        },
        galleryImages: {
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            imageUrl: true,
            altText: true,
            displayOrder: true,
          },
        },
        testimonials: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      return res.status(404).json({ message: 'Salon not found' });
    }

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
                    'Professional team, clean environment, and excellent service quality. Highly recommended.',
                  isGenerated: true,
                  expert: null,
                  category: null,
                },
              ];
            }

            categories.forEach((category, index) => {
              const expert = experts[index % experts.length];
              generated.push({
                id: `generated-${index + 1}`,
                templateType: 'CATEGORY_EXPERT',
                generatedText: `${expert.name} was incredibly professional and attentive. I highly recommend this salon for ${category.name} treatments.`,
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
        },
      },
      categories: salon.ServiceCategory.map((category) => ({
        id: category.id,
        name: category.name,
        marketingDescription: category.marketingDescription,
        icon: category.icon,
        displayOrder: category.displayOrder,
        serviceCount: category._count.Service,
      })),
      experts: salon.staff.map((expert) => ({
        id: expert.id,
        name: expert.name,
        title: expert.title,
        bio: expert.bio,
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
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
