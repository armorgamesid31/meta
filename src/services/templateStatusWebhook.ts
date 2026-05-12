// Meta template status webhook handler.
//
// Meta sends three relevant event fields to our /webhooks/meta endpoint:
//   1. message_template_status_update — review state transitions
//        APPROVED + category matches expected → ACTIVE_VALID
//        APPROVED + category bumped           → CATEGORY_BUMPED + promote reserve
//        REJECTED                             → REJECTED + promote reserve
//   2. template_category_update — Meta proactively reclassified an
//      already-submitted template (e.g. UTILITY → MARKETING). Treated as
//      a category bump: state → CATEGORY_BUMPED + promote reserve.
//   3. message_template_quality_update — quality rating change. We just
//      record it on the row for audit; no state machine action.
//
// When the pool of reserves is also exhausted (all 10 slots tried, < 3
// ACTIVE_VALID), remaining non-active rows are marked POOL_EXHAUSTED for
// admin attention.

import { prisma } from '../prisma.js';
import {
  promoteReserveVariation,
  markPoolExhaustedIfNeeded,
} from './salonTemplateSubmitter.js';

interface TemplateStatusEvent {
  field: 'message_template_status_update';
  value: {
    event: 'APPROVED' | 'REJECTED' | 'PENDING' | 'IN_APPEAL' | 'FLAGGED' | 'PAUSED' | 'DISABLED';
    message_template_id?: string | number;
    message_template_name?: string;
    message_template_language?: string;
    reason?: string;
    new_category?: string; // Meta sends this on category bumps
    previous_category?: string;
  };
}

const TEMPLATE_EVENT_FIELDS = new Set([
  'message_template_status_update',
  'template_category_update',
  'message_template_quality_update',
]);

/**
 * Returns true if the body contains any template lifecycle event we handle.
 */
export function isTemplateStatusPayload(body: any): boolean {
  if (!body || !Array.isArray(body.entry)) return false;
  return body.entry.some((entry: any) =>
    Array.isArray(entry?.changes) &&
    entry.changes.some((c: any) => c?.field && TEMPLATE_EVENT_FIELDS.has(c.field))
  );
}

/**
 * Process all template lifecycle events in the given Meta webhook payload.
 */
export async function processTemplateStatusPayload(body: any): Promise<{ processed: number }> {
  if (!body?.entry) return { processed: 0 };

  let processed = 0;
  for (const entry of body.entry as any[]) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      const field = change?.field;
      if (!field || !TEMPLATE_EVENT_FIELDS.has(field)) continue;
      const val = change.value || {};
      const templateName: string | undefined = val.message_template_name;
      if (!templateName) continue;

      try {
        if (field === 'message_template_status_update') {
          const event: string | undefined = val.event;
          if (!event) continue;
          await handleSingleStatusEvent({
            templateName,
            event: event as any,
            newCategory: val.new_category,
            reason: val.reason,
          });
        } else if (field === 'template_category_update') {
          // Meta proactively reclassified the template. previous_category and
          // new_category are present in the payload.
          await handleCategoryUpdate({
            templateName,
            previousCategory: val.previous_category,
            newCategory: val.new_category,
          });
        } else if (field === 'message_template_quality_update') {
          // Audit-only: record the quality rating on the row.
          await prisma.salonMessageTemplate.updateMany({
            where: { templateName },
            data: { lastSyncAt: new Date() },
          });
        }
        processed++;
      } catch (err) {
        console.error('[templateStatusWebhook] handler error:', err);
      }
    }
  }
  return { processed };
}

/**
 * Handle a template_category_update event: Meta moved this template from
 * one category to another (typically UTILITY → MARKETING because of
 * promotional language detected in the body). Treated as a category bump:
 *   - state → CATEGORY_BUMPED (picker excludes from active pool)
 *   - promote a reserve slot so a fresh body variation gets submitted
 */
async function handleCategoryUpdate(opts: {
  templateName: string;
  previousCategory?: string;
  newCategory?: string;
}): Promise<void> {
  const { templateName, newCategory, previousCategory } = opts;
  const rows = await prisma.salonMessageTemplate.findMany({ where: { templateName } });
  if (rows.length === 0) {
    console.warn('[templateStatusWebhook] category_update: no rows for', templateName);
    return;
  }

  for (const row of rows) {
    const expectedCategory = row.expectedCategory || 'UTILITY';
    const actualCategory = newCategory || expectedCategory;

    // Guard: don't touch user_marked_outdated rows.
    if (
      row.submissionState === 'REJECTED' &&
      typeof row.rejectionReason === 'string' &&
      row.rejectionReason.startsWith('user_marked_outdated')
    ) {
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: { actualCategory, metaCategory: actualCategory, lastSyncAt: new Date() },
      });
      continue;
    }

    const categoryMatches = !newCategory || newCategory === expectedCategory;
    await prisma.salonMessageTemplate.update({
      where: { id: row.id },
      data: {
        submissionState: categoryMatches ? row.submissionState : 'CATEGORY_BUMPED',
        actualCategory,
        metaCategory: actualCategory,
        lastSyncAt: new Date(),
        rejectionReason: categoryMatches
          ? row.rejectionReason
          : `category_bumped_from_${previousCategory || 'unknown'}_to_${actualCategory}`,
      },
    });

    if (!categoryMatches && row.templateKey && row.tone) {
      const promoted = await promoteReserveVariation({
        salonId: row.salonId,
        logicalKey: row.templateKey,
        tone: row.tone,
      });
      if (!promoted.created) {
        await markPoolExhaustedIfNeeded({
          salonId: row.salonId,
          logicalKey: row.templateKey,
          tone: row.tone,
        });
      }
    }
  }
}

async function handleSingleStatusEvent(opts: {
  templateName: string;
  event: 'APPROVED' | 'REJECTED' | 'PENDING' | 'IN_APPEAL' | 'FLAGGED' | 'PAUSED' | 'DISABLED';
  newCategory?: string;
  reason?: string;
}): Promise<void> {
  const { templateName, event, newCategory, reason } = opts;

  // templateName is unique within a WABA. Across all salons it should still
  // resolve uniquely because the name pattern is kedy_<key>_<tone><slot>
  // (no salon prefix). But Meta sends the same name for multiple salons;
  // we have to look up by templateName + whatever scoping we have.
  //
  // Each salon has its OWN copy with the same templateName. So findMany.
  const rows = await prisma.salonMessageTemplate.findMany({
    where: { templateName },
  });

  if (rows.length === 0) {
    console.warn('[templateStatusWebhook] no rows for templateName', templateName);
    return;
  }

  for (const row of rows) {
    const expectedCategory = row.expectedCategory || 'UTILITY';
    const actualCategory = newCategory || expectedCategory;

    // Guard: rows that an admin explicitly marked as outdated must not get
    // promoted back to ACTIVE_VALID just because Meta later approved them.
    // The body they were submitted with is known-stale; picking them at
    // send time would deliver the wrong content. Record the Meta status
    // for audit but keep submissionState=REJECTED.
    const isUserMarkedOutdated =
      row.submissionState === 'REJECTED' &&
      typeof row.rejectionReason === 'string' &&
      row.rejectionReason.startsWith('user_marked_outdated');

    if (isUserMarkedOutdated) {
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: { metaStatus: event, metaCategory: actualCategory, lastSyncAt: new Date() },
      });
      continue;
    }

    if (event === 'APPROVED') {
      const categoryMatches = !newCategory || newCategory === expectedCategory;

      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: {
          submissionState: categoryMatches ? 'ACTIVE_VALID' : 'CATEGORY_BUMPED',
          approvedAt: new Date(),
          actualCategory,
          metaStatus: 'APPROVED',
          metaCategory: actualCategory,
        },
      });

      if (!categoryMatches && row.templateKey && row.tone) {
        // Promote a reserve to compensate for the category bump.
        const promoted = await promoteReserveVariation({
          salonId: row.salonId,
          logicalKey: row.templateKey,
          tone: row.tone,
        });
        if (!promoted.created) {
          await markPoolExhaustedIfNeeded({
            salonId: row.salonId,
            logicalKey: row.templateKey,
            tone: row.tone,
          });
        }
      }
    } else if (event === 'REJECTED' || event === 'FLAGGED' || event === 'PAUSED' || event === 'DISABLED') {
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: {
          submissionState: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: (reason || event).slice(0, 500),
          metaStatus: event,
        },
      });

      if (row.templateKey && row.tone) {
        const promoted = await promoteReserveVariation({
          salonId: row.salonId,
          logicalKey: row.templateKey,
          tone: row.tone,
        });
        if (!promoted.created) {
          await markPoolExhaustedIfNeeded({
            salonId: row.salonId,
            logicalKey: row.templateKey,
            tone: row.tone,
          });
        }
      }
    } else {
      // PENDING / IN_APPEAL — just record status, no state change yet.
      await prisma.salonMessageTemplate.update({
        where: { id: row.id },
        data: { metaStatus: event, lastSyncAt: new Date() },
      });
    }
  }
}
