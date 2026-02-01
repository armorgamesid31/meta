import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addStaff() {
  try {
    console.log('Adding staff to salon 49...');

    const staff = [
      { name: 'Ahmet Yılmaz', salonId: 49 },
      { name: 'Ayşe Kaya', salonId: 49 },
      { name: 'Mehmet Demir', salonId: 49 }
    ];

    for (const s of staff) {
      const created = await prisma.staff.create({ data: s });
      console.log(`Created staff: ${created.name} (ID: ${created.id})`);
    }

    console.log('✅ Staff added successfully!');
  } catch (error) {
    console.error('❌ Error adding staff:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addStaff();