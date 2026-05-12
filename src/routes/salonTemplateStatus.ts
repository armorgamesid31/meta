// GET /api/salon/templates/status
//
// Returns operational template status for the current salon — used by
// the mobile WhatsAppTemplateStatusPage. Each logical template is
// represented by one entry with its friendly name, category, and an
// aggregated status derived from its 1-9 underlying SalonMessageTemplate
// rows (1 per tone per variant slot, for the active tone).

import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import {
  OPERATIONAL_TEMPLATES,
  OperationalStatus,
} from '../services/templateOperationalNames.js';
import { enqueueSalonTemplates } from '../services/salonTemplateSubmitter.js';
import { listTemplateKeys, ALL_TONES } from '../services/templateVariations.js';

const router = Router();

interface TemplateStatusItem {
  key: string;
  name: string;
  category: string;
  description: string;
  status: OperationalStatus;
}

function aggregateStatus(
  rows: Array<{ submissionState: string; expectedCategory: string | null; metaStatus: string | null }>,
): OperationalStatus {
  if (rows.length === 0) return 'not_queued';
  const states = rows.map(r => r.submissionState);

  // 1. At least one variant approved + category preserved → Hazır.
  if (states.includes('ACTIVE_VALID')) return 'active';

  // 2. All slots tried, none valid → Onay alınamadı.
  const allExhausted = rows.every(r => r.submissionState === 'POOL_EXHAUSTED');
  if (allExhausted) return 'unavailable';

  // 3. Some failed but worker still has reserves coming → Yedekler deneniyor.
  if (states.some(s => s === 'REJECTED' || s === 'CATEGORY_BUMPED')) {
    return 'transient_issue';
  }

  // 4. At least one row sent to Meta → Meta onayında.
  if (states.includes('SUBMITTED')) return 'submitted';

  // 5. Only NOT_QUEUED rows remain → Sırada bekliyor.
  if (states.includes('NOT_QUEUED')) return 'queued';

  return 'not_queued';
}

router.get('/templates/status', authenticateToken, async (req: any, res) => {
  if (!req.user?.salonId) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId as number;

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { communicationTone: true, chakraPluginId: true },
  });

  if (!salon?.chakraPluginId) {
    return res.status(200).json({
      whatsappConnected: false,
      total: 0,
      active: 0,
      pending: 0,
      templates: [],
    });
  }

  const activeTone = salon.communicationTone || 'BALANCED';

  // Only count tone-varied rows for the active tone. Legacy non-tone-varied
  // rows (templateKey=null) are explicitly ignored — they belong to the old
  // pre-queue system and no longer reflect the salon's current pipeline.
  const allRows = await prisma.salonMessageTemplate.findMany({
    where: {
      salonId,
      tone: activeTone,
      templateKey: { not: null },
    },
    select: {
      templateKey: true,
      templateName: true,
      submissionState: true,
      expectedCategory: true,
      metaStatus: true,
    },
  });

  const byLogicalKey: Record<string, typeof allRows> = {};
  for (const row of allRows) {
    const key = row.templateKey || row.templateName?.replace(/_[fbp]\d+$/, '') || row.templateName;
    if (!key) continue;
    if (!byLogicalKey[key]) byLogicalKey[key] = [];
    byLogicalKey[key].push(row);
  }

  const templates: TemplateStatusItem[] = OPERATIONAL_TEMPLATES.map(op => {
    const rows = byLogicalKey[op.logicalKey] || [];
    return {
      key: op.logicalKey,
      name: op.displayName,
      category: op.category,
      description: op.description,
      status: aggregateStatus(rows),
    };
  });

  const total = templates.length;
  const counts = {
    active:         templates.filter(t => t.status === 'active').length,
    submitted:      templates.filter(t => t.status === 'submitted').length,
    queued:         templates.filter(t => t.status === 'queued').length,
    notQueued:      templates.filter(t => t.status === 'not_queued').length,
    transientIssue: templates.filter(t => t.status === 'transient_issue').length,
    unavailable:    templates.filter(t => t.status === 'unavailable').length,
  };

  return res.status(200).json({
    whatsappConnected: true,
    activeTone,
    total,
    active: counts.active,
    submitted: counts.submitted,
    queued: counts.queued,
    notQueued: counts.notQueued,
    pending: counts.queued + counts.submitted + counts.transientIssue,
    unavailable: counts.unavailable,
    counts,
    templates,
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/salon/templates/debug
// Returns the raw SalonMessageTemplate state for this salon so the mobile
// admin can see exactly what's in the queue, what's pending submission to
// Meta, what's been approved/rejected, and what's missing entirely.
// ─────────────────────────────────────────────────────────────────
router.get('/templates/debug', authenticateToken, async (req: any, res) => {
  if (!req.user?.salonId) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId as number;

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true, name: true, communicationTone: true,
      chakraPluginId: true, chakraPhoneNumberId: true,
    },
  });

  const rows = await prisma.salonMessageTemplate.findMany({
    where: { salonId },
    orderBy: [{ templateKey: 'asc' }, { tone: 'asc' }, { variantSlot: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      templateName: true,
      templateKey: true,
      tone: true,
      variantSlot: true,
      submissionState: true,
      metaStatus: true,
      metaCategory: true,
      expectedCategory: true,
      actualCategory: true,
      submissionAttempts: true,
      scheduledSubmitAt: true,
      lastSubmittedAt: true,
      approvedAt: true,
      rejectedAt: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // State breakdown
  const stateBreakdown: Record<string, number> = {};
  for (const r of rows) stateBreakdown[r.submissionState] = (stateBreakdown[r.submissionState] || 0) + 1;

  // Per logical key coverage (for active tone) — how many slots filled vs expected
  const activeTone = salon?.communicationTone || 'BALANCED';
  const coverage = OPERATIONAL_TEMPLATES.map(op => {
    const toneVaried = listTemplateKeys().includes(op.logicalKey);
    const matchedRows = rows.filter(r =>
      r.templateKey === op.logicalKey ||
      r.templateName === op.logicalKey
    );
    const activeToneRows = matchedRows.filter(r => r.tone === activeTone || r.tone === null);
    return {
      logicalKey: op.logicalKey,
      displayName: op.displayName,
      expectedSlots: toneVaried ? 3 : 1,
      rowsInActiveTone: activeToneRows.length,
      rowsByState: activeToneRows.reduce((acc, r) => {
        acc[r.submissionState] = (acc[r.submissionState] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      hasApprovedMeta: activeToneRows.some(r => r.metaStatus === 'APPROVED'),
    };
  });

  return res.status(200).json({
    salon,
    activeTone,
    summary: {
      totalRows: rows.length,
      stateBreakdown,
      readyToSubmitNow: rows.filter(r =>
        r.submissionState === 'NOT_QUEUED' &&
        r.scheduledSubmitAt &&
        r.scheduledSubmitAt <= new Date()
      ).length,
      scheduledFuture: rows.filter(r =>
        r.submissionState === 'NOT_QUEUED' &&
        r.scheduledSubmitAt &&
        r.scheduledSubmitAt > new Date()
      ).length,
      orphanNoSchedule: rows.filter(r =>
        r.submissionState === 'NOT_QUEUED' && !r.scheduledSubmitAt
      ).length,
    },
    coverage,
    rows: rows.map(r => ({
      ...r,
      scheduledSubmitAt: r.scheduledSubmitAt?.toISOString() || null,
      lastSubmittedAt: r.lastSubmittedAt?.toISOString() || null,
      approvedAt: r.approvedAt?.toISOString() || null,
      rejectedAt: r.rejectedAt?.toISOString() || null,
      createdAt: r.createdAt?.toISOString() || null,
      updatedAt: r.updatedAt?.toISOString() || null,
    })),
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/salon/templates/sync
// Salon-facing manual sync trigger. Cleans up orphan NOT_QUEUED rows with
// no scheduledSubmitAt (legacy bug — they'd never submit), then calls
// enqueueSalonTemplates which inserts the 90 tone-varied primary rows
// if they don't already exist (skipDuplicates).
// ─────────────────────────────────────────────────────────────────
router.post('/templates/sync', authenticateToken, async (req: any, res) => {
  if (!req.user?.salonId) throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  const salonId = req.user.salonId as number;

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { communicationTone: true, chakraPluginId: true },
  });
  if (!salon?.chakraPluginId) {
    return res.status(400).json({
      ok: false,
      reason: 'whatsapp_not_connected',
      message: 'Önce WhatsApp bağlantısını tamamlayın.',
    });
  }

  const logs: string[] = [];

  // Clean up orphan NOT_QUEUED rows with no scheduledSubmitAt — they would
  // never submit. Mark them as POOL_EXHAUSTED so they don't clog status.
  const orphanCleanup = await prisma.salonMessageTemplate.updateMany({
    where: {
      salonId,
      submissionState: 'NOT_QUEUED',
      scheduledSubmitAt: null,
    },
    data: { submissionState: 'POOL_EXHAUSTED', rejectionReason: 'orphan_no_schedule' },
  });
  if (orphanCleanup.count > 0) {
    logs.push(`${orphanCleanup.count} kayıtsız satır temizlendi (zamanlama yoktu).`);
  }

  try {
    const tone = salon.communicationTone || 'BALANCED';
    const result = await enqueueSalonTemplates({ salonId, tone });
    logs.push(`Dalga kuyruğu açıldı: ${result.enqueued} yeni satır eklendi (tone=${tone}).`);
    return res.status(200).json({
      ok: true,
      enqueued: result.enqueued,
      orphansCleared: orphanCleanup.count,
      logs,
    });
  } catch (err: any) {
    logs.push(`Hata: ${err?.message || err}`);
    return res.status(500).json({ ok: false, logs, error: err?.message || String(err) });
  }
});

export default router;
