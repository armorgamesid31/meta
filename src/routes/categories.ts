import { Router } from 'express';
import { prisma } from '../prisma.js';
import { normalizeLocale } from '../constants/locales.js';
import { buildCategoryMetadata } from '../services/seo.js';
import { resolveCategoryBySlug } from '../services/translations.js';

const router = Router();

function normalizeWhatsappPhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

router.get('/:slug/landing', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ message: 'Category slug is required' });
  }

  const locale = normalizeLocale(typeof req.query.locale === 'string' ? req.query.locale : null);

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        settings: {
          select: { contentSourceLocale: true },
        },
      },
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    const categoryMatch = await resolveCategoryBySlug({
      slug,
      locale,
      sourceLocale: salon.settings?.contentSourceLocale || 'tr',
    });

    if (!categoryMatch) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const serviceCategory = await prisma.serviceCategory.findFirst({
      where: {
        salonId,
        categoryId: categoryMatch.category.id,
      },
      include: {
        Service: {
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            duration: true,
            price: true,
            requiresSpecialist: true,
          },
        },
      },
    });

    if (!serviceCategory) {
      return res.status(404).json({ message: 'Category is not offered by this salon' });
    }

    const normalizedWhatsappPhone = normalizeWhatsappPhone(salon.whatsappPhone);
    const bookingUrl =
      salon.bookingMode === 'WHATSAPP' && normalizedWhatsappPhone
        ? `https://wa.me/${normalizedWhatsappPhone}`
        : `/${locale}/booking`;

    const marketingDescription =
      serviceCategory.marketingDescription ||
      categoryMatch.localized.marketingDescription ||
      categoryMatch.category.defaultDescription ||
      `${categoryMatch.localized.name} hizmetlerinde uzman ekip ve modern uygulamalarla desteklenen bir deneyim.`;

    const benefits =
      categoryMatch.localized.benefits.length > 0
        ? categoryMatch.localized.benefits
        : [
            `Uzman ekip ile ${categoryMatch.localized.name.toLowerCase()} odakli uygulamalar`,
            'Salon standartlarina uygun hijyenik ve profesyonel hizmet deneyimi',
          ];

    const seo = buildCategoryMetadata({
      locale,
      categoryName: categoryMatch.localized.name,
      salonName: salon.name,
      categorySlug: categoryMatch.localized.slug,
      host: req.headers.host,
    });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      category: {
        id: categoryMatch.category.id,
        key: categoryMatch.category.key,
        slug: categoryMatch.localized.slug,
        name: categoryMatch.localized.name,
        image: serviceCategory.coverImageUrl || categoryMatch.category.defaultImageUrl,
        marketingDescription,
        benefits,
      },
      services: serviceCategory.Service.map((service) => ({
        id: service.id,
        name: service.name,
        duration: service.duration,
        price: service.price,
        requiresSpecialist: service.requiresSpecialist,
      })),
      cta: {
        bookingUrl,
      },
      seo,
    });
  } catch (error) {
    console.error('Error in category landing endpoint:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
