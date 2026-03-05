import { prisma } from '../prisma.js';
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from '../constants/locales.js';

export type TranslationEntity = 'SALON' | 'CATEGORY' | 'EXPERT' | 'TEMPLATE' | 'UI';
export type TranslationStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED';

function uniqueLocalePriority(locale: string, sourceLocale?: string | null): SupportedLocale[] {
  const requested = normalizeLocale(locale);
  const source = normalizeLocale(sourceLocale || DEFAULT_LOCALE);
  return Array.from(new Set<SupportedLocale>([requested, source, DEFAULT_LOCALE]));
}

function rankByLocale(priority: SupportedLocale[], locale: string): number {
  const idx = priority.indexOf(normalizeLocale(locale));
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export async function resolveTranslationsBatch(params: {
  entityType: TranslationEntity;
  entityIds: number[];
  keys: string[];
  locale: string;
  sourceLocale?: string | null;
  status?: TranslationStatus;
}): Promise<Record<string, string>> {
  const { entityType, entityIds, keys, locale, sourceLocale, status = 'APPROVED' } = params;

  if (entityIds.length === 0 || keys.length === 0) return {};

  const localePriority = uniqueLocalePriority(locale, sourceLocale);

  const rows = await prisma.translation.findMany({
    where: {
      entityType,
      entityId: { in: entityIds },
      key: { in: keys },
      locale: { in: localePriority },
      status,
    },
    orderBy: [{ entityId: 'asc' }, { key: 'asc' }, { version: 'desc' }],
  });

  const latestByLocaleKey = new Map<string, { text: string; locale: string }>();
  for (const row of rows) {
    const id = `${row.entityId}:${row.key}:${row.locale}`;
    if (!latestByLocaleKey.has(id)) {
      latestByLocaleKey.set(id, { text: row.text, locale: row.locale });
    }
  }

  const resolved: Record<string, string> = {};

  for (const entityId of entityIds) {
    for (const key of keys) {
      const candidates = localePriority
        .map((loc) => {
          const hit = latestByLocaleKey.get(`${entityId}:${key}:${loc}`);
          if (!hit) return null;
          return { locale: loc, text: hit.text };
        })
        .filter((x): x is { locale: SupportedLocale; text: string } => !!x);

      if (candidates.length > 0) {
        candidates.sort((a, b) => rankByLocale(localePriority, a.locale) - rankByLocale(localePriority, b.locale));
        resolved[`${entityId}:${key}`] = candidates[0].text;
      }
    }
  }

  return resolved;
}

export async function resolveCategoryBySlug(params: {
  slug: string;
  locale: string;
  sourceLocale?: string | null;
}) {
  const slug = (params.slug || '').trim().toLowerCase();
  if (!slug) return null;

  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });

  if (categories.length === 0) return null;

  const translations = await resolveTranslationsBatch({
    entityType: 'CATEGORY',
    entityIds: categories.map((c) => c.id),
    keys: ['slug', 'name', 'marketingDescription', 'benefits'],
    locale: params.locale,
    sourceLocale: params.sourceLocale,
  });

  for (const category of categories) {
    const localizedSlug = (translations[`${category.id}:slug`] || category.defaultSlug).toLowerCase();
    if (localizedSlug === slug) {
      return {
        category,
        localized: {
          slug: localizedSlug,
          name: translations[`${category.id}:name`] || category.defaultName,
          marketingDescription: translations[`${category.id}:marketingDescription`] || category.defaultDescription || null,
          benefits: (translations[`${category.id}:benefits`] || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        },
      };
    }
  }

  return null;
}
