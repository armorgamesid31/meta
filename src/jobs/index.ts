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

const HOURLY_MS = 60 * 60 * 1000;

let started = false;

export function startBackgroundJobs(): void {
  if (started) {
    return;
  }
  started = true;

  // Hourly: clear plaintext activation codes older than 24h.
  const tick = async () => {
    try {
      const { cleared } = await cleanupActivationCodes();
      if (cleared > 0) {
        console.log(`[jobs/cleanupActivationCodes] cleared=${cleared}`);
      }
    } catch (error) {
      console.error('[jobs/cleanupActivationCodes] failed', error);
    }
  };

  // Run once at startup so a long process restart catches up promptly,
  // then settle into the hourly cadence.
  void tick();
  setInterval(tick, HOURLY_MS).unref();
}
