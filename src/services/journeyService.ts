// "Kedy Kurulum Yolculuğu" — post-onboarding gamification tracking.
//
// After the owner finishes the onboarding wizard, the salon dashboard shows a
// 0–100 progress bar that fills as the salon completes a curated list of
// setup tasks (logo upload, services list, WhatsApp connection, …). Each
// task is worth a fixed number of points; the score determines the salon's
// current "stage" (Açılış / Müşteri Hazır / İletişim Açık / Profesyonel).
//
// Two flows write progress:
//   1. `markTaskComplete(salonId, taskKey)` — fire-and-forget trigger that
//      route handlers call when they know a task was just completed (e.g.
//      logo approve handler calls it with `logo_uploaded`). Idempotent: a
//      task that is already completed is a no-op.
//   2. `recomputeJourney(salonId)` — defensive scan that re-derives every
//      task's completion status from the current DB state. Used at login or
//      on an admin "Yenile" button so a salon that completed a task before
//      this system existed (or while the trigger was broken) doesn't lose
//      credit.
//
// Both functions write back the cached score + stage onto the Salon row so
// `GET /journey` doesn't need to re-aggregate on every dashboard render.

import { prisma } from '../prisma.js';
import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Task catalog. Scores sum to exactly 100.
// ---------------------------------------------------------------------------

export type JourneyStage =
  | 'ACILIS'
  | 'MUSTERI_HAZIR'
  | 'ILETISIM_ACIK'
  | 'PROFESYONEL';

export interface JourneyTaskDefinition {
  points: number;
  stage: JourneyStage;
  label: string;
}

export const JOURNEY_TASKS = {
  wizard_completed: {
    points: 30,
    stage: 'ACILIS',
    label: 'Onboarding wizard tamamlandı',
  },
  logo_uploaded: {
    points: 5,
    stage: 'MUSTERI_HAZIR',
    label: 'Logo eklendi',
  },
  services_added_min_5: {
    points: 5,
    stage: 'MUSTERI_HAZIR',
    label: 'En az 5 hizmet eklendi',
  },
  first_team_invited: {
    points: 10,
    stage: 'MUSTERI_HAZIR',
    label: 'İlk ekip üyesi davet edildi',
  },
  booking_link_shared: {
    points: 5,
    stage: 'MUSTERI_HAZIR',
    label: 'Randevu linki paylaşıldı',
  },
  whatsapp_connected: {
    points: 15,
    stage: 'ILETISIM_ACIK',
    label: 'WhatsApp bağlandı',
  },
  first_template_approved: {
    points: 10,
    stage: 'ILETISIM_ACIK',
    label: 'İlk şablon onaylandı',
  },
  instagram_connected: {
    points: 5,
    stage: 'PROFESYONEL',
    label: 'Instagram bağlandı',
  },
  faqs_added_min_5: {
    points: 5,
    stage: 'PROFESYONEL',
    label: 'En az 5 SSS eklendi',
  },
  first_campaign_created: {
    points: 5,
    stage: 'PROFESYONEL',
    label: 'İlk kampanya oluşturuldu',
  },
  working_hours_detailed: {
    points: 5,
    stage: 'PROFESYONEL',
    label: 'Haftalık çalışma saatleri detaylı tanımlandı',
  },
} as const satisfies Record<string, JourneyTaskDefinition>;

export type JourneyTaskKey = keyof typeof JOURNEY_TASKS;

const JOURNEY_TASK_KEYS = Object.keys(JOURNEY_TASKS) as JourneyTaskKey[];

export function isJourneyTaskKey(key: unknown): key is JourneyTaskKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(JOURNEY_TASKS, key);
}

// ---------------------------------------------------------------------------
// Score → Stage mapping.
//
// Score buckets are half-open at the top so 30 lands in MUSTERI_HAZIR (not
// in ACILIS) and 100 lands in PROFESYONEL. This matches how the frontend
// progress bar visualises "next milestone".
// ---------------------------------------------------------------------------

export function getStageForScore(score: number): JourneyStage {
  const s = Number.isFinite(score) ? score : 0;
  if (s < 30) return 'ACILIS';
  if (s < 55) return 'MUSTERI_HAZIR';
  if (s < 80) return 'ILETISIM_ACIK';
  return 'PROFESYONEL';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface JourneyTaskView {
  key: JourneyTaskKey;
  label: string;
  points: number;
  stage: JourneyStage;
  completed: boolean;
  completedAt: Date | null;
}

export interface JourneySnapshot {
  score: number;
  stage: JourneyStage;
  tasks: JourneyTaskView[];
}

/**
 * Compute current score from the persisted journey tasks for a salon.
 * Only tasks with completedAt != null count. Uses the points stored on
 * each row so a historical change to JOURNEY_TASKS doesn't retroactively
 * shift past scores.
 */
async function computeScoreFromDb(salonId: number): Promise<{
  score: number;
  completedKeys: Set<JourneyTaskKey>;
  completedAtByKey: Map<JourneyTaskKey, Date | null>;
}> {
  const rows = await prisma.salonJourneyTask.findMany({
    where: { salonId },
    select: { taskKey: true, completedAt: true, points: true },
  });
  let score = 0;
  const completedKeys = new Set<JourneyTaskKey>();
  const completedAtByKey = new Map<JourneyTaskKey, Date | null>();
  for (const row of rows) {
    if (!isJourneyTaskKey(row.taskKey)) continue;
    completedAtByKey.set(row.taskKey, row.completedAt ?? null);
    if (row.completedAt) {
      score += row.points;
      completedKeys.add(row.taskKey);
    }
  }
  return { score, completedKeys, completedAtByKey };
}

/**
 * Update Salon.kurulumScore + kurulumStage so dashboard reads don't have
 * to aggregate journey rows every render. No-ops if values match.
 */
async function persistCachedScore(
  salonId: number,
  score: number,
  stage: JourneyStage,
): Promise<{ previousStage: JourneyStage | null }> {
  const existing = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { kurulumScore: true, kurulumStage: true },
  });
  const previousStage = (existing?.kurulumStage as JourneyStage | null) ?? null;
  if (existing && existing.kurulumScore === score && existing.kurulumStage === stage) {
    return { previousStage };
  }
  await prisma.salon.update({
    where: { id: salonId },
    data: { kurulumScore: score, kurulumStage: stage },
  });
  return { previousStage };
}

function toSnapshot(
  score: number,
  stage: JourneyStage,
  completedAtByKey: Map<JourneyTaskKey, Date | null>,
): JourneySnapshot {
  const tasks: JourneyTaskView[] = JOURNEY_TASK_KEYS.map((key) => {
    const def = JOURNEY_TASKS[key];
    const completedAt = completedAtByKey.get(key) ?? null;
    return {
      key,
      label: def.label,
      points: def.points,
      stage: def.stage,
      completed: !!completedAt,
      completedAt,
    };
  });
  return { score, stage, tasks };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Snapshot of the current journey state for a salon: score, stage and one
 * row per task with its completion flag. Used by GET /journey.
 */
export async function getJourney(salonId: number): Promise<JourneySnapshot> {
  const { score, completedAtByKey } = await computeScoreFromDb(salonId);
  const stage = getStageForScore(score);
  // Keep cached fields in sync opportunistically — guards against rows being
  // deleted out from under the cache.
  await persistCachedScore(salonId, score, stage);
  return toSnapshot(score, stage, completedAtByKey);
}

export interface MarkTaskCompleteResult {
  score: number;
  stage: JourneyStage;
  /** True when the salon just crossed into a new stage. Frontend triggers confetti. */
  stageChanged: boolean;
  newStage: JourneyStage;
  previousStage: JourneyStage | null;
  /** True iff this call flipped the row from incomplete to complete. */
  taskJustCompleted: boolean;
}

/**
 * Idempotent: marks `taskKey` complete for `salonId`. If the task is
 * already completed, returns the current state unchanged (taskJustCompleted
 * = false, stageChanged = false).
 *
 * Auto-triggers from route handlers should wrap this in try/catch — see
 * journey trigger sites for the pattern.
 */
export async function markTaskComplete(
  salonId: number,
  taskKey: JourneyTaskKey,
  metadata?: Prisma.InputJsonValue,
): Promise<MarkTaskCompleteResult> {
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new Error(`markTaskComplete: invalid salonId ${salonId}`);
  }
  if (!isJourneyTaskKey(taskKey)) {
    throw new Error(`markTaskComplete: unknown taskKey ${String(taskKey)}`);
  }

  const definition = JOURNEY_TASKS[taskKey];
  const now = new Date();

  // Upsert. If the row already exists and is completed, we treat this as a
  // no-op for the completion flag (we still refresh metadata if provided).
  const existing = await prisma.salonJourneyTask.findUnique({
    where: { salon_task_unique: { salonId, taskKey } },
    select: { id: true, completedAt: true },
  });

  let taskJustCompleted = false;

  if (!existing) {
    await prisma.salonJourneyTask.create({
      data: {
        salonId,
        taskKey,
        points: definition.points,
        completedAt: now,
        metadata: metadata ?? undefined,
      },
    });
    taskJustCompleted = true;
  } else if (!existing.completedAt) {
    await prisma.salonJourneyTask.update({
      where: { id: existing.id },
      data: {
        completedAt: now,
        points: definition.points,
        ...(metadata !== undefined ? { metadata } : {}),
      },
    });
    taskJustCompleted = true;
  } else if (metadata !== undefined) {
    // Already completed — keep completedAt, only refresh metadata.
    await prisma.salonJourneyTask.update({
      where: { id: existing.id },
      data: { metadata },
    });
  }

  const { score } = await computeScoreFromDb(salonId);
  const stage = getStageForScore(score);
  const { previousStage } = await persistCachedScore(salonId, score, stage);
  const stageChanged = previousStage !== stage;

  return {
    score,
    stage,
    stageChanged,
    newStage: stage,
    previousStage,
    taskJustCompleted,
  };
}

/**
 * Defensive recompute: inspect the current DB state for the salon, decide
 * which tasks should be considered complete, and write back to
 * SalonJourneyTask + cached score. Safe to call repeatedly; never resets
 * a previously-completed task back to incomplete (so manual triggers
 * always win — e.g. once we've marked `booking_link_shared` we keep it).
 *
 * Detection rules per task:
 *   - wizard_completed:        Salon.onboardingStep === 'COMPLETED'
 *   - logo_uploaded:           Salon.logoUrl != null
 *   - services_added_min_5:    >= 5 Service rows for salon
 *   - first_team_invited:      >= 2 active SalonMembership rows (owner + 1)
 *   - booking_link_shared:     manual-only — preserved if already complete
 *   - whatsapp_connected:      Salon.chakraPluginId != null
 *   - first_template_approved: any SalonMessageTemplate with metaStatus = 'APPROVED'
 *   - instagram_connected:     Salon.instagramUrl != null (schema has instagramUrl, not instagramAccountId)
 *   - faqs_added_min_5:        SalonAiAgentSettings.faqAnswers has >= 5 entries
 *   - first_campaign_created:  any Campaign row for salon
 *   - working_hours_detailed:  SalonSettings.workingDays has all 7 weekday keys set
 */
export async function recomputeJourney(salonId: number): Promise<JourneySnapshot> {
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new Error(`recomputeJourney: invalid salonId ${salonId}`);
  }

  const [
    salon,
    settings,
    aiSettings,
    serviceCount,
    membershipCount,
    approvedTemplateCount,
    campaignCount,
  ] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        onboardingStep: true,
        logoUrl: true,
        chakraPluginId: true,
        instagramUrl: true,
      },
    }),
    prisma.salonSettings.findUnique({
      where: { salonId },
      select: { workingDays: true },
    }),
    prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: { faqAnswers: true },
    }),
    prisma.service.count({ where: { salonId } }),
    prisma.salonMembership.count({ where: { salonId, isActive: true } }),
    prisma.salonMessageTemplate.count({
      where: { salonId, metaStatus: 'APPROVED' },
    }),
    prisma.campaign.count({ where: { salonId } }),
  ]);

  if (!salon) {
    throw new Error(`recomputeJourney: salon ${salonId} not found`);
  }

  // Working hours detection: workingDays JSON must include all 7 weekdays
  // (1–7 or 0–6 keys — we accept either) AND at least one slot per day.
  // Anything narrower would either gate legitimate setups or leak through
  // null defaults.
  const workingDaysComplete = (() => {
    const wd = settings?.workingDays as unknown;
    if (!wd || typeof wd !== 'object' || Array.isArray(wd)) return false;
    const entries = Object.entries(wd as Record<string, unknown>);
    if (entries.length < 7) return false;
    // Each value must be truthy (e.g. { open, close } or true).
    return entries.every(([, v]) => v !== null && v !== undefined && v !== false);
  })();

  // FAQ detection: SalonAiAgentSettings.faqAnswers is a free-form JSON
  // (admin enters Q&A pairs). Count any "list-like" shape with ≥5 items.
  const faqCount = (() => {
    const fa = aiSettings?.faqAnswers as unknown;
    if (Array.isArray(fa)) return fa.length;
    if (fa && typeof fa === 'object') {
      const arr = (fa as any).items || (fa as any).questions || (fa as any).faqs;
      if (Array.isArray(arr)) return arr.length;
      return Object.keys(fa as Record<string, unknown>).length;
    }
    return 0;
  })();

  const detected: Record<JourneyTaskKey, boolean> = {
    wizard_completed: salon.onboardingStep === 'COMPLETED',
    logo_uploaded: !!salon.logoUrl,
    services_added_min_5: serviceCount >= 5,
    first_team_invited: membershipCount >= 2,
    // booking_link_shared has no derivable signal — handled below by preserving
    // any prior completion.
    booking_link_shared: false,
    whatsapp_connected: !!salon.chakraPluginId,
    first_template_approved: approvedTemplateCount > 0,
    instagram_connected: !!salon.instagramUrl,
    faqs_added_min_5: faqCount >= 5,
    first_campaign_created: campaignCount > 0,
    working_hours_detailed: workingDaysComplete,
  };

  // Load current rows so we (a) preserve manual-only completions and (b)
  // never undo a previously completed task.
  const existingRows = await prisma.salonJourneyTask.findMany({
    where: { salonId },
    select: { id: true, taskKey: true, completedAt: true },
  });
  const existingByKey = new Map<string, { id: number; completedAt: Date | null }>();
  for (const row of existingRows) {
    existingByKey.set(row.taskKey, { id: row.id, completedAt: row.completedAt ?? null });
  }

  const now = new Date();
  for (const key of JOURNEY_TASK_KEYS) {
    const def = JOURNEY_TASKS[key];
    const shouldBeComplete = detected[key];
    const existing = existingByKey.get(key);
    const alreadyComplete = !!existing?.completedAt;

    if (shouldBeComplete && !alreadyComplete) {
      if (existing) {
        await prisma.salonJourneyTask.update({
          where: { id: existing.id },
          data: { completedAt: now, points: def.points },
        });
      } else {
        await prisma.salonJourneyTask.create({
          data: {
            salonId,
            taskKey: key,
            points: def.points,
            completedAt: now,
          },
        });
      }
    }
    // If shouldBeComplete is false but alreadyComplete is true, do nothing:
    // we never roll a task back from complete (e.g. don't punish a salon
    // that briefly cleared its logo).
  }

  return getJourney(salonId);
}
