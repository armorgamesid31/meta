import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Lokal DB Hazırlanıyor...');
  const hashedPassword = await bcrypt.hash('123456', 10);

  // 1. Salon
  const salon = await prisma.salon.upsert({
    where: { id: 1 },
    update: { name: 'Palm Beauty Lokal' },
    create: {
      id: 1,
      name: 'Palm Beauty Lokal',
      slug: 'palm-beauty-lokal',
      status: 'ACTIVE',
    }
  });

  // 2. User
  await prisma.user.upsert({
    where: { email: 'owner@palmbeauty.com' },
    update: { password: hashedPassword, salonId: 1 },
    create: {
      email: 'owner@palmbeauty.com',
      password: hashedPassword,
      name: 'Palm Owner',
      role: 'OWNER',
      salonId: 1,
    }
  });

  // 3. Customer (Appointment için gerekli)
  const customer = await prisma.customer.upsert({
    where: { phone: '5551234567' },
    update: {},
    create: {
      firstName: 'Test',
      lastName: 'Müşteri',
      phone: '5551234567',
      salonId: 1,
    }
  });

  // 4. Appointment
  await prisma.appointment.create({
    data: {
      salonId: 1,
      customerId: customer.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      status: 'CONFIRMED',
      totalPrice: 150,
      notes: 'Lokal Test Randevusu',
    }
  });

  console.log('✅ İşlem Tamam: Kullanıcı (owner@palmbeauty.com) ve test randevusu eklendi.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
