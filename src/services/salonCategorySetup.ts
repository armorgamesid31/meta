import { prisma } from '../prisma.js';

type CanonicalCategory = {
  key: string;
  defaultName: string;
  defaultSlug: string;
  displayOrder: number;
};

const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  { key: 'FACIAL', defaultName: 'Yüz ve Cilt Bakımı', defaultSlug: 'yuz-cilt-bakimi', displayOrder: 1 },
  { key: 'MEDICAL', defaultName: 'Medikal Estetik', defaultSlug: 'medikal-estetik', displayOrder: 2 },
  { key: 'LASER', defaultName: 'Lazer Epilasyon', defaultSlug: 'lazer-epilasyon', displayOrder: 3 },
  { key: 'WAX', defaultName: 'Ağda', defaultSlug: 'agda', displayOrder: 4 },
  {
    key: 'BODY',
    defaultName: 'Vücut Şekillendirme ve Masaj',
    defaultSlug: 'vucut-sekillendirme-masaj',
    displayOrder: 5,
  },
  { key: 'NAIL', defaultName: 'El, Ayak ve Tırnak', defaultSlug: 'el-ayak-tirnak', displayOrder: 6 },
  { key: 'HAIR', defaultName: 'Saç ve Kuaför', defaultSlug: 'sac-kuafor', displayOrder: 7 },
  {
    key: 'CONSULTATION',
    defaultName: 'Danışmanlık ve Paketler',
    defaultSlug: 'danismanlik-paketler',
    displayOrder: 8,
  },
  { key: 'OTHER', defaultName: 'Diğer Hizmetler', defaultSlug: 'diger-hizmetler', displayOrder: 9 },
];

const LEGACY_ASCII_NAMES_BY_KEY: Record<string, string[]> = {
  FACIAL: ['Yuz ve Cilt Bakimi'],
  MEDICAL: ['Medikal Estetik'],
  LASER: ['Lazer Epilasyon'],
  WAX: ['Agda'],
  BODY: ['Vucut Sekillendirme ve Masaj'],
  NAIL: ['El Ayak ve Tirnak'],
  HAIR: ['Sac ve Kuafor'],
  CONSULTATION: ['Danismanlik ve Paketler'],
  OTHER: ['Diger Hizmetler'],
};

function isLegacyAsciiName(currentName: string, categoryKey: string, desiredName: string): boolean {
  const value = (currentName || '').trim();
  if (!value || value === desiredName) return false;
  const legacyNames = LEGACY_ASCII_NAMES_BY_KEY[categoryKey] || [];
  return legacyNames.includes(value);
}

async function ensureGlobalCategories() {
  const ensured = [];

  for (const category of CANONICAL_CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { key: category.key },
      update: {
        defaultName: category.defaultName,
        defaultSlug: category.defaultSlug,
        displayOrder: category.displayOrder,
        isActive: true,
      },
      create: {
        key: category.key,
        defaultName: category.defaultName,
        defaultSlug: category.defaultSlug,
        displayOrder: category.displayOrder,
        isActive: true,
      },
      select: {
        id: true,
        key: true,
        defaultName: true,
        displayOrder: true,
      },
    });

    ensured.push(row);
  }

  return ensured.sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
}

export async function ensureSalonServiceCategories(salonId: number) {
  if (!Number.isInteger(salonId) || salonId <= 0) {
    return;
  }

  const categories = await ensureGlobalCategories();

  const existing = await prisma.serviceCategory.findMany({
    where: { salonId },
    select: {
      id: true,
      name: true,
      categoryId: true,
      categoryRef: {
        select: {
          key: true,
        },
      },
    },
  });

  const byCategoryId = new Map<number, (typeof existing)[number]>();
  for (const row of existing) {
    if (row.categoryId && !byCategoryId.has(row.categoryId)) {
      byCategoryId.set(row.categoryId, row);
    }
  }

  const createRows: Array<{
    salonId: number;
    categoryId: number;
    name: string;
    isActive: boolean;
    displayOrder: number;
    capacity: number;
    sequentialRequired: boolean;
    bufferMinutes: number;
  }> = [];

  const renameIds: Array<{ id: number; name: string }> = [];

  for (const category of categories) {
    const existingRow = byCategoryId.get(category.id);
    if (!existingRow) {
      createRows.push({
        salonId,
        categoryId: category.id,
        name: category.defaultName,
        isActive: true,
        displayOrder: category.displayOrder,
        capacity: 1,
        sequentialRequired: false,
        bufferMinutes: 0,
      });
      continue;
    }

    const key = existingRow.categoryRef?.key || category.key;
    if (isLegacyAsciiName(existingRow.name, key, category.defaultName)) {
      renameIds.push({ id: existingRow.id, name: category.defaultName });
    }
  }

  if (createRows.length > 0) {
    await prisma.serviceCategory.createMany({ data: createRows });
  }

  if (renameIds.length > 0) {
    await prisma.$transaction(
      renameIds.map((row) =>
        prisma.serviceCategory.update({
          where: { id: row.id },
          data: { name: row.name },
        }),
      ),
    );
  }
}
