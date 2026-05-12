// Meta template status webhook handler.
//
// Meta sends `message_template_status_update` events to our /webhooks/meta
// endpoint when a submitted template's review state changes. This module
// parses those events and drives the SalonMessageTemplate state machine:
//
//   APPROVED + category matches expected → ACTIVE_VALID
//   APPROVED + category bumped           → CATEGORY_BUMPED + promote reserve
//   REJECTED                             → REJECTED + promote reserve
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

/**
 * Returns true if the body contains at least one message_template_status_update
 * change. Used by handleInbound to detect template-status payloads.
 */
export function isTemplateStatusPayload(body: any): boolean {
  if (!body || !Array.isArray(body.entry)) return false;
  return body.entry.some((entry: any) =>
    Array.isArray(entry?.changes) &&
    entry.changes.some((c: any) => c?.field === 'message_template_status_update')
  );
}

/**
 * Process all template status events in the given Meta webhook payload.
 */
export async function processTemplateStatusPayload(body: any): Promise<{ processed: number }> {
  if (!body?.entry) return { processed: 0 };

  let processed = 0;
  for (const entry of body.entry as any[]) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== 'message_template_status_update') continue;
      const val = change.value || {};
      const templateName: string | undefined = val.message_template_name;
      const event: string | undefined = val.event;
      const newCategory: string | undefined = val.new_category;
      const reason: string | undefined = val.reason;

      if (!templateName || !event) continue;

      await handleSingleStatusEvent({
        templateName,
        event: event as any,
        newCategory,
        reason,
      }).catch(err => console.error('[templateStatusWebhook] handler error:', err));

      processed++;
    }
  }
  return { processed };
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
