import { ContentSurface } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../constants/locales.js';
import { resolveRuntimeContent } from '../services/content.js';

const router = Router();
const CONTENT_SURFACES = new Set<string>(Object.values(ContentSurface));

function parseSurface(value: unknown): ContentSurface | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!CONTENT_SURFACES.has(normalized)) {
    return null;
  }

  return normalized as ContentSurface;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseCacheSeconds(): number {
  const fallback = 60;
  const raw = process.env.CONTENT_RUNTIME_CACHE_SECONDS;
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

async function resolveRuntimeSalonId(req: any): Promise<number | null> {
  if (req.salon?.id) {
    return req.salon.id as number;
  }

  const headerSalonRaw = Array.isArray(req.headers['x-salon-id'])
    ? req.headers['x-salon-id'][0]
    : req.headers['x-salon-id'];
  const headerSalonId = parsePositiveInt(headerSalonRaw);
  if (headerSalonId) {
    return headerSalonId;
  }

  const salonId = parsePositiveInt(req.query.salonId);
  if (salonId) {
    return salonId;
  }

  const tenantSlugRaw =
    typeof req.query.tenantSlug === 'string'
      ? req.query.tenantSlug
      : typeof req.headers['x-tenant-slug'] === 'string'
      ? req.headers['x-tenant-slug']
      : '';

  const tenantSlug = tenantSlugRaw.trim().toLowerCase();
  if (!tenantSlug) {
    return null;
  }

  const salon = await prisma.salon.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  return salon?.id || null;
}

router.get('/runtime', async (req: any, res: any) => {
  const surface = parseSurface(req.query.surface);
  const page = typeof req.query.page === 'string' ? req.query.page.trim() : '';

  if (!surface) {
    return res.status(400).json({
      message: 'surface is required and must be a valid ContentSurface',
      validSurfaces: Array.from(CONTENT_SURFACES),
    });
  }

  if (!page) {
    return res.status(400).json({ message: 'page is required' });
  }

  const locale = normalizeLocale(typeof req.query.locale === 'string' ? req.query.locale : DEFAULT_LOCALE);
  const fallbackLocale = normalizeLocale(
    typeof req.query.fallbackLocale === 'string' ? req.query.fallbackLocale : DEFAULT_LOCALE,
  );

  try {
    const salonId = await resolveRuntimeSalonId(req);

    const result = await resolveRuntimeContent({
      surface,
      page,
      locale,
      fallbackLocale,
      salonId,
    });

    const ttl = parseCacheSeconds();
    res.setHeader('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=${ttl * 3}`);

    return res.status(200).json({
      surface: result.surface,
      page: result.page,
      requestedLocale: result.requestedLocale,
      fallbackLocale: result.fallbackLocale,
      salonId: result.salonId,
      totalKeys: Object.keys(result.values).length,
      values: result.values,
      meta: result.meta,
    });
  } catch (error) {
    console.error('Error resolving runtime content:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
