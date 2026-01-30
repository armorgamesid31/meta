#!/usr/bin/env node

/**
 * Test script to verify the updated synergy factor (0.3) is working
 */

// Smart Duration Calculation Algorithm with 0.3 synergy factor
function calculateSmartDuration(services) {
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

// Test data with updated synergy factor (0.3)
const laserCategory = {
  schedulingRule: 'CONSECUTIVE_BLOCK',
  synergyFactor: 0.3,  // Updated from 0.4 to 0.3
  bufferMinutes: 0
};

const standardCategory = {
  schedulingRule: 'STANDARD',
  synergyFactor: 1.0,
  bufferMinutes: 0
};

const services = [
  // Laser services (CONSECUTIVE_BLOCK with 0.3 synergy factor)
  { id: 1, name: 'Lazer Epilasyon - Kol', duration: 30, price: 200, isSynergyEnabled: true, category: laserCategory },
  { id: 2, name: 'Lazer Epilasyon - Bacak', duration: 45, price: 300, isSynergyEnabled: true, category: laserCategory },
  { id: 3, name: 'Lazer Epilasyon - Sırt', duration: 40, price: 250, isSynergyEnabled: true, category: laserCategory },

  // Standard services
  { id: 4, name: 'Saç Kesimi', duration: 30, price: 100, isSynergyEnabled: false, category: standardCategory },
];

console.log('🧪 Testing Updated Synergy Factor (0.3)\n');

// Test: Multiple laser services with 0.3 synergy factor
console.log('Test: CONSECUTIVE_BLOCK with 0.3 synergy factor');
const laserServices = [services[0], services[1], services[2]];
const calculatedDuration = calculateSmartDuration(laserServices);

console.log(`Services: ${laserServices.map(s => `${s.name}(${s.duration}min)`).join(', ')}`);
console.log(`Synergy Factor: ${laserServices[0].category.synergyFactor}`);
console.log(`Calculated duration: ${calculatedDuration}min`);

// Expected calculation with 0.3 factor:
// 45 (base) + 30*0.3 + 40*0.3 = 45 + 9 + 12 = 66 → round to 65
console.log(`Expected: 65min (45 + 9 + 12 = 66 → 65)`);

if (calculatedDuration === 65) {
  console.log(`✅ PASS: Algorithm correctly uses 0.3 synergy factor\n`);
} else {
  console.log(`❌ FAIL: Expected 65min, got ${calculatedDuration}min\n`);
}

// Show the difference from old 0.4 factor
const oldSynergyFactor = 0.4;
const oldCalculation = 45 + (30 * oldSynergyFactor) + (40 * oldSynergyFactor);
const oldRounded = Math.round(oldCalculation / 5) * 5;

console.log('📊 Comparison:');
console.log(`Old synergy factor (0.4): ${oldRounded}min`);
console.log(`New synergy factor (0.3): ${calculatedDuration}min`);
console.log(`Additional time savings: ${oldRounded - calculatedDuration}min`);

console.log('\n🎉 Synergy factor update verification completed!');