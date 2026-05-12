// Wave-based, queue-driven Meta template submission worker.
//
// At salon WABA connect time we INSERT 90 NOT_QUEUED SalonMessageTemplate
// rows (10 sohbet templates × 3 tones × 3 primary slots) with staggered
// `scheduledSubmitAt` timestamps. Submissions go in three waves of 30
// rows each (one per tone), starting with the salon's active tone.
//
// Within each wave: 30 sec between submissions → 15 min/wave.
// Between waves: 5 min gap to give Meta room to process.
// Total time to submit all 90 primary variations: ~55 min.
//
// A background tick (every 60 sec) picks rows where
//   submissionState = NOT_QUEUED AND scheduledSubmitAt <= NOW()
// and POSTs them to Meta via Chakra's API, transitioning to SUBMITTED.
//
// Reserve rows (slots 4-10) are NOT created upfront. They get inserted
// lazily by the webhook handler when a primary row fails (REJECTED or
// CATEGORY_BUMPED), so we never submit more variations than necessary.

import { Prisma, SalonCommunicationTone, TemplateSubmissionState } from '@prisma/client';
import * as Sentry from '@sentry/node';
import axios from 'axios';
import { prisma } from '../prisma.js';
import {
  ALL_TONES,
  TEMPLATE_EXPECTED_CATEGORY,
  ToneTier,
  buildTemplateName,
  getVariationBySlot,
  listTemplateKeys,
  toneToTier,
} from './templateVariations.js';

const CHAKRA_API_BASE = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').replace(/\/$/, '') || 'https://chakra.berkai.shop';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN || '';
const SUBMIT_INTERVAL_SEC = 30;
const WAVE_GAP_SEC = 300;
const TICK_INTERVAL_MS = 60_000;

// ─────────────────────────────────────────────────────────────────
// Template metadata — Meta API payload builders per logical key.
// Each entry knows: which AppointmentMessageEventType it maps to,
// which named params it has, and any buttons to attach.
// ─────────────────────────────────────────────────────────────────
interface TemplateMeta {
  logicalKey: string;
  eventType: string;
  paramNames: string[];
  paramExamples: Record<string, string>;
  buttons?: any[];
}

const PARAM_EXAMPLES: Record<string, string> = {
  customer_name: 'Ayşe',
  customer_surname: 'Yılmaz',
  customer_honorific: 'Hanım',
  appointment_date: '14 Nisan',
  appointment_time: '15:30',
  service_name: 'Saç Kesimi',
  location_url: 'https://maps.google.com/?q=Salon',
  late_policy_hours: '24',
  salon_name: 'Bella Studio',
  discount_amount: '%15',
  validity_period: '7 gün',
};

const TEMPLATES: TemplateMeta[] = [
  {
    logicalKey: 'kedy_randevu_onay',
    eventType: 'CONFIRMATION',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'appointment_date', 'appointment_time', 'service_name', 'location_url'],
    paramExamples: PARAM_EXAMPLES,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Onaylıyorum ✅' },
      { type: 'QUICK_REPLY', text: 'İptal Et ❌' },
    ],
  },
  {
    logicalKey: 'kedy_randevu_hatirlatma_1_gun',
    eventType: 'REMINDER_1_DAY',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'appointment_date', 'appointment_time', 'service_name'],
    paramExamples: PARAM_EXAMPLES,
    buttons: [
      { type: 'QUICK_REPLY', text: 'Geliyorum 👍' },
      { type: 'QUICK_REPLY', text: 'Gelemiyorum 👎' },
    ],
  },
  {
    logicalKey: 'kedy_randevu_hatirlatma_3_gun',
    eventType: 'REMINDER_3_DAY',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'appointment_date', 'appointment_time', 'service_name', 'late_policy_hours'],
    paramExamples: PARAM_EXAMPLES,
  },
  {
    logicalKey: 'kedy_randevu_hatirlatma_2_saat',
    eventType: 'REMINDER_2_HOUR',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'appointment_time', 'service_name', 'location_url'],
    paramExamples: PARAM_EXAMPLES,
    buttons: [
      { type: 'URL', text: 'Yol Tarifi', url: 'https://maps.google.com/?q=Salon' },
    ],
  },
  {
    logicalKey: 'kedy_no_show_hatirlatma',
    eventType: 'NO_SHOW',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'appointment_date', 'appointment_time', 'service_name', 'late_policy_hours'],
    paramExamples: PARAM_EXAMPLES,
  },
  {
    logicalKey: 'kedy_waitlist_teklif',
    eventType: 'WAITLIST_OFFER',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'appointment_date', 'appointment_time', 'service_name'],
    paramExamples: PARAM_EXAMPLES,
    buttons: [
      { type: 'URL', text: 'Teklifi Gör', url: 'https://app.berkai.shop/booking?waitlistOffer={{1}}', example: ['offer_token'] },
    ],
  },
  {
    logicalKey: 'kedy_memnuniyet_anketi',
    eventType: 'SATISFACTION_SURVEY',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'service_name'],
    paramExamples: PARAM_EXAMPLES,
    buttons: [
      { type: 'URL', text: 'Değerlendir', url: 'https://app.berkai.shop/feedback/{{1}}', example: ['feedback_token'] },
    ],
  },
  {
    logicalKey: 'kedy_google_maps_yorum',
    eventType: 'GOOGLE_MAPS_REVIEW',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'salon_name'],
    paramExamples: PARAM_EXAMPLES,
    buttons: [
      { type: 'URL', text: "Google'da Yorum Yap", url: 'https://maps.google.com/?q=Salon', example: ['https://maps.google.com/?q=Salon'] },
    ],
  },
  {
    logicalKey: 'kedy_dogum_gunu_kutlamasi',
    eventType: 'BIRTHDAY',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'discount_amount', 'validity_period'],
    paramExamples: PARAM_EXAMPLES,
  },
  {
    logicalKey: 'kedy_geri_donus',
    eventType: 'WINBACK',
    paramNames: ['customer_name', 'customer_surname', 'customer_honorific', 'discount_amount', 'validity_period'],
    paramExamples: PARAM_EXAMPLES,
  },
];

const TEMPLATE_META_BY_KEY: Record<string, TemplateMeta> = Object.fromEntries(
  TEMPLATES.map(t => [t.logicalKey, t])
);

// ─────────────────────────────────────────────────────────────────
// Build the Meta submit payload for a (logicalKey, bodyText) pair.
// Extracts only the named params actually used in `bodyText` and
// includes their examples.
// ─────────────────────────────────────────────────────────────────
function buildMetaPayload(logicalKey: string, templateName: string, bodyText: string) {
  const meta = TEMPLATE_META_BY_KEY[logicalKey];
  if (!meta) throw new Error(`Unknown template logical key: ${logicalKey}`);

  // Only declare params that actually appear in this body variation.
  const usedParams = meta.paramNames.filter(p => bodyText.includes(`{{${p}}}`));
  const bodyExamples = usedParams.map(p => ({
    param_name: p,
    example: meta.paramExamples[p] ?? p,
  }));

  const components: any[] = [
    {
      type: 'BODY',
      text: bodyText,
      ...(bodyExamples.length > 0 ? { example: { body_text_named_params: bodyExamples } } : {}),
    },
  ];
  if (meta.buttons) {
    components.push({ type: 'BUTTONS', buttons: meta.buttons });
  }

  return {
    name: templateName,
    category: TEMPLATE_EXPECTED_CATEGORY[logicalKey] || 'UTILITY',
    language: 'tr',
    parameter_format: 'NAMED',
    components,
  };
}

// ─────────────────────────────────────────────────────────────────
// enqueueSalonTemplates — called when salon connects WABA.
// Inserts 90 NOT_QUEUED rows (10 templates × 3 tones × 3 primary slots).
// Wave 1 = active tone, then the other two tones in standard order.
// ─────────────────────────────────────────────────────────────────
export async function enqueueSalonTemplates(opts: {
  salonId: number;
  tone: SalonCommunicationTone;
  startAt?: Date;
}): Promise<{ enqueued: number }> {
  const { salonId, tone } = opts;
  const activeTone = toneToTier(tone);
  const otherTones = ALL_TONES.filter(t => t !== activeTone);
  const waveOrder: ToneTier[] = [activeTone, ...otherTones];

  const startAt = opts.startAt ?? new Date();
  const rows: Prisma.SalonMessageTemplateCreateManyInput[] = [];

  const logicalKeys = listTemplateKeys();
  let offsetSec = 0;

  for (let waveIdx = 0; waveIdx < waveOrder.length; waveIdx++) {
    const waveTone = waveOrder[waveIdx];
    if (waveIdx > 0) offsetSec += WAVE_GAP_SEC; // 5-min gap between waves

    for (const logicalKey of logicalKeys) {
      const meta = TEMPLATE_META_BY_KEY[logicalKey];
      if (!meta) continue;

      for (let slot = 1; slot <= 3; slot++) {
        const body = getVariationBySlot(logicalKey, waveTone, slot);
        if (!body) continue;

        rows.push({
          salonId,
          eventType: meta.eventType as any,
          locale: 'tr' as any,
          templateName: buildTemplateName(logicalKey, waveTone, slot),
          templateContent: body,
          templateKey: logicalKey,
          tone: waveTone as SalonCommunicationTone,
          variantSlot: slot,
          expectedCategory: TEMPLATE_EXPECTED_CATEGORY[logicalKey] || 'UTILITY',
          submissionState: 'NOT_QUEUED',
          scheduledSubmitAt: new Date(startAt.getTime() + offsetSec * 1000),
          isActive: true,
        });

        offsetSec += SUBMIT_INTERVAL_SEC;
      }
    }
  }

  // Skip rows that already exist (idempotent — salon may reconnect).
  const result = await prisma.salonMessageTemplate.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return { enqueued: result.count };
}

// ─────────────────────────────────────────────────────────────────
// submitOneToMeta — POSTs a single template to Meta via Chakra.
// On success: state = SUBMITTED, lastSubmittedAt = now.
// On failure: state stays NOT_QUEUED, attempts++, reschedule 5 min out.
// ─────────────────────────────────────────────────────────────────
async function submitOneToMeta(opts: {
  rowId: number;
  salonId: number;
  pluginId: string;
  logicalKey: string;
  templateName: string;
  body: string;
}): Promise<{ ok: boolean; error?: string; externalId?: string }> {
  const { rowId, pluginId, logicalKey, templateName, body } = opts;

  if (!CHAKRA_API_TOKEN) {
    return { ok: false, error: 'CHAKRA_API_TOKEN missing' };
  }

  // Resolve wabaId from plugin state.
  let wabaId: string | null = null;
  try {
    const pluginRes = await axios.get(
      `${CHAKRA_API_BASE}/plugin/${pluginId}`,
      { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` }, timeout: 15_000 }
    );
    const wabaMap = pluginRes?.data?._data?.auth?.whatsappBusinessAccountsById;
    wabaId = wabaMap ? Object.keys(wabaMap)[0] : null;
  } catch (err: any) {
    return { ok: false, error: `Plugin fetch failed: ${err?.message || err}` };
  }
  if (!wabaId) return { ok: false, error: 'No WABA bound to plugin' };

  const submitUrl = `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/api/v22.0/${wabaId}/message_templates`;
  const payload = buildMetaPayload(logicalKey, templateName, body);

  try {
    const resp = await axios.post(submitUrl, payload, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
      timeout: 30_000,
    });
    const externalId = resp?.data?.id || resp?.data?.data?.id;
    return { ok: true, externalId: externalId ? String(externalId) : undefined };
  } catch (err: any) {
    const detail = err?.response?.data || err?.message;
    return { ok: false, error: typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500) };
  }
}

// ─────────────────────────────────────────────────────────────────
// runSubmissionTick — drains the queue.
// Called every TICK_INTERVAL_MS by the background worker.
// ─────────────────────────────────────────────────────────────────
export async function runSubmissionTick(opts?: { batchSize?: number }): Promise<{ submitted: number; failed: number }> {
  const batchSize = opts?.batchSize ?? 10;
  const now = new Date();

  const ready = await prisma.salonMessageTemplate.findMany({
    where: {
      submissionState: 'NOT_QUEUED',
      scheduledSubmitAt: { lte: now },
      templateKey: { not: null },
    },
    orderBy: { scheduledSubmitAt: 'asc' },
    take: batchSize,
  });

  if (ready.length === 0) return { submitted: 0, failed: 0 };

  // Group by salonId so we can resolve pluginId once per salon.
  const salonIds = [...new Set(ready.map(r => r.salonId))];
  const salons = await prisma.salon.findMany({
    where: { id: { in: salonIds } },
    select: { id: true, chakraPluginId: true },
  });
  const pluginBySalon = new Map(salons.map(s => [s.id, s.chakraPluginId]));

  let submitted = 0;
  let failed = 0;

  for (const row of ready) {
    const pluginId = pluginBySalon.get(row.salonId);
    if (!pluginId) {
      // Salon WABA was disconnected. Cancel the queued submission instead
      // of looping forever — it'll be re-enqueued on next reconnect.
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: {
          submissionState: 'POOL_EXHAUSTED',
          rejectionReason: 'WABA disconnected',
          scheduledSubmitAt: null,
        },
      });
      failed++;
      continue;
    }
    if (!row.templateKey || !row.templateName || !row.templateContent) {
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: {
          submissionAttempts: { increment: 1 },
          rejectionReason: 'Missing template fields',
          scheduledSubmitAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
      failed++;
      continue;
    }

    const result = await submitOneToMeta({
      rowId: row.id,
      salonId: row.salonId,
      pluginId,
      logicalKey: row.templateKey,
      templateName: row.templateName,
      body: row.templateContent,
    });

    if (result.ok) {
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: {
          submissionState: 'SUBMITTED',
          lastSubmittedAt: new Date(),
          submissionAttempts: { increment: 1 },
          externalId: result.externalId ?? row.externalId,
          metaStatus: 'PENDING',
          rejectionReason: null,
        },
      });
      submitted++;
    } else {
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: {
          submissionAttempts: { increment: 1 },
          rejectionReason: (result.error || '').slice(0, 500),
          // Retry in 5 min on transient failure.
          scheduledSubmitAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
      failed++;
      console.warn('[salonTemplateSubmitter] submit failed', {
        rowId: row.id,
        templateName: row.templateName,
        error: result.error,
      });
    }
  }

  return { submitted, failed };
}

// ─────────────────────────────────────────────────────────────────
// promoteReserveVariation — called by webhook handler when a primary
// row goes REJECTED or CATEGORY_BUMPED. Creates a new SalonMessageTemplate
// row for the next available reserve slot of the same (key, tone), with
// scheduledSubmitAt = now (immediate next tick).
// Returns null if pool exhausted.
// ─────────────────────────────────────────────────────────────────
export async function promoteReserveVariation(opts: {
  salonId: number;
  logicalKey: string;
  tone: SalonCommunicationTone;
}): Promise<{ created: boolean; slot?: number; reason?: string }> {
  const { salonId, logicalKey, tone } = opts;
  const toneTier = toneToTier(tone);

  // Find used slots in this (salon, key, tone) — across ALL states.
  const used = await prisma.salonMessageTemplate.findMany({
    where: { salonId, templateKey: logicalKey, tone },
    select: { variantSlot: true },
  });
  const usedSlots = new Set(used.map(r => r.variantSlot).filter((s): s is number => s !== null));

  // Find first unused slot in 4..10 (reserve range).
  let nextSlot: number | null = null;
  for (let s = 4; s <= 10; s++) {
    if (!usedSlots.has(s)) { nextSlot = s; break; }
  }
  if (nextSlot === null) return { created: false, reason: 'pool_exhausted' };

  const body = getVariationBySlot(logicalKey, toneTier, nextSlot);
  if (!body) return { created: false, reason: 'no_variation_body' };

  const meta = TEMPLATE_META_BY_KEY[logicalKey];
  if (!meta) return { created: false, reason: 'unknown_logical_key' };

  await prisma.salonMessageTemplate.create({
    data: {
      salonId,
      eventType: meta.eventType as any,
      locale: 'tr' as any,
      templateName: buildTemplateName(logicalKey, toneTier, nextSlot),
      templateContent: body,
      templateKey: logicalKey,
      tone,
      variantSlot: nextSlot,
      expectedCategory: TEMPLATE_EXPECTED_CATEGORY[logicalKey] || 'UTILITY',
      submissionState: 'NOT_QUEUED',
      scheduledSubmitAt: new Date(),
      isActive: true,
    },
  });

  return { created: true, slot: nextSlot };
}

// ─────────────────────────────────────────────────────────────────
// markPoolExhaustedIfNeeded — checks if we should give up trying.
// Called by webhook handler after a row becomes REJECTED/CATEGORY_BUMPED.
// If all 10 slots used and ACTIVE_VALID count < 3, marks all remaining
// non-active rows as POOL_EXHAUSTED.
// ─────────────────────────────────────────────────────────────────
export async function markPoolExhaustedIfNeeded(opts: {
  salonId: number;
  logicalKey: string;
  tone: SalonCommunicationTone;
}): Promise<{ exhausted: boolean }> {
  const { salonId, logicalKey, tone } = opts;
  const rows = await prisma.salonMessageTemplate.findMany({
    where: { salonId, templateKey: logicalKey, tone },
    select: { variantSlot: true, submissionState: true },
  });

  const allSlotsUsed = rows.length >= 10;
  const validCount = rows.filter(r => r.submissionState === 'ACTIVE_VALID').length;

  if (allSlotsUsed && validCount < 3) {
    await prisma.salonMessageTemplate.updateMany({
      where: {
        salonId,
        templateKey: logicalKey,
        tone,
        submissionState: { in: ['NOT_QUEUED', 'SUBMITTED', 'REJECTED', 'CATEGORY_BUMPED'] },
      },
      data: { submissionState: 'POOL_EXHAUSTED' },
    });

    // Admin notification: 10 variations exhausted, < 3 approved. Manual
    // template editing required. Sentry alert + console error for now;
    // ops dashboard can listen on Sentry tag template_pool_exhausted.
    const message = `Template pool exhausted: salon=${salonId}, template=${logicalKey}, tone=${tone}, validCount=${validCount}`;
    console.error('[salonTemplateSubmitter] POOL_EXHAUSTED', { salonId, logicalKey, tone, validCount });
    try {
      Sentry.captureMessage(message, {
        level: 'error',
        tags: {
          template_pool_exhausted: 'true',
          salonId: String(salonId),
          templateKey: logicalKey,
          tone: String(tone),
        },
      });
    } catch {
      // Sentry init may not be ready — fall back to console.
    }
    return { exhausted: true };
  }
  return { exhausted: false };
}

// ─────────────────────────────────────────────────────────────────
// Background worker
// ─────────────────────────────────────────────────────────────────
let workerTimer: NodeJS.Timeout | null = null;

export function startSubmissionWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    runSubmissionTick().catch(err => {
      console.error('[salonTemplateSubmitter] tick error:', err);
    });
  }, TICK_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
  console.log('[salonTemplateSubmitter] background worker started (tick =', TICK_INTERVAL_MS, 'ms)');
}

export function stopSubmissionWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

/**
 * Cancel all queued (NOT_QUEUED/SUBMITTED) template submissions for a salon.
 * Call this when WABA is disconnected — prevents the worker from looping on
 * a now-invalid pluginId. Approved (ACTIVE_VALID) and rejected rows are left
 * alone so the historic state survives.
 */
export async function cancelPendingSubmissions(salonId: number): Promise<{ cancelled: number }> {
  const result = await prisma.salonMessageTemplate.updateMany({
    where: {
      salonId,
      submissionState: { in: ['NOT_QUEUED', 'SUBMITTED'] },
    },
    data: {
      submissionState: 'POOL_EXHAUSTED',
      rejectionReason: 'WABA disconnected',
      scheduledSubmitAt: null,
    },
  });
  return { cancelled: result.count };
}
