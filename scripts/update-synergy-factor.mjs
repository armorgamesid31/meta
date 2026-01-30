#!/usr/bin/env node

/**
 * Update script to change synergy factor for 'Lazer Epilasyon' category
 * Changes synergyFactor from 0.4 to 0.3
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateSynergyFactor() {
  console.log('🔄 Updating synergy factor for Lazer Epilasyon category...');

  try {
    // Update the existing 'Lazer Epilasyon' category
    const updatedCategory = await prisma.serviceCategory.update({
      where: { name: 'Lazer Epilasyon' },
      data: {
        synergyFactor: 0.3,
        description: 'Lazer epilasyon hizmetleri - ardışık blok olarak planlanır, optimize zaman tasarrufu (0.3 faktörü)'
      }
    });

    console.log(`✅ Updated category: ${updatedCategory.name}`);
    console.log(`   - Old synergyFactor: 0.4`);
    console.log(`   - New synergyFactor: ${updatedCategory.synergyFactor}`);
    console.log(`   - Scheduling Rule: ${updatedCategory.schedulingRule}`);

    // Verify the update
    const verifyCategory = await prisma.serviceCategory.findUnique({
      where: { name: 'Lazer Epilasyon' }
    });

    if (verifyCategory?.synergyFactor === 0.3) {
      console.log('✅ Verification successful: synergyFactor is now 0.3');
    } else {
      console.log('❌ Verification failed: synergyFactor update may not have worked');
    }

    console.log('🎉 Synergy factor update completed successfully!');

  } catch (error) {
    console.error('❌ Error updating synergy factor:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the update function
updateSynergyFactor();