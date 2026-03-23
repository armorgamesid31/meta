import { LocaleCode, TranslationStatus } from '@prisma/client';
import { prisma } from '../prisma.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../constants/locales.js';

function toLocaleCode(value?: string | null): LocaleCode {
  return normalizeLocale(value) as LocaleCode;
}

function localePriority(locale: string, sourceLocale?: string | null): LocaleCode[] {
  const requested = toLocaleCode(locale);
  const source = toLocaleCode(sourceLocale || DEFAULT_LOCALE);
  const fallback = toLocaleCode(DEFAULT_LOCALE);
  return Array.from(new Set<LocaleCode>([requested, source, fallback]));
}

function translationStatusRank(status: TranslationStatus): number {
  if (status === TranslationStatus.APPROVED) return 0;
  if (status === TranslationStatus.REVIEWED) return 1;
  return 2;
}

export async function resolveServiceTranslations(params: {
  serviceIds: number[];
  locale: string;
  sourceLocale?: string | null;
}) {
  if (params.serviceIds.length === 0) {
    return new Map<number, { name: string; description: string | null; locale: LocaleCode; status: TranslationStatus }>();
  }

  const priorities = localePriority(params.locale, params.sourceLocale);

  const rows = await prisma.serviceTranslation.findMany({
    where: {
      serviceId: { in: params.serviceIds },
      locale: { in: priorities },
      status: { in: [TranslationStatus.APPROVED, TranslationStatus.REVIEWED, TranslationStatus.DRAFT] },
    },
    orderBy: [{ version: 'desc' }],
  });

  const resolved = new Map<
    number,
    {
      name: string;
      description: string | null;
      locale: LocaleCode;
      status: TranslationStatus;
      _score: number;
      _version: number;
    }
  >();

  for (const row of rows) {
    const localeRank = priorities.indexOf(row.locale);
    if (localeRank < 0) {
      continue;
    }

    const score = localeRank * 10 + translationStatusRank(row.status);
    const existing = resolved.get(row.serviceId);

    if (!existing || score < existing._score || (score === existing._score && row.version > existing._version)) {
      resolved.set(row.serviceId, {
        name: row.name,
        description: row.description,
        locale: row.locale,
        status: row.status,
        _score: score,
        _version: row.version,
      });
    }
  }

  const cleaned = new Map<number, { name: string; description: string | null; locale: LocaleCode; status: TranslationStatus }>();
  for (const [serviceId, hit] of resolved) {
    cleaned.set(serviceId, {
      name: hit.name,
      description: hit.description,
      locale: hit.locale,
      status: hit.status,
    });
  }

  return cleaned;
}

export async function upsertServiceTranslationsBatch(items: Array<{
  serviceId: number;
  locale: LocaleCode;
  sourceLocale?: LocaleCode;
  name: string;
  description?: string | null;
  status?: TranslationStatus;
  version?: number;
}>) {
  let inserted = 0;
  let updated = 0;

  for (const item of items) {
    const version = Number.isInteger(item.version) && (item.version as number) > 0 ? (item.version as number) : 1;

    const existing = await prisma.serviceTranslation.findUnique({
      where: {
        serviceId_locale_version: {
          serviceId: item.serviceId,
          locale: item.locale,
          version,
        },
      },
      select: { id: true },
    });

    await prisma.serviceTranslation.upsert({
      where: {
        serviceId_locale_version: {
          serviceId: item.serviceId,
          locale: item.locale,
          version,
        },
      },
      update: {
        sourceLocale: item.sourceLocale || toLocaleCode(DEFAULT_LOCALE),
        name: item.name,
        description: item.description || null,
        status: item.status || TranslationStatus.APPROVED,
      },
      create: {
        serviceId: item.serviceId,
        locale: item.locale,
        sourceLocale: item.sourceLocale || toLocaleCode(DEFAULT_LOCALE),
        name: item.name,
        description: item.description || null,
        status: item.status || TranslationStatus.APPROVED,
        version,
      },
    });

    if (existing) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  return {
    inserted,
    updated,
  };
}
