#!/usr/bin/env node

/**
 * Check existing salons in the database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSalons() {
  console.log('🔍 Checking existing salons...');

  try {
    const salons = await prisma.salon.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            services: true,
            staff: true
          }
        }
      }
    });

    console.log(`Found ${salons.length} salons:`);
    salons.forEach(salon => {
      console.log(`  ID: ${salon.id}, Name: ${salon.name}, Services: ${salon._count.services}, Staff: ${salon._count.staff}`);
    });

    if (salons.length === 0) {
      console.log('❌ No salons found. Creating a default salon...');

      const newSalon = await prisma.salon.create({
        data: {
          name: 'Demo Salon',
          slug: 'demo-salon'
        }
      });

      console.log(`✅ Created salon: ${newSalon.name} (ID: ${newSalon.id})`);
      return newSalon.id;
    }

    return salons[0].id; // Return first salon ID

  } catch (error) {
    console.error('❌ Error checking salons:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkSalons();