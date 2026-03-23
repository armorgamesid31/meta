import {
  ContentSurface,
  ContentValueStatus,
  LocaleCode,
  Prisma,
} from '@prisma/client';
import { prisma } from '../prisma.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../constants/locales.js';

export interface RuntimeContentParams {
  surface: ContentSurface;
  page: string;
  locale: string;
  fallbackLocale?: string | null;
  salonId?: number | null;
}

export interface RuntimeContentResult {
  surface: ContentSurface;
  page: string;
  requestedLocale: LocaleCode;
  fallbackLocale: LocaleCode;
  salonId: number | null;
  values: Record<string, string>;
  meta: Record<
    string,
    {
      locale: LocaleCode;
      version: number;
      source: 'salon' | 'global';
      itemId: number;
    }
  >;
}

export interface DraftUpsertInput {
  surface: ContentSurface;
  page: string;
  section: string;
  key: string;
  locale: LocaleCode;
  draftValue: string;
  salonId?: number | null;
  metadata?: Prisma.InputJsonValue;
}

function toLocaleCode(value?: string | null): LocaleCode {
  return normalizeLocale(value) as LocaleCode;
}

function uniqueLocalePriority(locale: string, fallbackLocale?: string | null): LocaleCode[] {
  const requested = toLocaleCode(locale);
  const fallback = toLocaleCode(fallbackLocale || DEFAULT_LOCALE);
  const defaults = toLocaleCode(DEFAULT_LOCALE);

  return Array.from(new Set<LocaleCode>([requested, fallback, defaults]));
}

function contentMapKey(section: string, key: string): string {
  return `${section}.${key}`;
}

export async function resolveRuntimeContent(params: RuntimeContentParams): Promise<RuntimeContentResult> {
  const localePriority = uniqueLocalePriority(params.locale, params.fallbackLocale);
  const requestedLocale = localePriority[0];
  const fallbackLocale = localePriority[1] || requestedLocale;

  const where: Prisma.ContentItemWhereInput = {
    surface: params.surface,
    page: params.page,
    ...(params.salonId
      ? {
          OR: [{ salonId: params.salonId }, { salonId: null }],
        }
      : {
          salonId: null,
        }),
  };

  const items = await prisma.contentItem.findMany({
    where,
    select: {
      id: true,
      section: true,
      key: true,
      salonId: true,
      localeValues: {
        where: {
          locale: { in: localePriority },
          publishedValue: { not: null },
        },
        select: {
          locale: true,
          publishedValue: true,
          version: true,
        },
      },
    },
  });

  const values: Record<string, string> = {};
  const meta: RuntimeContentResult['meta'] = {};
  const scoreByKey = new Map<string, number>();

  for (const item of items) {
    const key = contentMapKey(item.section, item.key);

    for (const localized of item.localeValues) {
      const localeRank = localePriority.indexOf(localized.locale);
      if (localeRank < 0 || !localized.publishedValue) {
        continue;
      }

      const sourceRank = item.salonId ? 0 : 1;
      const score = sourceRank * 100 + localeRank;
      const currentBest = scoreByKey.get(key);

      if (currentBest !== undefined && currentBest <= score) {
        continue;
      }

      scoreByKey.set(key, score);
      values[key] = localized.publishedValue;
      meta[key] = {
        locale: localized.locale,
        version: localized.version,
        source: item.salonId ? 'salon' : 'global',
        itemId: item.id,
      };
    }
  }

  return {
    surface: params.surface,
    page: params.page,
    requestedLocale,
    fallbackLocale,
    salonId: params.salonId || null,
    values,
    meta,
  };
}

export async function findContentItemByCoordinates(input: {
  surface: ContentSurface;
  page: string;
  section: string;
  key: string;
  salonId?: number | null;
}) {
  return prisma.contentItem.findFirst({
    where: {
      surface: input.surface,
      page: input.page,
      section: input.section,
      key: input.key,
      ...(input.salonId
        ? {
            salonId: input.salonId,
          }
        : {
            salonId: null,
          }),
    },
  });
}

export async function getOrCreateContentItem(input: {
  surface: ContentSurface;
  page: string;
  section: string;
  key: string;
  salonId?: number | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const existing = await findContentItemByCoordinates(input);
  if (existing) {
    if (input.metadata !== undefined) {
      return prisma.contentItem.update({
        where: { id: existing.id },
        data: {
          metadata: input.metadata,
        },
      });
    }
    return existing;
  }

  return prisma.contentItem.create({
    data: {
      surface: input.surface,
      page: input.page,
      section: input.section,
      key: input.key,
      salonId: input.salonId || null,
      metadata: input.metadata,
    },
  });
}

export async function saveDraftValue(input: DraftUpsertInput) {
  const item = await getOrCreateContentItem({
    surface: input.surface,
    page: input.page,
    section: input.section,
    key: input.key,
    salonId: input.salonId,
    metadata: input.metadata,
  });

  const existing = await prisma.contentLocaleValue.findUnique({
    where: {
      itemId_locale: {
        itemId: item.id,
        locale: input.locale,
      },
    },
  });

  if (!existing) {
    const created = await prisma.contentLocaleValue.create({
      data: {
        itemId: item.id,
        locale: input.locale,
        draftValue: input.draftValue,
        status: ContentValueStatus.DRAFT,
      },
    });

    return {
      item,
      localeValue: created,
    };
  }

  const updated = await prisma.contentLocaleValue.update({
    where: {
      itemId_locale: {
        itemId: item.id,
        locale: input.locale,
      },
    },
    data: {
      draftValue: input.draftValue,
      status: ContentValueStatus.DRAFT,
    },
  });

  return {
    item,
    localeValue: updated,
  };
}

export async function publishLocaleValue(input: {
  itemId: number;
  locale: LocaleCode;
  publishedBy?: number | null;
}) {
  const existing = await prisma.contentLocaleValue.findUnique({
    where: {
      itemId_locale: {
        itemId: input.itemId,
        locale: input.locale,
      },
    },
    include: {
      item: true,
    },
  });

  if (!existing) {
    return null;
  }

  const nextVersion = existing.version + 1;

  const updated = await prisma.contentLocaleValue.update({
    where: {
      itemId_locale: {
        itemId: input.itemId,
        locale: input.locale,
      },
    },
    data: {
      publishedValue: existing.draftValue,
      status: ContentValueStatus.PUBLISHED,
      version: nextVersion,
      publishedAt: new Date(),
      publishedBy: input.publishedBy || null,
    },
    include: {
      item: true,
    },
  });

  return updated;
}

export async function publishLocaleValueBulk(input: {
  entries: Array<{ itemId: number; locale: LocaleCode }>;
  publishedBy?: number | null;
}) {
  const normalizedEntries = Array.from(
    new Map(
      input.entries.map((entry) => [`${entry.itemId}:${entry.locale}`, entry]),
    ).values(),
  );

  const published: Array<{
    itemId: number;
    locale: LocaleCode;
    version: number;
  }> = [];
  const skipped: Array<{ itemId: number; locale: LocaleCode; reason: string }> = [];

  await prisma.$transaction(async (tx) => {
    for (const entry of normalizedEntries) {
      const existing = await tx.contentLocaleValue.findUnique({
        where: {
          itemId_locale: {
            itemId: entry.itemId,
            locale: entry.locale,
          },
        },
      });

      if (!existing) {
        skipped.push({
          itemId: entry.itemId,
          locale: entry.locale,
          reason: 'Locale value not found',
        });
        continue;
      }

      const updated = await tx.contentLocaleValue.update({
        where: {
          itemId_locale: {
            itemId: entry.itemId,
            locale: entry.locale,
          },
        },
        data: {
          publishedValue: existing.draftValue,
          status: ContentValueStatus.PUBLISHED,
          version: existing.version + 1,
          publishedAt: new Date(),
          publishedBy: input.publishedBy || null,
        },
      });

      published.push({
        itemId: updated.itemId,
        locale: updated.locale,
        version: updated.version,
      });
    }
  });

  return {
    published,
    skipped,
  };
}
