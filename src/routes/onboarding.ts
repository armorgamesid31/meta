import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import { resolveMapsLink } from '../services/mapsResolver.js';
import { prisma } from '../prisma.js';
import { SalonCategory, Prisma } from '@prisma/client';
import { ensureSalonServiceCategories } from '../services/salonCategorySetup.js';
import {
  getJourney,
  recomputeJourney,
  markTaskComplete,
  isJourneyTaskKey,
} from '../services/journeyService.js';

const router = Router();

/**
 * POST /api/onboarding/resolve-maps-link
 *
 * Onboarding wizard endpoint that mirrors the admin
 * `/api/admin/setup/resolve-maps-link` endpoint but is available to any
 * authenticated salon owner/manager (no `admin.*` permission required).
 *
 * The salon owner pastes a Google Maps share link during the address step;
 * we resolve it to an address + city/district autofill payload.
 */
router.post('/resolve-maps-link', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kapsamı bulunamadı.', 401);
  }

  const inputUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const result = await resolveMapsLink(inputUrl);
  return res.status(200).json(result);
});

/**
 * Turkish display labels for SalonCategory enum values.
 * Used by the wizard's category picker step.
 */
const SALON_CATEGORY_LABELS: Record<SalonCategory, string> = {
  KUAFOR_KADIN: 'Kuaför - Kadın',
  KUAFOR_ERKEK: 'Kuaför - Erkek',
  KUAFOR_UNISEX: 'Kuaför - Unisex',
  BARBER: 'Berber',
  GUZELLIK_MERKEZI: 'Güzellik Merkezi',
  TIRNAK_STUDYOSU: 'Tırnak Stüdyosu',
  ESTETIK_KLINIK: 'Estetik Klinik',
  SPA_WELLNESS: 'Spa & Wellness',
  DIGER: 'Diğer',
};

function isSalonCategory(value: unknown): value is SalonCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SALON_CATEGORY_LABELS, value);
}

/**
 * GET /api/onboarding/service-templates/categories
 *
 * Returns all SalonCategory enum values with Turkish labels for the
 * onboarding category picker step.
 */
router.get('/service-templates/categories', authenticateToken, async (_req: any, res: any) => {
  const items = (Object.keys(SALON_CATEGORY_LABELS) as SalonCategory[]).map((key) => ({
    key,
    label: SALON_CATEGORY_LABELS[key],
  }));
  return res.status(200).json({ items });
});

/**
 * GET /api/onboarding/service-templates?category=KUAFOR_KADIN
 *
 * Returns active ServiceTemplate rows for the given salon category, ordered
 * by displayOrder then id. Used to render the onboarding "Hizmet Kataloğu"
 * checklist step.
 */
router.get('/service-templates', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kapsamı bulunamadı.', 401);
  }

  const category = req.query?.category;
  if (!isSalonCategory(category)) {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'category sorgu parametresi geçerli bir SalonCategory değeri olmalıdır.',
      400,
    );
  }

  const items = await prisma.serviceTemplate.findMany({
    where: { category, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });

  return res.status(200).json({ items });
});

type FromTemplatesSelection = {
  templateId: number;
  priceTRY: number;
  durationMin: number;
};

function parseSelections(input: unknown): FromTemplatesSelection[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BusinessError('VALIDATION_FAILED', 'selections boş olmayan bir dizi olmalıdır.', 400);
  }

  const parsed: FromTemplatesSelection[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as any;
    const templateId = Number(raw?.templateId);
    const priceTRY = Number(raw?.priceTRY);
    const durationMin = Number(raw?.durationMin);

    if (!Number.isInteger(templateId) || templateId <= 0) {
      throw new BusinessError('VALIDATION_FAILED', `selections[${i}].templateId pozitif tamsayı olmalıdır.`, 400);
    }
    if (!Number.isFinite(priceTRY) || priceTRY < 0) {
      throw new BusinessError('VALIDATION_FAILED', `selections[${i}].priceTRY negatif olmayan bir sayı olmalıdır.`, 400);
    }
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      throw new BusinessError('VALIDATION_FAILED', `selections[${i}].durationMin pozitif tamsayı olmalıdır.`, 400);
    }

    parsed.push({ templateId, priceTRY, durationMin });
  }

  return parsed;
}

/**
 * POST /api/onboarding/services/from-templates
 *
 * Bulk-creates Service rows for the authenticated salon from a list of
 * selected ServiceTemplate ids plus per-selection price/duration overrides.
 *
 * Ensures the salon's canonical ServiceCategory rows exist (via
 * ensureSalonServiceCategories) so the wizard can run before any other
 * service-category setup has happened.
 */
router.post('/services/from-templates', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kapsamı bulunamadı.', 401);
  }

  const salonId: number = req.user.salonId;
  const selections = parseSelections(req.body?.selections);

  // Make sure the salon has its canonical ServiceCategory rows in place
  // before we try to attach categoryId to the new services.
  await ensureSalonServiceCategories(salonId);

  const templateIds = Array.from(new Set(selections.map((s) => s.templateId)));
  const templates = await prisma.serviceTemplate.findMany({
    where: { id: { in: templateIds } },
    include: {
      serviceCategory: {
        select: { id: true, salonId: true, categoryId: true, name: true },
      },
    },
  });

  if (templates.length !== templateIds.length) {
    const foundIds = new Set(templates.map((t) => t.id));
    const missing = templateIds.filter((id) => !foundIds.has(id));
    throw new BusinessError(
      'NOT_FOUND',
      `Şu template id değerleri bulunamadı: ${missing.join(', ')}`,
      404,
      { missing },
    );
  }

  const templateById = new Map(templates.map((t) => [t.id, t]));

  // Resolve the target salon's ServiceCategory row for each selection. The
  // template's serviceCategoryId may point at another salon's row (templates
  // are global), so we map by the underlying global Category key when
  // available, otherwise fall back to name match.
  const salonServiceCategories = await prisma.serviceCategory.findMany({
    where: { salonId },
    select: {
      id: true,
      name: true,
      categoryId: true,
      categoryRef: { select: { key: true } },
    },
  });
  const salonCatByGlobalCategoryId = new Map<number, number>();
  const salonCatByName = new Map<string, number>();
  for (const row of salonServiceCategories) {
    if (row.categoryId && !salonCatByGlobalCategoryId.has(row.categoryId)) {
      salonCatByGlobalCategoryId.set(row.categoryId, row.id);
    }
    if (row.name && !salonCatByName.has(row.name)) {
      salonCatByName.set(row.name, row.id);
    }
  }

  const createdServices = await prisma.$transaction(async (tx) => {
    const out: Array<Awaited<ReturnType<typeof tx.service.create>>> = [];
    for (const sel of selections) {
      const template = templateById.get(sel.templateId)!;

      let targetCategoryId: number | null = null;
      if (template.serviceCategory) {
        // Same-salon ServiceCategory row → use it directly.
        if (template.serviceCategory.salonId === salonId) {
          targetCategoryId = template.serviceCategory.id;
        } else if (template.serviceCategory.categoryId) {
          // Different salon → remap via global Category id.
          targetCategoryId = salonCatByGlobalCategoryId.get(template.serviceCategory.categoryId) ?? null;
        }
        if (targetCategoryId == null) {
          // Last-resort: match by ServiceCategory.name on the target salon.
          targetCategoryId = salonCatByName.get(template.serviceCategory.name) ?? null;
        }
      }

      try {
        const service = await tx.service.create({
          data: {
            name: template.name,
            duration: sel.durationMin,
            price: sel.priceTRY,
            salonId,
            isActive: true,
            categoryId: targetCategoryId ?? undefined,
          },
        });
        out.push(service);
      } catch (err) {
        // Surface unique-name conflicts as 400s instead of 500s.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BusinessError(
            'VALIDATION_FAILED',
            `"${template.name}" adlı hizmet bu salonda zaten mevcut.`,
            400,
            { templateId: template.id, name: template.name },
          );
        }
        throw err;
      }
    }
    return out;
  });

  return res.status(201).json({ created: createdServices.length, services: createdServices });
});

// ---------------------------------------------------------------------------
// Kedy Kurulum Yolculuğu (post-onboarding gamification).
// See src/services/journeyService.ts for the task catalog + scoring rules.
// ---------------------------------------------------------------------------

/**
 * GET /api/onboarding/journey
 *
 * Returns the current journey snapshot for the authenticated user's salon:
 * cached score, current stage, and one entry per task with its completion
 * flag. The dashboard renders the progress bar + checklist from this.
 */
router.get('/journey', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kapsamı bulunamadı.', 401);
  }
  const snapshot = await getJourney(req.user.salonId);
  return res.status(200).json(snapshot);
});

/**
 * POST /api/onboarding/journey/recompute
 *
 * Owner-only defensive recompute: scans current DB state and credits any
 * task whose detection signal is true (e.g. a salon that already has a
 * logo but no `logo_uploaded` row gets it filled in). Never rolls a
 * previously-completed task back to incomplete.
 *
 * Use cases: login boot, admin "Yenile" button on the dashboard.
 */
router.post('/journey/recompute', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kapsamı bulunamadı.', 401);
  }
  if (req.user.role !== 'OWNER') {
    throw new BusinessError('FORBIDDEN', 'Bu işlem yalnızca salon sahibi tarafından yapılabilir.', 403);
  }
  const snapshot = await recomputeJourney(req.user.salonId);
  return res.status(200).json(snapshot);
});

/**
 * POST /api/onboarding/journey/task
 *
 * Manual task completion trigger. Used by the frontend for tasks that
 * have no derivable backend signal (e.g. booking link "Paylaş" button)
 * and as an escape hatch for trigger sites that haven't been wired into
 * `markTaskComplete` yet.
 *
 * Body: { taskKey: JourneyTaskKey, metadata?: any }
 *
 * Idempotent: returns the current snapshot even if the task was already
 * completed; `stageChanged` flag tells the client whether to celebrate.
 */
router.post('/journey/task', authenticateToken, async (req: any, res: any) => {
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Salon kapsamı bulunamadı.', 401);
  }

  const taskKey = req.body?.taskKey;
  if (!isJourneyTaskKey(taskKey)) {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'taskKey geçerli bir journey görev anahtarı olmalı.',
      400,
    );
  }
  const metadata = req.body?.metadata;

  const result = await markTaskComplete(req.user.salonId, taskKey, metadata);
  const snapshot = await getJourney(req.user.salonId);

  return res.status(200).json({
    ...snapshot,
    stageChanged: result.stageChanged,
    newStage: result.newStage,
    previousStage: result.previousStage,
    taskJustCompleted: result.taskJustCompleted,
  });
});

export default router;
