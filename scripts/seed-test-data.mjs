import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTestData() {
  try {
    console.log('Creating test data for salon 484...');

    // Create staff
    const staff1 = await prisma.staff.create({
      data: {
        name: 'Ahmet Yılmaz',
        salonId: 484
      }
    });

    const staff2 = await prisma.staff.create({
      data: {
        name: 'Ayşe Kaya',
        salonId: 484
      }
    });

    console.log('Created staff:', staff1.name, staff2.name);

    // Create services
    const service1 = await prisma.service.create({
      data: {
        name: 'Saç Kesimi',
        price: 150,
        duration: 60,
        salonId: 484,
        staff: {
          connect: [{ id: staff1.id }, { id: staff2.id }]
        }
      }
    });

    const service2 = await prisma.service.create({
      data: {
        name: 'Saç Boyama',
        price: 300,
        duration: 120,
        salonId: 484,
        staff: {
          connect: [{ id: staff2.id }]
        }
      }
    });

    console.log('Created services:', service1.name, service2.name);
    console.log('✅ Test data created successfully!');

  } catch (error) {
    console.error('❌ Error creating test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestData();