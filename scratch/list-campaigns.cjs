require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.campaign.findMany({
    select: {
      id: true,
      salonId: true,
      name: true,
      type: true,
      status: true,
      deliveryMode: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: [{ salonId: 'asc' }, { createdAt: 'desc' }],
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
