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
  if (rows.length === 0) return 'preparing';
  const states = rows.map(r => r.submissionState);

  // If any row is ACTIVE_VALID → hazır.
  if (states.includes('ACTIVE_VALID')) return 'active';

  // Legacy fallback: salons connected before the wave-based queue may have
  // rows with submissionState=NOT_QUEUED but metaStatus=APPROVED from the
  // old sync path. Treat those as active so we don't show "Meta onayı
  // bekliyor" for templates that Meta has actually approved.
  if (rows.some(r => r.metaStatus === 'APPROVED')) return 'active';

  // No active rows. Check if everything is exhausted.
  const allExhausted = rows.every(r =>
    r.submissionState === 'POOL_EXHAUSTED' ||
    r.submissionState === 'REJECTED' ||
    r.submissionState === 'CATEGORY_BUMPED'
  );
  if (allExhausted) return 'unavailable';

  // If we have at least one REJECTED/CATEGORY_BUMPED with no ACTIVE_VALID, it's a transient issue.
  if (states.some(s => s === 'REJECTED' || s === 'CATEGORY_BUMPED')) {
    return 'transient_issue';
  }

  return 'preparing';
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

  // Fetch active-tone rows AND legacy (pre-migration) rows where templateName
  // matches a known logical key. Legacy rows have tone=null/templateKey=null
  // but their metaStatus may already be APPROVED from the old sync path.
  const knownLogicalKeys = OPERATIONAL_TEMPLATES.map(t => t.logicalKey);
  const allRows = await prisma.salonMessageTemplate.findMany({
    where: {
      salonId,
      OR: [
        { tone: activeTone, templateKey: { not: null } },
        // Legacy / non-tone-varied rows where templateName is itself a logical key.
        { templateName: { in: knownLogicalKeys } },
      ],
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
  const active = templates.filter(t => t.status === 'active').length;
  const pending = templates.filter(t => t.status === 'preparing' || t.status === 'transient_issue').length;
  const unavailable = templates.filter(t => t.status === 'unavailable').length;

  return res.status(200).json({
    whatsappConnected: true,
    activeTone,
    total,
    active,
    pending,
    unavailable,
    templates,
  });
});

export default router;
