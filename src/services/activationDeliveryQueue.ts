// Best-effort, in-process queue for activation-code delivery (email + WA).
//
// Why this exists:
//   Stripe webhook handlers have a hard 10s timeout. If we hit external
//   providers (SES, Chakra/WA) inline, a slow or failing provider can push
//   the webhook past 10s → Stripe marks it failed → retry storm + duplicate
//   provisioning attempts. Delivery is non-critical (the marketing success
//   page also shows the code via GET /api/checkout/activation), so we
//   move it off the webhook hot path here.
//
// NOTE: In-memory queue. Single-instance only. For horizontal scale,
// migrate to BullMQ/pg-boss with Redis/Postgres backend.
//
// Restart semantics:
//   Process exit drops the queue. That is acceptable for our current
//   single-instance deploy because the activation code is also reachable
//   via the marketing success page; the queue is a convenience channel.

import { sendActivationEmail } from './activationDelivery.js';
import { sendActivationWhatsapp } from './activationWhatsappDelivery.js';

interface EmailPayload {
  to: string;
  ownerName: string;
  salonName: string;
  code: string;
  expiresAt: Date;
}

interface WaPayload {
  toPhone: string;
  ownerName: string;
  salonName: string;
  code: string;
  expiresAt: Date;
}

interface DeliveryJob {
  email?: EmailPayload;
  wa?: WaPayload;
  attempt: number;
}

const MAX_ATTEMPTS = 3;
const queue: DeliveryJob[] = [];
let processing = false;

export function enqueueActivationDelivery(job: Omit<DeliveryJob, 'attempt'>): void {
  queue.push({ ...job, attempt: 0 });
  // Fire-and-forget; never await.
  void processQueue();
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      let emailOk = true;
      let waOk = true;
      try {
        if (job.email) {
          try {
            await sendActivationEmail(job.email);
          } catch (err) {
            emailOk = false;
            console.error('[activationDeliveryQueue] email failed', {
              attempt: job.attempt,
              err,
            });
          }
        }
        if (job.wa) {
          try {
            await sendActivationWhatsapp(job.wa);
          } catch (err) {
            waOk = false;
            console.error('[activationDeliveryQueue] whatsapp failed', {
              attempt: job.attempt,
              err,
            });
          }
        }
      } catch (err) {
        // Defensive: outer catch in case anything synchronous throws.
        emailOk = false;
        waOk = false;
        console.error('[activationDeliveryQueue] unexpected error', {
          attempt: job.attempt,
          err,
        });
      }

      const needsRetry = (job.email && !emailOk) || (job.wa && !waOk);
      if (needsRetry && job.attempt < MAX_ATTEMPTS - 1) {
        const nextAttempt = job.attempt + 1;
        const delayMs = Math.pow(2, job.attempt) * 5000; // 5s, 10s, 20s
        setTimeout(() => {
          // Only retry the channels that actually failed, to avoid
          // double-sending a successful email after a WA failure.
          queue.push({
            email: emailOk ? undefined : job.email,
            wa: waOk ? undefined : job.wa,
            attempt: nextAttempt,
          });
          void processQueue();
        }, delayMs).unref?.();
      }
    }
  } finally {
    processing = false;
  }
}

/**
 * Test/diagnostic helper. Not used by production code paths.
 */
export function _queueDepthForTest(): number {
  return queue.length;
}
