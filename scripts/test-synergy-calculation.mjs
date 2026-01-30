#!/usr/bin/env node

/**
 * Test script for Smart Duration Calculation
 *
 * Tests the synergy algorithm with various service combinations
 */

import { calculateSmartDuration, getSynergySavings } from '../src/utils/durationCalculator.js';

// Test data
const laserCategory = { synergyFactor: 0.4 };
const standardCategory = { synergyFactor: 1.0 };

const services = [
  // Laser services (synergy enabled)
  { id: 1, name: 'Lazer Epilasyon - Kol', duration: 30, price: 200, isSynergyEnabled: true, category: laserCategory },
  { id: 2, name: 'Lazer Epilasyon - Bacak', duration: 45, price: 300, isSynergyEnabled: true, category: laserCategory },
  { id: 3, name: 'Lazer Epilasyon - Sırt', duration: 40, price: 250, isSynergyEnabled: true, category: laserCategory },

  // Standard services (no synergy)
  { id: 4, name: 'Saç Kesimi', duration: 30, price: 100, isSynergyEnabled: false, category: standardCategory },
  { id: 5, name: 'Saç Boyama', duration: 60, price: 200, isSynergyEnabled: false, category: standardCategory },
];

console.log('🧪 Testing Smart Duration Calculation\n');

// Test 1: Single service
console.log('Test 1: Single laser service');
const singleService = [services[0]];
const singleDuration = calculateSmartDuration(singleService);
console.log(`Service: ${singleService[0].name} (${singleService[0].duration}min)`);
console.log(`Calculated duration: ${singleDuration}min\n`);

// Test 2: Multiple laser services (should show synergy effect)
console.log('Test 2: Multiple laser services (synergy effect)');
const multipleLasers = [services[0], services[1], services[2]];
const synergyDuration = calculateSmartDuration(multipleLasers);
const savings = getSynergySavings(multipleLasers);
console.log(`Services: ${multipleLasers.map(s => `${s.name}(${s.duration}min)`).join(', ')}`);
console.log(`Total original duration: ${savings.originalDuration}min`);
console.log(`Calculated duration: ${synergyDuration}min`);
console.log(`Time saved: ${savings.savingsMinutes}min (${savings.savingsPercentage}%)\n`);

// Test 3: Mixed services (laser + standard)
console.log('Test 3: Mixed services (laser + standard)');
const mixedServices = [services[0], services[1], services[3]];
const mixedDuration = calculateSmartDuration(mixedServices);
const mixedSavings = getSynergySavings(mixedServices);
console.log(`Services: ${mixedServices.map(s => `${s.name}(${s.duration}min)`).join(', ')}`);
console.log(`Total original duration: ${mixedSavings.originalDuration}min`);
console.log(`Calculated duration: ${mixedDuration}min`);
console.log(`Time saved: ${mixedSavings.savingsMinutes}min (${mixedSavings.savingsPercentage}%)\n`);

// Test 4: Only standard services (no synergy)
console.log('Test 4: Only standard services (no synergy)');
const standardServices = [services[3], services[4]];
const standardDuration = calculateSmartDuration(standardServices);
const standardSavings = getSynergySavings(standardServices);
console.log(`Services: ${standardServices.map(s => `${s.name}(${s.duration}min)`).join(', ')}`);
console.log(`Total original duration: ${standardSavings.originalDuration}min`);
console.log(`Calculated duration: ${standardDuration}min`);
console.log(`Time saved: ${standardSavings.savingsMinutes}min (${standardSavings.savingsPercentage}%)\n`);

console.log('✅ Smart Duration Calculation tests completed!');