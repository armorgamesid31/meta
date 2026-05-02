const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();

const prisma = new PrismaClient();

(async () => {
  const phoneId = '1009188595600173';

  const before = await prisma.salonChannelBinding.findMany({
    where: { channel: 'WHATSAPP', externalAccountId: phoneId },
    select: { id: true, salonId: true, externalAccountId: true, isActive: true, updatedAt: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.salonChannelBinding.updateMany({
      where: { channel: 'WHATSAPP', externalAccountId: phoneId },
      data: { salonId: 8, isActive: true },
    });

    await tx.salonChannelBinding.updateMany({
      where: { channel: 'WHATSAPP', salonId: 2, externalAccountId: { not: phoneId } },
      data: { isActive: false },
    });

    await tx.salon.update({
      where: { id: 2 },
      data: { chakraPhoneNumberId: null },
    });

    await tx.salon.update({
      where: { id: 8 },
      data: { chakraPhoneNumberId: phoneId },
    });
  });

  const after = await prisma.salonChannelBinding.findMany({
    where: { channel: 'WHATSAPP', externalAccountId: phoneId },
    select: { id: true, salonId: true, externalAccountId: true, isActive: true, updatedAt: true },
  });

  const salons = await prisma.salon.findMany({
    where: { id: { in: [2, 8] } },
    select: { id: true, name: true, chakraPluginId: true, chakraPhoneNumberId: true },
    orderBy: { id: 'asc' },
  });

  console.log(JSON.stringify({ before, after, salons }, null, 2));
  await prisma.$disconnect();
})();
