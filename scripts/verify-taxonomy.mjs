#!/usr/bin/env node

/**
 * Verify the Universal Category Taxonomy implementation
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyTaxonomy() {
  console.log('🔍 Verifying Universal Category Taxonomy...\n');

  try {
    // Check categories
    const categories = await prisma.serviceCategory.findMany({
      include: {
        _count: {
          select: { services: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    console.log(`📂 Categories (${categories.length}):`);
    categories.forEach(cat => {
      console.log(`  • ${cat.name}: ${cat._count.services} services`);
      console.log(`    Rule: ${cat.schedulingRule}, Synergy: ${cat.synergyFactor}, Buffer: ${cat.bufferMinutes}min`);
    });

    console.log('\n' + '='.repeat(60));

    // Check services with gender distribution
    const services = await prisma.service.findMany({
      include: {
        category: {
          select: { name: true, schedulingRule: true }
        }
      },
      orderBy: [
        { category: { name: 'asc' } },
        { name: 'asc' }
      ]
    });

    console.log(`\n💅 Services (${services.length}):`);

    const genderStats = { FEMALE: 0, MALE: 0, UNISEX: 0 };
    const categoryStats = {};

    services.forEach(service => {
      genderStats[service.targetGender]++;

      if (!categoryStats[service.category.name]) {
        categoryStats[service.category.name] = { count: 0, rule: service.category.schedulingRule };
      }
      categoryStats[service.category.name].count++;

      console.log(`  ${service.category.name}: ${service.name}`);
      console.log(`    Duration: ${service.duration}min, Price: ₺${service.price}, Gender: ${service.targetGender}, Synergy: ${service.isSynergyEnabled}`);
    });

    console.log('\n📊 Statistics:');
    console.log(`  Gender Distribution:`);
    console.log(`    👩 Female: ${genderStats.FEMALE} services`);
    console.log(`    👨 Male: ${genderStats.MALE} services`);
    console.log(`    🧑 Unisex: ${genderStats.UNISEX} services`);

    console.log(`\n  Category Distribution:`);
    Object.entries(categoryStats).forEach(([name, stats]) => {
      console.log(`    ${name}: ${stats.count} services (${stats.rule})`);
    });

    // Verify scheduling rules
    console.log('\n🎯 Scheduling Rules Verification:');
    const ruleStats = {};
    categories.forEach(cat => {
      if (!ruleStats[cat.schedulingRule]) {
        ruleStats[cat.schedulingRule] = 0;
      }
      ruleStats[cat.schedulingRule]++;
    });

    Object.entries(ruleStats).forEach(([rule, count]) => {
      console.log(`  ${rule}: ${count} categories`);
    });

    console.log('\n✅ Universal Category Taxonomy verification completed!');

  } catch (error) {
    console.error('❌ Error verifying taxonomy:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyTaxonomy();