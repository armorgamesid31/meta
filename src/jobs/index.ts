// Startup-time scheduler for low-frequency background maintenance jobs.
//
// We deliberately use a single setInterval per job (instead of pulling in
// node-cron) because there is at most one Node process per environment and
// the operations are idempotent. Each job is wrapped in try/catch so a
// transient DB error doesn't kill the timer.
//
// Existing scheduler conventions in this repo: notifications.startNotificationJobs
// and importWizard.startImportRetentionJob both follow the same setInterval
// pattern and are invoked from server.ts on listen(). startBackgroundJobs()
// below should be invoked from the same spot.

import { cleanupActivationCodes } from './cleanupActivationCodes.js';
import { processStatusTransitions } from '../services/onboarding/lifecycle.js';
import { processLifecycleReminders } from '../services/lifecycleReminders.js';

const HOURLY_MS = 60 * 60 * 1000;
// Lifecycle transitions only need to run daily, but we run every 6h
// because (a) Stripe webhooks can leave a salon stuck in BONUS_PERIOD
// briefly, and (b) the calculation is cheap (single indexed scan).
const SIX_HOURS_MS = 6 * HOURLY_MS;

let started = false;

export function startBackgroundJobs(): void {
  if (started) {
    return;
  }
  started = true;

  // Hourly: clear plaintext activation codes older than 24h.
  const tickActivationCleanup = async () => {
    try {
      const { cleared } = await cleanupActivationCodes();
      if (cleared > 0) {
        console.log(`[jobs/cleanupActivationCodes] cleared=${cleared}`);
      }
    } catch (error) {
      console.error('[jobs/cleanupActivationCodes] failed', error);
    }
  };

  // 6-hourly: advance setup/bonus/grace periods. Idempotent — running
  // again before the next deadline passes is a no-op. See
  // services/onboarding/lifecycle.ts:processStatusTransitions for the
  // transition table.
  const tickLifecycle = async () => {
    try {
      const result = await processStatusTransitions();
      if (result.toBonus + result.toGrace + result.toPaymentRequired > 0) {
        console.log('[jobs/setupCenterTransitions]', result);
      }
    } catch (error) {
      console.error('[jobs/setupCenterTransitions] failed', error);
    }
  };

  // 6-hourly: drip milestone-based reminder emails to salons in
  // SETUP/GRACE/PAYMENT_REQUIRED so they don't quietly miss the
  // 14-day setup bonus or hit a lockout without warning. Dedupes
  // via salon.lifecycleReminderState so re-ticks don't double-send.
  const tickLifecycleReminders = async () => {
    try {
      const result = await processLifecycleReminders();
      if (result.sent + result.failed > 0) {
        console.log('[jobs/lifecycleReminders]', result);
      }
    } catch (error) {
      console.error('[jobs/lifecycleReminders] failed', error);
    }
  };

  // Run once at startup so a long process restart catches up promptly,
  // then settle into the regular cadence.
  void tickActivationCleanup();
  void tickLifecycle();
  void tickLifecycleReminders();
  setInterval(tickActivationCleanup, HOURLY_MS).unref();
  setInterval(tickLifecycle, SIX_HOURS_MS).unref();
  setInterval(tickLifecycleReminders, SIX_HOURS_MS).unref();
}
