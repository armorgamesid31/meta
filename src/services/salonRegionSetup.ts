import { prisma } from '../prisma.js';

const DEFAULT_REGIONS = [
  'El',
  'Ayak',
  'Yüz',
  'Kol',
  'Bacak',
  'Sırt',
  'Bel',
  'Göğüs',
  'Göbek',
  'Genital',
];

export async function ensureSalonServiceRegions(salonId: number) {
  if (!Number.isInteger(salonId) || salonId <= 0) {
    return;
  }

  const rows = DEFAULT_REGIONS.map((name, index) => ({
    salonId,
    name,
    isActive: true,
    displayOrder: index,
  }));

  if (rows.length === 0) {
    return;
  }

  await prisma.serviceRegion.createMany({
    data: rows,
    skipDuplicates: true,
  });
}
