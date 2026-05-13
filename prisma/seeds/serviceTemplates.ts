// Service template seed data for the onboarding wizard's "Hizmet Kataloğu"
// step. Templates are global (not salon-scoped) and grouped by SalonCategory
// so the wizard can show only the relevant checklist per salon type.
//
// Kullanıcı sonra dolduracak. Her item:
//   { category, name, defaultDurationMin, defaultPriceTRY?, serviceCategoryKey? }
//
// `serviceCategoryKey` is the global `Category.key` (e.g. "HAIR", "NAIL",
// "FACIAL" — see src/services/salonCategorySetup.ts) that the seeder will
// resolve to a concrete `ServiceCategory.id` row at insert time. Leave it
// undefined if the template should not be auto-linked to a category.
//
// Example entries (replace with real catalog data):
//
//   { category: 'KUAFOR_KADIN', name: 'Saç Kesimi',  defaultDurationMin: 45, defaultPriceTRY: 250, displayOrder: 1, serviceCategoryKey: 'HAIR' },
//   { category: 'KUAFOR_KADIN', name: 'Saç Boyama',  defaultDurationMin: 120, defaultPriceTRY: 750, displayOrder: 2, serviceCategoryKey: 'HAIR' },
//   { category: 'BARBER',        name: 'Sakal Tıraşı', defaultDurationMin: 20, defaultPriceTRY: 150, displayOrder: 1, serviceCategoryKey: 'HAIR' },

import type { PrismaClient, SalonCategory } from '@prisma/client';

export type ServiceTemplateSeed = {
  category: SalonCategory;
  name: string;
  defaultDurationMin: number;
  defaultPriceTRY?: number;
  displayOrder?: number;
  isActive?: boolean;
  /**
   * Global Category.key (e.g. "HAIR", "NAIL", "FACIAL"). The seeder resolves
   * this to a ServiceCategory.id on whichever salon row first matches by
   * Category. If omitted, the template will be created without a
   * ServiceCategory link.
   */
  serviceCategoryKey?: string;
};

export const SERVICE_TEMPLATE_SEEDS: ServiceTemplateSeed[] = [];

/**
 * Upserts every entry in SERVICE_TEMPLATE_SEEDS into the database.
 * Uses the (category, name) composite unique constraint on ServiceTemplate
 * so this is safe to re-run.
 *
 * When `serviceCategoryKey` is provided, the seeder looks up a
 * ServiceCategory row whose underlying global Category.key matches and
 * attaches it. If multiple salon-scoped ServiceCategory rows match, the
 * first one (by id ascending) wins — templates are global, so this just
 * provides a sensible default link.
 */
export async function seedServiceTemplates(prisma: PrismaClient): Promise<{
  upserted: number;
  skippedMissingCategoryKey: string[];
}> {
  const skippedMissingCategoryKey: string[] = [];
  let upserted = 0;

  // Resolve serviceCategoryKey -> ServiceCategory.id once up front.
  const neededKeys = Array.from(
    new Set(
      SERVICE_TEMPLATE_SEEDS.map((s) => s.serviceCategoryKey).filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      ),
    ),
  );

  const keyToServiceCategoryId = new Map<string, number>();
  if (neededKeys.length > 0) {
    const rows = await prisma.serviceCategory.findMany({
      where: { categoryRef: { key: { in: neededKeys } } },
      select: { id: true, categoryRef: { select: { key: true } } },
      orderBy: { id: 'asc' },
    });
    for (const row of rows) {
      const key = row.categoryRef?.key;
      if (key && !keyToServiceCategoryId.has(key)) {
        keyToServiceCategoryId.set(key, row.id);
      }
    }
  }

  for (const seed of SERVICE_TEMPLATE_SEEDS) {
    let serviceCategoryId: number | null = null;
    if (seed.serviceCategoryKey) {
      const mapped = keyToServiceCategoryId.get(seed.serviceCategoryKey);
      if (mapped) {
        serviceCategoryId = mapped;
      } else {
        skippedMissingCategoryKey.push(`${seed.category}/${seed.name} -> ${seed.serviceCategoryKey}`);
      }
    }

    await prisma.serviceTemplate.upsert({
      where: {
        category_name: {
          category: seed.category,
          name: seed.name,
        },
      },
      update: {
        defaultDurationMin: seed.defaultDurationMin,
        defaultPriceTRY: seed.defaultPriceTRY ?? null,
        displayOrder: seed.displayOrder ?? 0,
        isActive: seed.isActive ?? true,
        serviceCategoryId,
      },
      create: {
        category: seed.category,
        name: seed.name,
        defaultDurationMin: seed.defaultDurationMin,
        defaultPriceTRY: seed.defaultPriceTRY ?? null,
        displayOrder: seed.displayOrder ?? 0,
        isActive: seed.isActive ?? true,
        serviceCategoryId,
      },
    });
    upserted += 1;
  }

  return { upserted, skippedMissingCategoryKey };
}
