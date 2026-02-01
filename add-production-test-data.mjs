import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addProductionTestData() {
  try {
    console.log('Adding test data to production database...');

    // Check if salon already exists
    let salon = await prisma.salon.findFirst();
    if (!salon) {
      salon = await prisma.salon.create({
        data: {
          name: 'Demo Salon'
        }
      });
      console.log('Created salon:', salon.id);
    }

    const salonId = salon.id;

    // Add staff
    const staffData = [
      { name: 'Ahmet Yılmaz', salonId },
      { name: 'Ayşe Kaya', salonId },
      { name: 'Mehmet Demir', salonId }
    ];

    for (const staff of staffData) {
      const existing = await prisma.staff.findFirst({
        where: { name: staff.name, salonId: salonId }
      });
      if (!existing) {
        await prisma.staff.create({ data: staff });
        console.log('Created staff:', staff.name);
      }
    }

    // Add services
    const serviceData = [
      { name: 'Saç Kesimi', price: 150, duration: 60, salonId },
      { name: 'Saç Boyama', price: 300, duration: 120, salonId },
      { name: 'Manikür', price: 120, duration: 45, salonId },
      { name: 'Pedikür', price: 150, duration: 60, salonId }
    ];

    for (const service of serviceData) {
      const existing = await prisma.service.findFirst({
        where: { name: service.name, salonId: salonId }
      });
      if (!existing) {
        await prisma.service.create({ data: service });
        console.log('Created service:', service.name);
      }
    }

    // Add salon settings
    const settings = await prisma.salonSettings.findUnique({
      where: { salonId: salonId }
    });
    if (!settings) {
      await prisma.salonSettings.create({
        data: {
          salonId: salonId,
          workStartHour: 9,
          workEndHour: 18,
          slotInterval: 30
        }
      });
      console.log('Created salon settings');
    }

    console.log('✅ Production test data added successfully!');
    console.log(`Salon ID: ${salonId}`);

  } catch (error) {
    console.error('❌ Error adding test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addProductionTestData();