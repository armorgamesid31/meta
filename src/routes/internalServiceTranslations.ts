import { LocaleCode, TranslationStatus } from '@prisma/client';
import { Router } from 'express';
import { normalizeLocale } from '../constants/locales.js';
import { upsertServiceTranslationsBatch } from '../services/serviceTranslations.js';

const router = Router();
const STATUS_VALUES = new Set<string>(Object.values(TranslationStatus));

function isInternalAuthorized(req: any): boolean {
  const configured = process.env.INTERNAL_API_KEY;
  if (!configured) {
    return true;
  }

  const token = req.headers['x-internal-api-key'];
  return typeof token === 'string' && token === configured;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseStatus(value: unknown): TranslationStatus {
  if (typeof value !== 'string') {
    return TranslationStatus.APPROVED;
  }

  const normalized = value.trim().toUpperCase();
  if (!STATUS_VALUES.has(normalized)) {
    return TranslationStatus.APPROVED;
  }

  return normalized as TranslationStatus;
}

router.post('/batch', async (req: any, res: any) => {
  if (!isInternalAuthorized(req)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const payload = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(payload) || payload.length === 0) {
    return res.status(400).json({ message: 'Body must be a non-empty array or { items: [...] }' });
  }

  const accepted: Array<{
    serviceId: number;
    locale: LocaleCode;
    sourceLocale?: LocaleCode;
    name: string;
    description?: string | null;
    status?: TranslationStatus;
    version?: number;
  }> = [];

  const rejected: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < payload.length; i += 1) {
    const row = payload[i] || {};
    const serviceId = parsePositiveInt(row.serviceId);
    const locale = typeof row.locale === 'string' ? (normalizeLocale(row.locale) as LocaleCode) : null;
    const sourceLocale =
      typeof row.sourceLocale === 'string'
        ? (normalizeLocale(row.sourceLocale) as LocaleCode)
        : undefined;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const description =
      row.description === undefined || row.description === null
        ? null
        : typeof row.description === 'string'
        ? row.description
        : null;
    const version = parsePositiveInt(row.version);

    if (!serviceId) {
      rejected.push({ index: i, reason: 'serviceId must be a positive integer' });
      continue;
    }

    if (!locale) {
      rejected.push({ index: i, reason: 'locale is required' });
      continue;
    }

    if (!name) {
      rejected.push({ index: i, reason: 'name is required' });
      continue;
    }

    accepted.push({
      serviceId,
      locale,
      sourceLocale,
      name,
      description,
      status: parseStatus(row.status),
      version: version || 1,
    });
  }

  if (!accepted.length) {
    return res.status(400).json({
      inserted: 0,
      updated: 0,
      rejected,
    });
  }

  try {
    const result = await upsertServiceTranslationsBatch(accepted);

    return res.status(200).json({
      inserted: result.inserted,
      updated: result.updated,
      rejected,
    });
  } catch (error) {
    console.error('Error upserting internal service translations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
