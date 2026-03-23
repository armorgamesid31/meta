import {
  ContentSurface,
  ContentValueStatus,
  LocaleCode,
  Prisma,
} from '@prisma/client';
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { normalizeLocale } from '../constants/locales.js';
import { prisma } from '../prisma.js';
import {
  publishLocaleValue,
  publishLocaleValueBulk,
  saveDraftValue,
} from '../services/content.js';

const router = Router();
const CONTENT_SURFACE_VALUES = new Set<string>(Object.values(ContentSurface));
const CONTENT_STATUS_VALUES = new Set<string>(Object.values(ContentValueStatus));

interface ContentAdminContext {
  userId: number;
  salonId: number;
  email: string;
  isGlobalContentAdmin: boolean;
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

function parseContentSurface(value: unknown): ContentSurface | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!CONTENT_SURFACE_VALUES.has(normalized)) {
    return null;
  }
  return normalized as ContentSurface;
}

function parseContentStatus(value: unknown): ContentValueStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!CONTENT_STATUS_VALUES.has(normalized)) {
    return null;
  }
  return normalized as ContentValueStatus;
}

function parseContentAdminEmails(): Set<string> {
  return new Set(
    (process.env.CONTENT_ADMIN_EMAILS || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function getContentAdminContext(req: any): Promise<ContentAdminContext | null> {
  const authUserId = parsePositiveInt(req.user?.userId || req.user?.id);
  if (!authUserId) {
    return null;
  }

  const user = await prisma.salonUser.findUnique({
    where: { id: authUserId },
    select: { id: true, salonId: true, email: true },
  });

  if (!user) {
    return null;
  }

  const allowlistedEmails = parseContentAdminEmails();
  const normalizedEmail = user.email.trim().toLowerCase();

  return {
    userId: user.id,
    salonId: user.salonId,
    email: user.email,
    isGlobalContentAdmin: allowlistedEmails.size > 0 && allowlistedEmails.has(normalizedEmail),
  };
}

function parseSalonScope(value: unknown): { mode: 'default' | 'global' | 'salon' | 'all'; salonId?: number } {
  if (typeof value !== 'string' || !value.trim()) {
    return { mode: 'default' };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') {
    return { mode: 'all' };
  }
  if (normalized === 'global') {
    return { mode: 'global' };
  }

  const salonId = parsePositiveInt(normalized);
  if (salonId) {
    return { mode: 'salon', salonId };
  }

  return { mode: 'default' };
}

function parseDraftTargetSalonId(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'global') {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  const salonId = parsePositiveInt(value);
  return salonId || undefined;
}

function canWriteScope(context: ContentAdminContext, salonId: number | null): boolean {
  if (salonId === null) {
    return context.isGlobalContentAdmin;
  }

  if (context.isGlobalContentAdmin) {
    return true;
  }

  return context.salonId === salonId;
}

router.use(authenticateToken);

router.get('/items', async (req: any, res: any) => {
  const context = await getContentAdminContext(req);
  if (!context) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const surface = parseContentSurface(req.query.surface);
  const localeFilter = typeof req.query.locale === 'string' ? (normalizeLocale(req.query.locale) as LocaleCode) : null;
  const statusFilter = parseContentStatus(req.query.status);
  const pageFilter = typeof req.query.page === 'string' ? req.query.page.trim() : '';
  const sectionFilter = typeof req.query.section === 'string' ? req.query.section.trim() : '';
  const keyFilter = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const scope = parseSalonScope(req.query.salonId);
  if (scope.mode === 'all' && !context.isGlobalContentAdmin) {
    return res.status(403).json({ message: 'Only allowlisted content admins can query all salon scopes.' });
  }

  if (scope.mode === 'salon' && scope.salonId && !context.isGlobalContentAdmin && scope.salonId !== context.salonId) {
    return res.status(403).json({ message: 'You cannot access another salon scope.' });
  }

  const takeRaw = parsePositiveInt(req.query.take);
  const take = takeRaw ? Math.min(takeRaw, 300) : 100;
  const skip = parsePositiveInt(req.query.skip) || 0;

  const andFilters: Prisma.ContentItemWhereInput[] = [];

  if (surface) {
    andFilters.push({ surface });
  }

  if (pageFilter) {
    andFilters.push({ page: { contains: pageFilter, mode: 'insensitive' } });
  }

  if (sectionFilter) {
    andFilters.push({ section: { contains: sectionFilter, mode: 'insensitive' } });
  }

  if (keyFilter) {
    andFilters.push({ key: { contains: keyFilter, mode: 'insensitive' } });
  }

  if (statusFilter) {
    andFilters.push({
      localeValues: {
        some: {
          status: statusFilter,
          ...(localeFilter ? { locale: localeFilter } : {}),
        },
      },
    });
  }

  if (search) {
    andFilters.push({
      OR: [
        { page: { contains: search, mode: 'insensitive' } },
        { section: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
        {
          localeValues: {
            some: {
              OR: [
                { draftValue: { contains: search, mode: 'insensitive' } },
                { publishedValue: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    });
  }

  if (scope.mode === 'global') {
    andFilters.push({ salonId: null });
  } else if (scope.mode === 'salon' && scope.salonId) {
    andFilters.push({ salonId: scope.salonId });
  } else if (scope.mode === 'default') {
    andFilters.push({
      OR: [{ salonId: null }, { salonId: context.salonId }],
    });
  }

  const where: Prisma.ContentItemWhereInput = andFilters.length > 0 ? { AND: andFilters } : {};

  try {
    const [items, total] = await prisma.$transaction([
      prisma.contentItem.findMany({
        where,
        select: {
          id: true,
          surface: true,
          page: true,
          section: true,
          key: true,
          salonId: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          localeValues: {
            where: localeFilter ? { locale: localeFilter } : undefined,
            orderBy: [{ locale: 'asc' }],
            select: {
              id: true,
              locale: true,
              draftValue: true,
              publishedValue: true,
              status: true,
              version: true,
              publishedAt: true,
              publishedBy: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: [{ surface: 'asc' }, { page: 'asc' }, { section: 'asc' }, { key: 'asc' }],
        take,
        skip,
      }),
      prisma.contentItem.count({ where }),
    ]);

    return res.status(200).json({
      total,
      take,
      skip,
      filters: {
        surface: surface || null,
        locale: localeFilter || null,
        status: statusFilter || null,
        salonScope: scope,
      },
      items: items.map((item) => ({
        ...item,
        editable: canWriteScope(context, item.salonId),
        readOnlyReason:
          item.surface === ContentSurface.message_templates
            ? 'message_templates is read-only in phase 1'
            : !canWriteScope(context, item.salonId)
            ? 'insufficient scope permission'
            : null,
      })),
    });
  } catch (error) {
    console.error('Error listing admin content items:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/items/draft', async (req: any, res: any) => {
  const context = await getContentAdminContext(req);
  if (!context) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const locale = normalizeLocale(typeof req.body?.locale === 'string' ? req.body.locale : 'tr') as LocaleCode;
  const draftValue = typeof req.body?.draftValue === 'string' ? req.body.draftValue : null;

  if (draftValue === null) {
    return res.status(400).json({ message: 'draftValue is required and must be a string.' });
  }

  const itemId = parsePositiveInt(req.body?.itemId);

  try {
    let targetItem: {
      id: number;
      surface: ContentSurface;
      page: string;
      section: string;
      key: string;
      salonId: number | null;
    } | null = null;

    if (itemId) {
      const existing = await prisma.contentItem.findUnique({
        where: { id: itemId },
        select: {
          id: true,
          surface: true,
          page: true,
          section: true,
          key: true,
          salonId: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: 'Content item not found.' });
      }

      targetItem = existing;
    }

    if (targetItem && targetItem.surface === ContentSurface.message_templates) {
      return res.status(403).json({ message: 'message_templates is read-only in phase 1.' });
    }

    let targetSalonId = parseDraftTargetSalonId(req.body?.salonId);
    if (targetSalonId === undefined) {
      targetSalonId = targetItem ? targetItem.salonId : context.salonId;
    }

    if (!canWriteScope(context, targetSalonId === undefined ? context.salonId : targetSalonId)) {
      return res.status(403).json({ message: 'You are not allowed to edit this scope.' });
    }

    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? (req.body.metadata as Prisma.InputJsonValue) : undefined;

    if (!targetItem) {
      const surface = parseContentSurface(req.body?.surface);
      const page = typeof req.body?.page === 'string' ? req.body.page.trim() : '';
      const section = typeof req.body?.section === 'string' ? req.body.section.trim() : '';
      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';

      if (!surface || !page || !section || !key) {
        return res.status(400).json({
          message: 'surface, page, section, and key are required when itemId is not provided.',
        });
      }

      if (surface === ContentSurface.message_templates) {
        return res.status(403).json({ message: 'message_templates is read-only in phase 1.' });
      }

      const result = await saveDraftValue({
        surface,
        page,
        section,
        key,
        locale,
        draftValue,
        salonId: targetSalonId === undefined ? context.salonId : targetSalonId,
        metadata,
      });

      return res.status(200).json({
        item: result.item,
        localeValue: result.localeValue,
      });
    }

    const result = await saveDraftValue({
      surface: targetItem.surface,
      page: targetItem.page,
      section: targetItem.section,
      key: targetItem.key,
      locale,
      draftValue,
      salonId: targetItem.salonId,
      metadata,
    });

    return res.status(200).json({
      item: result.item,
      localeValue: result.localeValue,
    });
  } catch (error) {
    console.error('Error saving content draft:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/items/publish', async (req: any, res: any) => {
  const context = await getContentAdminContext(req);
  if (!context) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const itemId = parsePositiveInt(req.body?.itemId);
  const locale = normalizeLocale(typeof req.body?.locale === 'string' ? req.body.locale : 'tr') as LocaleCode;

  if (!itemId) {
    return res.status(400).json({ message: 'itemId is required and must be a positive integer.' });
  }

  try {
    const current = await prisma.contentLocaleValue.findUnique({
      where: {
        itemId_locale: {
          itemId,
          locale,
        },
      },
      include: {
        item: {
          select: {
            id: true,
            surface: true,
            salonId: true,
          },
        },
      },
    });

    if (!current) {
      return res.status(404).json({ message: 'Locale value not found for itemId + locale.' });
    }

    if (current.item.surface === ContentSurface.message_templates) {
      return res.status(403).json({ message: 'message_templates is read-only in phase 1.' });
    }

    if (!canWriteScope(context, current.item.salonId)) {
      return res.status(403).json({ message: 'You are not allowed to publish this scope.' });
    }

    const published = await publishLocaleValue({
      itemId,
      locale,
      publishedBy: context.userId,
    });

    if (!published) {
      return res.status(404).json({ message: 'Locale value not found.' });
    }

    return res.status(200).json({ localeValue: published });
  } catch (error) {
    console.error('Error publishing content locale value:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/items/publish-bulk', async (req: any, res: any) => {
  const context = await getContentAdminContext(req);
  if (!context) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const payload = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!payload.length) {
    return res.status(400).json({ message: 'entries must be a non-empty array.' });
  }

  const parsedEntries: Array<{ itemId: number; locale: LocaleCode }> = [];
  const skipped: Array<{ itemId: number | null; locale: string | null; reason: string }> = [];

  for (const row of payload) {
    const itemId = parsePositiveInt(row?.itemId);
    const locale = typeof row?.locale === 'string' ? (normalizeLocale(row.locale) as LocaleCode) : null;

    if (!itemId || !locale) {
      skipped.push({
        itemId: itemId || null,
        locale,
        reason: 'Invalid itemId or locale',
      });
      continue;
    }

    parsedEntries.push({ itemId, locale });
  }

  if (!parsedEntries.length) {
    return res.status(400).json({ message: 'No valid entries to publish.', skipped });
  }

  try {
    const candidates = await prisma.contentLocaleValue.findMany({
      where: {
        OR: parsedEntries.map((entry) => ({
          itemId: entry.itemId,
          locale: entry.locale,
        })),
      },
      include: {
        item: {
          select: {
            id: true,
            surface: true,
            salonId: true,
          },
        },
      },
    });

    const candidateMap = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      candidateMap.set(`${candidate.itemId}:${candidate.locale}`, candidate);
    }

    const publishable: Array<{ itemId: number; locale: LocaleCode }> = [];

    for (const entry of parsedEntries) {
      const key = `${entry.itemId}:${entry.locale}`;
      const candidate = candidateMap.get(key);

      if (!candidate) {
        skipped.push({
          itemId: entry.itemId,
          locale: entry.locale,
          reason: 'Locale value not found',
        });
        continue;
      }

      if (candidate.item.surface === ContentSurface.message_templates) {
        skipped.push({
          itemId: entry.itemId,
          locale: entry.locale,
          reason: 'message_templates is read-only in phase 1',
        });
        continue;
      }

      if (!canWriteScope(context, candidate.item.salonId)) {
        skipped.push({
          itemId: entry.itemId,
          locale: entry.locale,
          reason: 'Insufficient scope permission',
        });
        continue;
      }

      publishable.push(entry);
    }

    if (!publishable.length) {
      return res.status(200).json({ published: [], skipped });
    }

    const result = await publishLocaleValueBulk({
      entries: publishable,
      publishedBy: context.userId,
    });

    return res.status(200).json({
      published: result.published,
      skipped: [...skipped, ...result.skipped],
    });
  } catch (error) {
    console.error('Error bulk publishing content values:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
