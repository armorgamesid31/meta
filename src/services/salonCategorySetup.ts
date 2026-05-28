import { prisma } from '../prisma.js';

type CanonicalCategory = {
  key: string;
  defaultName: string;
  defaultSlug: string;
  defaultDescription: string;
  displayOrder: number;
};

const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  {
    key: 'FACIAL',
    defaultName: 'Yüz ve Cilt Bakımı',
    defaultSlug: 'yuz-cilt-bakimi',
    defaultDescription:
      'Cildinizin ihtiyaçlarına özel bakım uygulamalarıyla daha canlı, dengeli ve sağlıklı bir görünüm hedeflenir.',
    displayOrder: 1,
  },
  {
    key: 'MEDICAL',
    defaultName: 'Medikal Estetik',
    defaultSlug: 'medikal-estetik',
    defaultDescription:
      'Uzman değerlendirmesiyle planlanan medikal estetik uygulamalar, doğal sonuç ve güvenli süreç odaklı sunulur.',
    displayOrder: 2,
  },
  {
    key: 'LASER',
    defaultName: 'Lazer Epilasyon',
    defaultSlug: 'lazer-epilasyon',
    defaultDescription:
      'Cilt ve kıl yapınıza uygun lazer epilasyon protokolleriyle düzenli seanslarda konforlu ve etkili sonuçlar amaçlanır.',
    displayOrder: 3,
  },
  {
    key: 'WAX',
    defaultName: 'Ağda',
    defaultSlug: 'agda',
    defaultDescription:
      'Hassas ciltlere uygun ürünlerle hijyenik ve konforlu ağda uygulamaları, pürüzsüz bir cilt deneyimi için planlanır.',
    displayOrder: 4,
  },
  {
    key: 'BODY',
    defaultName: 'Vücut Şekillendirme ve Masaj',
    defaultSlug: 'vucut-sekillendirme-masaj',
    defaultDescription:
      'Bölgesel incelme, sıkılaşma ve rahatlama hedeflerine yönelik vücut uygulamaları uzman ekip tarafından kişiselleştirilir.',
    displayOrder: 5,
  },
  {
    key: 'NAIL',
    defaultName: 'El, Ayak ve Tırnak',
    defaultSlug: 'el-ayak-tirnak',
    defaultDescription:
      'Manikür, pedikür ve tırnak bakım uygulamalarıyla estetik görünüm ve uzun süreli bakım bir arada sunulur.',
    displayOrder: 6,
  },
  {
    key: 'HAIR',
    defaultName: 'Saç ve Kuaför',
    defaultSlug: 'sac-kuafor',
    defaultDescription:
      'Kesim, renklendirme ve bakım işlemleri saç yapınıza uygun tekniklerle uygulanarak güçlü ve bakımlı görünüm desteklenir.',
    displayOrder: 7,
  },
  {
    key: 'CONSULTATION',
    defaultName: 'Danışmanlık ve Paketler',
    defaultSlug: 'danismanlik-paketler',
    defaultDescription:
      'Hedeflerinize uygun hizmet planları ve paket önerileriyle bütçe, süre ve beklenti dengesini sağlayan yönlendirme sunulur.',
    displayOrder: 8,
  },
  {
    key: 'OTHER',
    defaultName: 'Diğer Hizmetler',
    defaultSlug: 'diger-hizmetler',
    defaultDescription:
      'Kategori dışı özel uygulamalar ve tamamlayıcı hizmetler, ihtiyacınıza göre planlanarak esnek seçenekler sunar.',
    displayOrder: 9,
  },
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
        defaultDescription: category.defaultDescription,
        displayOrder: category.displayOrder,
        isActive: true,
      },
      create: {
        key: category.key,
        defaultName: category.defaultName,
        defaultSlug: category.defaultSlug,
        defaultDescription: category.defaultDescription,
        displayOrder: category.displayOrder,
        isActive: true,
      },
      select: {
        id: true,
        key: true,
        defaultName: true,
        displayOrder: true,
        defaultDescription: true,
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
    marketingDescription: string;
    isActive: boolean;
    displayOrder: number;
    capacity: number;
    sequentialRequired: boolean;
    bufferMinutes: number;
  }> = [];

  const renameIds: Array<{ id: number; name: string }> = [];

  // Categories where the customer typically has to undress / lie down /
  // be physically prepped, so chained selections must NOT be interleaved
  // with another category's service during availability search. Same
  // reasoning as why people don't want a haircut squeezed between two
  // bikini-laser slots. Salon owners can still toggle this off per salon
  // from the category settings sheet.
  const DEFAULT_SEQUENTIAL_KEYS = new Set<string>(['LASER', 'WAX']);

  for (const category of categories) {
    const existingRow = byCategoryId.get(category.id);
    if (!existingRow) {
      createRows.push({
        salonId,
        categoryId: category.id,
        name: category.defaultName,
        marketingDescription: category.defaultDescription,
        isActive: true,
        displayOrder: category.displayOrder,
        capacity: 1,
        sequentialRequired: DEFAULT_SEQUENTIAL_KEYS.has(category.key),
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
