/**
 * Smart Duration Calculator for Salon Services
 *
 * Handles service bundles with different scheduling rules:
 * - STANDARD: Normal scheduling, services can be booked separately
 * - CONSECUTIVE_BLOCK: Services must be booked as continuous block with synergy
 * - PARALLEL: Services can be performed in parallel (future use)
 *
 * Algorithm for CONSECUTIVE_BLOCK:
 * 1. Filter synergy-enabled services from same category
 * 2. Sort by duration (longest first)
 * 3. Take longest as base duration (100%)
 * 4. Apply synergy factor to remaining services
 * 5. Add buffer time between services
 * 6. Add standard services fully
 * 7. Round to nearest 5 minutes
 */

export interface ServiceWithCategory {
  id: number;
  name: string;
  duration: number;
  price: number;
  isSynergyEnabled: boolean;
  category?: {
    schedulingRule: 'STANDARD' | 'CONSECUTIVE_BLOCK' | 'PARALLEL';
    synergyFactor: number;
    bufferMinutes: number;
  };
}

/**
 * Calculate smart duration for a bundle of services
 * @param services Array of services to calculate duration for
 * @returns Total duration in minutes, rounded to nearest 5 minutes
 */
export function calculateSmartDuration(services: ServiceWithCategory[]): number {
  if (!services || services.length === 0) {
    return 0;
  }

  if (services.length === 1) {
    return services[0].duration;
  }

  // Separate synergy-enabled and standard services
  const synergyServices = services.filter(service => service.isSynergyEnabled);
  const standardServices = services.filter(service => !service.isSynergyEnabled);

  let totalDuration = 0;

  if (synergyServices.length > 0) {
    // Sort synergy services by duration (longest first)
    const sortedSynergyServices = [...synergyServices].sort((a, b) => b.duration - a.duration);

    // Take the longest service as base (100% time)
    const baseService = sortedSynergyServices[0];
    totalDuration += baseService.duration;

    // Apply synergy factor to remaining services
    for (let i = 1; i < sortedSynergyServices.length; i++) {
      const service = sortedSynergyServices[i];
      const synergyFactor = service.category?.synergyFactor ?? 1.0;
      const adjustedDuration = service.duration * synergyFactor;
      totalDuration += adjustedDuration;
    }
  }

  // Add standard services fully (100% time)
  for (const service of standardServices) {
    totalDuration += service.duration;
  }

  // Round to nearest 5 minutes
  return Math.round(totalDuration / 5) * 5;
}

/**
 * Check if a service bundle qualifies for synergy calculation
 * @param services Array of services
 * @returns True if synergy calculation should be applied
 */
export function shouldUseSynergy(services: ServiceWithCategory[]): boolean {
  const synergyEnabledCount = services.filter(service => service.isSynergyEnabled).length;
  return synergyEnabledCount > 1; // Need at least 2 synergy services for effect
}

/**
 * Get synergy savings information for display
 * @param services Array of services
 * @returns Object with original duration, optimized duration, and savings
 */
export function getSynergySavings(services: ServiceWithCategory[]): {
  originalDuration: number;
  optimizedDuration: number;
  savingsMinutes: number;
  savingsPercentage: number;
} {
  const originalDuration = services.reduce((sum, service) => sum + service.duration, 0);
  const optimizedDuration = calculateSmartDuration(services);
  const savingsMinutes = originalDuration - optimizedDuration;
  const savingsPercentage = originalDuration > 0 ? (savingsMinutes / originalDuration) * 100 : 0;

  return {
    originalDuration,
    optimizedDuration,
    savingsMinutes,
    savingsPercentage: Math.round(savingsPercentage * 10) / 10 // Round to 1 decimal
  };
}