import { slugify } from '../utils/slug.js';

export type GlobalCategoryKey =
  | 'FACIAL'
  | 'MEDICAL'
  | 'LASER'
  | 'WAX'
  | 'BODY'
  | 'NAIL'
  | 'HAIR'
  | 'CONSULTATION'
  | 'OTHER';

export interface GlobalCategorySeed {
  key: GlobalCategoryKey;
  defaultName: string;
  displayOrder: number;
}

export const GLOBAL_CATEGORIES: GlobalCategorySeed[] = [
  { key: 'FACIAL', defaultName: 'Yuz ve Cilt Bakimi', displayOrder: 1 },
  { key: 'MEDICAL', defaultName: 'Medikal Estetik', displayOrder: 2 },
  { key: 'LASER', defaultName: 'Lazer Epilasyon', displayOrder: 3 },
  { key: 'WAX', defaultName: 'Agda', displayOrder: 4 },
  { key: 'BODY', defaultName: 'Vucut Sekillendirme ve Masaj', displayOrder: 5 },
  { key: 'NAIL', defaultName: 'El Ayak ve Tirnak', displayOrder: 6 },
  { key: 'HAIR', defaultName: 'Sac ve Kuafor', displayOrder: 7 },
  { key: 'CONSULTATION', defaultName: 'Danismanlik ve Paketler', displayOrder: 8 },
  { key: 'OTHER', defaultName: 'Diger Hizmetler', displayOrder: 9 },
];

export const GLOBAL_CATEGORY_BY_KEY: Record<GlobalCategoryKey, GlobalCategorySeed & { defaultSlug: string }> =
  GLOBAL_CATEGORIES.reduce((acc, item) => {
    acc[item.key] = { ...item, defaultSlug: slugify(item.defaultName, 'tr') };
    return acc;
  }, {} as Record<GlobalCategoryKey, GlobalCategorySeed & { defaultSlug: string }>);

export function mapCategoryKeyFromName(rawName?: string | null): GlobalCategoryKey {
  const name = (rawName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  if (name.includes('CILT') || name.includes('YUZ') || name.includes('FACIAL')) return 'FACIAL';
  if (name.includes('MEDIKAL') || name.includes('MEDICAL')) return 'MEDICAL';
  if (name.includes('LAZER') || name.includes('LASER') || name.includes('EPILASYON')) return 'LASER';
  if (name.includes('AGDA') || name.includes('WAX')) return 'WAX';
  if (name.includes('VUCUT') || name.includes('BODY') || name.includes('MASAJ')) return 'BODY';
  if (name.includes('TIRNAK') || name.includes('MANIKUR') || name.includes('PEDIKUR') || name.includes('NAIL')) return 'NAIL';
  if (name.includes('SAC') || name.includes('KUAFOR') || name.includes('HAIR')) return 'HAIR';
  if (name.includes('DANISMANLIK') || name.includes('PAKET') || name.includes('CONSULTATION')) return 'CONSULTATION';
  return 'OTHER';
}
