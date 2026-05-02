const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();

const prisma = new PrismaClient();

(async () => {
  const salons = await prisma.salon.findMany({
    where: { id: { in: [2, 8] } },
    select: { id: true, name: true, chakraPluginId: true, chakraPhoneNumberId: true },
    orderBy: { id: 'asc' },
  });

  const bindings = await prisma.salonChannelBinding.findMany({
    where: { salonId: { in: [2, 8] }, channel: 'WHATSAPP' },
    select: { id: true, salonId: true, externalAccountId: true, isActive: true, updatedAt: true },
    orderBy: [{ salonId: 'asc' }, { updatedAt: 'desc' }],
  });

  const allByPhone = await prisma.salonChannelBinding.findMany({
    where: { channel: 'WHATSAPP', externalAccountId: { in: salons.map(s => s.chakraPhoneNumberId).filter(Boolean) } },
    select: { id: true, salonId: true, externalAccountId: true, isActive: true, updatedAt: true },
    orderBy: [{ externalAccountId: 'asc' }, { updatedAt: 'desc' }],
  });

  console.log(JSON.stringify({ salons, bindings, allByPhone }, null, 2));
  await prisma.$disconnect();
})();
