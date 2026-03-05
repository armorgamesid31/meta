import { Router } from 'express';
import { prisma } from '../prisma.js';
import { normalizeLocale } from '../constants/locales.js';
import { buildCategoryCityMetadata, buildCategoryLocationMetadata } from '../services/seo.js';
import { resolveCategoryBySlug } from '../services/translations.js';

const router = Router();

function normalizeSlug(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function normalizeWhatsappPhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '');
}

async function loadTenantSalon(salonId: number) {
  return prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      settings: {
        select: { contentSourceLocale: true },
      },
      ServiceCategory: {
        include: {
          Service: {
            select: { id: true },
          },
        },
      },
    },
  });
}

router.get('/category-city', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  const categorySlug = normalizeSlug(typeof req.query.categorySlug === 'string' ? req.query.categorySlug : null);
  const citySlug = normalizeSlug(typeof req.query.citySlug === 'string' ? req.query.citySlug : null);
  const locale = normalizeLocale(typeof req.query.locale === 'string' ? req.query.locale : null);

  if (!categorySlug || !citySlug) {
    return res.status(400).json({ message: 'categorySlug and citySlug are required' });
  }

  try {
    const salon = await loadTenantSalon(salonId);
    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    if (normalizeSlug(salon.citySlug) !== citySlug) {
      return res.status(404).json({ message: 'City landing not found for this tenant' });
    }

    const categoryMatch = await resolveCategoryBySlug({
      slug: categorySlug,
      locale,
      sourceLocale: salon.settings?.contentSourceLocale || 'tr',
    });

    if (!categoryMatch) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const serviceCategory = salon.ServiceCategory.find((cat) => cat.categoryId === categoryMatch.category.id);
    if (!serviceCategory) {
      return res.status(404).json({ message: 'Category is not offered by this salon' });
    }

    const normalizedWhatsappPhone = normalizeWhatsappPhone(salon.whatsappPhone);
    const bookingUrl =
      salon.bookingMode === 'WHATSAPP' && normalizedWhatsappPhone
        ? `https://wa.me/${normalizedWhatsappPhone}`
        : `/${locale}/booking`;

    const seo = buildCategoryCityMetadata({
      locale,
      categoryName: categoryMatch.localized.name,
      salonName: salon.name,
      categorySlug: categoryMatch.localized.slug,
      cityName: salon.city,
      citySlug,
      host: req.headers.host,
    });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      category: {
        id: categoryMatch.category.id,
        key: categoryMatch.category.key,
        slug: categoryMatch.localized.slug,
        name: categoryMatch.localized.name,
        marketingDescription:
          serviceCategory.marketingDescription ||
          categoryMatch.localized.marketingDescription ||
          categoryMatch.category.defaultDescription,
        image: serviceCategory.coverImageUrl || categoryMatch.category.defaultImageUrl,
      },
      city: {
        name: salon.city,
        slug: citySlug,
      },
      salons: [
        {
          id: salon.id,
          slug: salon.slug,
          name: salon.name,
          logoUrl: salon.logoUrl,
          city: salon.city,
          district: salon.district,
          bookingUrl,
          serviceCount: serviceCategory.Service.length,
        },
      ],
      seo,
    });
  } catch (error) {
    console.error('Error in category-city SEO endpoint:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/category-location', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    return res.status(400).json({ message: 'Tenant context required' });
  }

  const categorySlug = normalizeSlug(typeof req.query.categorySlug === 'string' ? req.query.categorySlug : null);
  const citySlug = normalizeSlug(typeof req.query.citySlug === 'string' ? req.query.citySlug : null);
  const districtSlug = normalizeSlug(typeof req.query.districtSlug === 'string' ? req.query.districtSlug : null);
  const locale = normalizeLocale(typeof req.query.locale === 'string' ? req.query.locale : null);

  if (!categorySlug || !citySlug || !districtSlug) {
    return res.status(400).json({ message: 'categorySlug, citySlug and districtSlug are required' });
  }

  try {
    const salon = await loadTenantSalon(salonId);
    if (!salon) {
      return res.status(404).json({ message: 'Salon not found' });
    }

    if (normalizeSlug(salon.citySlug) !== citySlug || normalizeSlug(salon.districtSlug) !== districtSlug) {
      return res.status(404).json({ message: 'Location landing not found for this tenant' });
    }

    const categoryMatch = await resolveCategoryBySlug({
      slug: categorySlug,
      locale,
      sourceLocale: salon.settings?.contentSourceLocale || 'tr',
    });

    if (!categoryMatch) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const serviceCategory = salon.ServiceCategory.find((cat) => cat.categoryId === categoryMatch.category.id);
    if (!serviceCategory) {
      return res.status(404).json({ message: 'Category is not offered by this salon' });
    }

    const normalizedWhatsappPhone = normalizeWhatsappPhone(salon.whatsappPhone);
    const bookingUrl =
      salon.bookingMode === 'WHATSAPP' && normalizedWhatsappPhone
        ? `https://wa.me/${normalizedWhatsappPhone}`
        : `/${locale}/booking`;

    const seo = buildCategoryLocationMetadata({
      locale,
      categoryName: categoryMatch.localized.name,
      salonName: salon.name,
      categorySlug: categoryMatch.localized.slug,
      cityName: salon.city,
      citySlug,
      districtName: salon.district,
      districtSlug,
      host: req.headers.host,
    });

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      category: {
        id: categoryMatch.category.id,
        key: categoryMatch.category.key,
        slug: categoryMatch.localized.slug,
        name: categoryMatch.localized.name,
        marketingDescription:
          serviceCategory.marketingDescription ||
          categoryMatch.localized.marketingDescription ||
          categoryMatch.category.defaultDescription,
        image: serviceCategory.coverImageUrl || categoryMatch.category.defaultImageUrl,
      },
      location: {
        city: {
          name: salon.city,
          slug: citySlug,
        },
        district: {
          name: salon.district,
          slug: districtSlug,
        },
      },
      salons: [
        {
          id: salon.id,
          slug: salon.slug,
          name: salon.name,
          logoUrl: salon.logoUrl,
          city: salon.city,
          district: salon.district,
          bookingUrl,
          serviceCount: serviceCategory.Service.length,
        },
      ],
      seo,
    });
  } catch (error) {
    console.error('Error in category-location SEO endpoint:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
