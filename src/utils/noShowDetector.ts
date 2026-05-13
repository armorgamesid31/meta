import { prisma } from '../prisma.js';
import { logCustomerBehavior, BehaviorType } from './behaviorTracking.js';

/**
 * Detects and marks no-show appointments.
 *
 * Should be run periodically (e.g., every 15 minutes).
 *
 * Tenant-scoped: instead of one giant findMany across every salon (which
 * triggers DB lock contention and can drain the Prisma connection pool
 * on large datasets), we first list active salon IDs, then process each
 * salon's overdue appointments in a small concurrent batch. This bounds
 * per-query result size and keeps p99 latency predictable as the platform
 * grows.
 */
const CONCURRENCY = 4;

async function processSalonNoShows(salonId: number, now: Date): Promise<number> {
  // Per-salon scan. Index used: idx_appointment_salon_status_start
  const pastAppointments = await prisma.appointment.findMany({
    where: {
      salonId,
      status: 'BOOKED',
      startTime: { lt: now },
      customerId: { not: null }, // Only track customers we know
    },
    include: {
      customer: true,
      service: true,
      staff: true,
    },
  });

  if (pastAppointments.length === 0) return 0;

  // Behavior logging is per-appointment (preserves existing semantics); the
  // status flip is batched into a single updateMany at the end to reduce
  // round-trips.
  for (const appointment of pastAppointments) {
    try {
      await logCustomerBehavior({
        customerId: appointment.customerId!,
        salonId: appointment.salonId,
        appointmentId: appointment.id,
        behaviorType: BehaviorType.NO_SHOW,
        severityScore: 8, // High severity for no-shows
        metadata: {
          appointmentDateTime: appointment.startTime,
          serviceName: appointment.service?.name,
          staffName: appointment.staff?.name,
          expectedDuration: appointment.service?.duration,
        },
      });
    } catch (error) {
      console.error(
        `[noShowDetector] behavior log failed for appointment ${appointment.id}:`,
        error,
      );
    }
  }

  const idsToFlip = pastAppointments.map((a) => a.id);
  try {
    await prisma.appointment.updateMany({
      where: { id: { in: idsToFlip } },
      data: {
        status: 'NO_SHOW',
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error(
      `[noShowDetector] batch updateMany failed for salon ${salonId}:`,
      error,
    );
  }

  return pastAppointments.length;
}

export async function detectNoShows(): Promise<number> {
  const startedAt = Date.now();
  try {
    const now = new Date();

    const activeSalons = await prisma.salon.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    const salonIds = activeSalons.map((s) => s.id);

    let totalProcessed = 0;

    for (let i = 0; i < salonIds.length; i += CONCURRENCY) {
      const batch = salonIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((salonId) => processSalonNoShows(salonId, now)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalProcessed += r.value;
        } else {
          console.error('[noShowDetector] salon batch failed:', r.reason);
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[noShowDetector] complete salons=${salonIds.length} flipped=${totalProcessed} durationMs=${durationMs}`,
    );
    return totalProcessed;
  } catch (error) {
    console.error('[noShowDetector] fatal error:', error);
    return 0;
  }
}

/**
 * Manual trigger for no-show detection (for testing/admin purposes)
 */
export async function runNoShowDetection(): Promise<number> {
  console.log('[noShowDetector] manual trigger');
  const count = await detectNoShows();
  console.log(`[noShowDetector] manual run processed ${count} appointments`);
  return count;
}
