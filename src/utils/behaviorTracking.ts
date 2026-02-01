import { prisma } from '../prisma.js';

export enum BehaviorType {
  LAST_MINUTE_CANCELLATION = 'LAST_MINUTE_CANCELLATION',
  NO_SHOW = 'NO_SHOW',
  FREQUENT_CANCELLATION = 'FREQUENT_CANCELLATION',
  BOOKING_FREQUENCY = 'BOOKING_FREQUENCY'
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

/**
 * Logs a customer behavior event
 */
export async function logCustomerBehavior({
  customerId,
  salonId,
  appointmentId,
  behaviorType,
  severityScore,
  metadata
}: {
  customerId: number;
  salonId: number;
  appointmentId?: number;
  behaviorType: BehaviorType;
  severityScore: number;
  metadata?: any;
}) {
  try {
    // Check if risk tracking is enabled for this salon
    const config = await getSalonRiskConfig(salonId);
    if (!config?.isEnabled) {
      return; // Silently skip if risk tracking is disabled
    }

    // Log the behavior
    await prisma.customerBehaviorLog.create({
      data: {
        customerId,
        salonId,
        appointmentId,
        action: behaviorType,
        behaviorType,
        severityScore,
        occurredAt: new Date(),
        metadata
      }
    });

    // Update risk profile asynchronously (don't block the main flow)
    updateCustomerRiskProfile(customerId, salonId).catch(err => {
      console.error('Failed to update risk profile:', err);
    });

  } catch (error) {
    console.error('Error logging customer behavior:', error);
    // Don't throw - we don't want behavior logging to break the main flow
  }
}

/**
 * Calculates severity score for last-minute cancellations based on hours until appointment
 */
export function calculateCancellationSeverity(hoursUntilAppointment: number): number {
  if (hoursUntilAppointment < 1) return 10; // Last hour - very severe
  if (hoursUntilAppointment < 2) return 9;  // Within 2 hours
  if (hoursUntilAppointment < 4) return 8;  // Within 4 hours
  if (hoursUntilAppointment < 8) return 6;  // Within 8 hours
  if (hoursUntilAppointment < 12) return 4; // Within 12 hours
  if (hoursUntilAppointment < 24) return 2; // Within 24 hours
  return 1; // Shouldn't happen for last-minute cancellations
}

/**
 * Updates a customer's risk profile based on recent behavior
 */
export async function updateCustomerRiskProfile(customerId: number, salonId: number) {
  try {
    // Get salon risk configuration
    const config = await getSalonRiskConfig(salonId);
    if (!config?.isEnabled) {
      return; // Skip if risk tracking is disabled
    }

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Get behavior logs from last 3 months
    const recentBehaviors = await prisma.customerBehaviorLog.findMany({
      where: {
        customerId,
        salonId,
        occurredAt: { gte: threeMonthsAgo }
      }
    });

    // Count different behavior types
    const behaviorCounts = {
      lastMinuteCancellations: recentBehaviors.filter((b: any) => b.behaviorType === BehaviorType.LAST_MINUTE_CANCELLATION).length,
      noShows: recentBehaviors.filter((b: any) => b.behaviorType === BehaviorType.NO_SHOW).length,
      frequentCancellations: recentBehaviors.filter((b: any) => b.behaviorType === BehaviorType.FREQUENT_CANCELLATION).length,
      bookingFrequency: recentBehaviors.filter((b: any) => b.behaviorType === BehaviorType.BOOKING_FREQUENCY).length
    };

    // Calculate risk score using salon configuration
    const riskScore = calculateRiskScore(recentBehaviors, config);
    const riskLevel = determineRiskLevel(riskScore, config);

    // Get total bookings for this customer in the salon
    const totalBookings = await prisma.appointment.count({
      where: {
        customerId,
        salonId,
        createdAt: { gte: threeMonthsAgo }
      }
    });

    // Update or create risk profile
    await prisma.customerRiskProfile.upsert({
      where: {
        customerId_salonId: { customerId, salonId }
      },
      update: {
        riskScore,
        riskLevel: riskLevel as any,
        lastMinuteCancellations: behaviorCounts.lastMinuteCancellations,
        noShows: behaviorCounts.noShows,
        totalBookings,
        lastCalculatedAt: new Date(),
        updatedAt: new Date()
      },
      create: {
        customerId,
        salonId,
        riskScore,
        riskLevel: riskLevel as any,
        lastMinuteCancellations: behaviorCounts.lastMinuteCancellations,
        noShows: behaviorCounts.noShows,
        totalBookings,
        lastCalculatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error updating customer risk profile:', error);
  }
}

/**
 * Calculates risk score from behavior logs using salon configuration
 */
function calculateRiskScore(behaviors: any[], config: any): number {
  const weights = {
    [BehaviorType.LAST_MINUTE_CANCELLATION]: config.lastMinuteCancellationWeight,
    [BehaviorType.NO_SHOW]: config.noShowWeight,
    [BehaviorType.FREQUENT_CANCELLATION]: config.frequentCancellationWeight,
    [BehaviorType.BOOKING_FREQUENCY]: config.bookingFrequencyWeight
  };

  const totalScore = behaviors.reduce((score, behavior) => {
    const weight = weights[behavior.behaviorType as BehaviorType] || 1;
    return score + (behavior.severityScore * weight);
  }, 0);

  // Normalize to 0-100 scale
  return Math.min(100, Math.max(0, totalScore));
}

/**
 * Determines risk level from score using salon configuration
 */
function determineRiskLevel(score: number, config: any): RiskLevel {
  if (score >= config.blockingThreshold) return RiskLevel.CRITICAL;
  if (score >= config.warningThreshold) return RiskLevel.HIGH;
  return RiskLevel.LOW; // LOW covers both LOW and MEDIUM in the simplified model
}

/**
 * Gets salon risk configuration
 */
export async function getSalonRiskConfig(salonId: number) {
  try {
    return await prisma.salonRiskConfig.findUnique({
      where: { salonId }
    });
  } catch (error) {
    console.error('Error getting salon risk config:', error);
    return null;
  }
}

/**
 * Gets customer risk profile
 */
export async function getCustomerRiskProfile(customerId: number, salonId: number) {
  try {
    return await prisma.customerRiskProfile.findUnique({
      where: {
        customerId_salonId: { customerId, salonId }
      }
    });
  } catch (error) {
    console.error('Error getting customer risk profile:', error);
    return null;
  }
}

/**
 * Gets the appropriate risk message for a given risk level
 */
export function getRiskMessage(riskLevel: RiskLevel, config: any): string | null {
  switch (riskLevel) {
    case RiskLevel.MEDIUM:
      // MEDIUM messages are optional - return null if not configured
      return config.mediumRiskMessage || null;

    case RiskLevel.HIGH:
      // HIGH messages take precedence over legacy warningMessage
      return config.highRiskMessage || config.warningMessage;

    case RiskLevel.CRITICAL:
      // CRITICAL messages take precedence over legacy blockMessage
      return config.criticalRiskMessage || config.blockMessage;

    default:
      return null;
  }
}

/**
 * Gets risk message for a customer based on their current risk profile
 */
export async function getCustomerRiskMessage(customerId: number, salonId: number): Promise<string | null> {
  try {
    // Get customer's risk profile
    const riskProfile = await getCustomerRiskProfile(customerId, salonId);
    if (!riskProfile) {
      return null; // No risk profile means no risk
    }

    // Get salon configuration
    const config = await getSalonRiskConfig(salonId);
    if (!config?.isEnabled) {
      return null; // Risk tracking disabled
    }

    // Get appropriate message for risk level
    return getRiskMessage(riskProfile.riskLevel as RiskLevel, config);
  } catch (error) {
    console.error('Error getting customer risk message:', error);
    return null; // Fail silently
  }
}

/**
 * Cleans up old behavior logs (older than 3 months + 1 week buffer)
 */
export async function cleanupOldBehaviorLogs() {
  try {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 3);
    cutoffDate.setDate(cutoffDate.getDate() - 7); // 3 months + 1 week buffer

    const result = await prisma.customerBehaviorLog.deleteMany({
      where: {
        occurredAt: { lt: cutoffDate }
      }
    });

    console.log(`Cleaned up ${result.count} old behavior logs`);
    return result.count;
  } catch (error) {
    console.error('Error cleaning up behavior logs:', error);
    return 0;
  }
}
