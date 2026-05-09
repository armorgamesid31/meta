import { Router } from 'express';
import { prisma } from '../prisma.js';
import { normalizeLocale } from '../constants/locales.js';
import { slugify } from '../utils/slug.js';
import { BusinessError } from '../lib/errors.js';

const router = Router();

const ENTITY_TYPES = new Set(['SALON', 'CATEGORY', 'EXPERT', 'TEMPLATE', 'UI']);
const STATUS_TYPES = new Set(['DRAFT', 'REVIEWED', 'APPROVED']);

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) return true;
  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

router.post('/batch', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized', 401);
  }

  const payload = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new BusinessError('VALIDATION_FAILED', 'Body must be a non-empty array or { items: [...] }', 400);
  }

  let inserted = 0;
  let updated = 0;
  const rejected: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < payload.length; i += 1) {
    const row = payload[i] || {};
    const entityType = typeof row.entityType === 'string' ? row.entityType.toUpperCase() : null;
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    const textRaw = typeof row.text === 'string' ? row.text.trim() : '';
    const locale = normalizeLocale(typeof row.locale === 'string' ? row.locale : null);
    const sourceLocale = normalizeLocale(typeof row.sourceLocale === 'string' ? row.sourceLocale : locale);
    const status = typeof row.status === 'string' ? row.status.toUpperCase() : 'DRAFT';
    const version = Number.isInteger(row.version) && row.version > 0 ? Number(row.version) : 1;
    const entityId = Number(row.entityId);

    if (!entityType || !ENTITY_TYPES.has(entityType)) {
      rejected.push({ index: i, reason: 'Invalid entityType' });
      continue;
    }

    if (!Number.isInteger(entityId) || entityId <= 0) {
      rejected.push({ index: i, reason: 'Invalid entityId' });
      continue;
    }

    if (!key) {
      rejected.push({ index: i, reason: 'Missing key' });
      continue;
    }

    if (!textRaw && key !== 'slug') {
      rejected.push({ index: i, reason: 'Missing text' });
      continue;
    }

    if (!STATUS_TYPES.has(status)) {
      rejected.push({ index: i, reason: 'Invalid status' });
      continue;
    }

    const text = key === 'slug' ? slugify(textRaw || row.fallbackText || `${entityType}-${entityId}`, locale) : textRaw;

    try {
      const existing = await prisma.translation.findUnique({
        where: {
          entityType_entityId_key_locale_version: {
            entityType: entityType as any,
            entityId,
            key,
            locale: locale as any,
            version,
          },
        },
      });

      await prisma.translation.upsert({
        where: {
          entityType_entityId_key_locale_version: {
            entityType: entityType as any,
            entityId,
            key,
            locale: locale as any,
            version,
          },
        },
        update: {
          sourceLocale: sourceLocale as any,
          text,
          status: status as any,
        },
        create: {
          entityType: entityType as any,
          entityId,
          key,
          locale: locale as any,
          sourceLocale: sourceLocale as any,
          text,
          status: status as any,
          version,
        },
      });

      if (existing) updated += 1;
      else inserted += 1;
    } catch (error: any) {
      rejected.push({ index: i, reason: error?.message || 'Unknown DB error' });
    }
  }

  return res.status(200).json({
    inserted,
    updated,
    rejected,
  });
});

export default router;
