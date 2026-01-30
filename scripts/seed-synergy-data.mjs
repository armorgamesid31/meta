#!/usr/bin/env node

/**
 * Seed script for Smart Duration Calculation synergy data
 *
 * Sets up:
 * - ServiceCategory for "Lazer Epilasyon" with synergyFactor = 0.4
 * - Updates all laser services with isSynergyEnabled = true
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedSynergyData() {
  console.log('🌱 Seeding synergy data for Smart Duration Calculation...');

  try {
    // Create or update "Lazer Epilasyon" category with scheduling rules
    const laserCategory = await prisma.serviceCategory.upsert({
      where: { name: 'Lazer Epilasyon' },
      update: {
        schedulingRule: 'CONSECUTIVE_BLOCK',
        synergyFactor: 0.3,
        bufferMinutes: 0,
        description: 'Lazer epilasyon hizmetleri - ardışık blok olarak planlanır, zaman tasarrufu uygulanır'
      },
      create: {
        name: 'Lazer Epilasyon',
        schedulingRule: 'CONSECUTIVE_BLOCK',
        synergyFactor: 0.3,
        bufferMinutes: 0,
        description: 'Lazer epilasyon hizmetleri - ardışık blok olarak planlanır, zaman tasarrufu uygulanır'
      }
    });

    console.log(`✅ Created/Updated category: ${laserCategory.name} (synergyFactor: ${laserCategory.synergyFactor})`);

    // Find all salons and their laser services
    const salons = await prisma.salon.findMany({
      include: {
        services: true
      }
    });

    let totalUpdated = 0;

    for (const salon of salons) {
      // Find laser-related services (by name pattern)
      const laserServices = salon.services.filter(service =>
        service.name.toLowerCase().includes('lazer') ||
        service.name.toLowerCase().includes('epilasyon') ||
        service.name.toLowerCase().includes('laser')
      );

      if (laserServices.length > 0) {
        console.log(`🏪 Salon: ${salon.name} - Found ${laserServices.length} laser services`);

        // Update each laser service
        for (const service of laserServices) {
          await prisma.service.update({
            where: { id: service.id },
            data: {
              isSynergyEnabled: true,
              categoryId: laserCategory.id
            }
          });
          totalUpdated++;
        }
      }
    }

    console.log(`✅ Updated ${totalUpdated} laser services with synergy settings`);
    console.log('🎉 Synergy data seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding synergy data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed function
seedSynergyData();