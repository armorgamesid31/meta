import { prisma } from '../prisma.js';
import { logCustomerBehavior, BehaviorType } from './behaviorTracking.js';

/**
 * Detects and marks no-show appointments
 * Should be run periodically (e.g., every 15 minutes)
 */
export async function detectNoShows() {
  try {
    const now = new Date();

    // Find appointments that:
    // 1. Are still marked as BOOKED
    // 2. Start time has passed
    // 3. Have a customerId (for behavior tracking)
    const pastAppointments = await prisma.appointment.findMany({
      where: {
        status: 'BOOKED',
        startTime: { lt: now },
        customerId: { not: null } // Only track customers we know
      },
      include: {
        customer: true,
        service: true,
        staff: true
      }
    });

    console.log(`Found ${pastAppointments.length} potential no-show appointments`);

    for (const appointment of pastAppointments) {
      try {
        // Log no-show behavior
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
            expectedDuration: appointment.service?.duration
          }
        });

        // Mark appointment as NO_SHOW
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            status: 'NO_SHOW',
            updatedAt: new Date()
          }
        });

        console.log(`Marked appointment ${appointment.id} as NO_SHOW for customer ${appointment.customerId}`);

      } catch (error) {
        console.error(`Error processing no-show for appointment ${appointment.id}:`, error);
      }
    }

    return pastAppointments.length;

  } catch (error) {
    console.error('Error in no-show detection:', error);
    return 0;
  }
}

/**
 * Manual trigger for no-show detection (for testing/admin purposes)
 */
export async function runNoShowDetection() {
  console.log('Running manual no-show detection...');
  const count = await detectNoShows();
  console.log(`Processed ${count} no-show appointments`);
  return count;
}