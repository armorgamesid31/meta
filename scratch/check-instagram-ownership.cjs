const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
dotenv.config();

const prisma = new PrismaClient();

(async () => {
  const ig = await prisma.salonChannelBinding.findMany({
    where: { channel: 'INSTAGRAM', salonId: { in: [2, 8] } },
    select: { id: true, salonId: true, externalAccountId: true, isActive: true, updatedAt: true },
    orderBy: [{ externalAccountId: 'asc' }, { updatedAt: 'desc' }],
  });
  console.log(JSON.stringify(ig, null, 2));
  await prisma.$disconnect();
})();
