const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const bindings = await prisma.salonChannelBinding.findMany({
    where: { salonId: 2 }
  });
  console.log(JSON.stringify(bindings, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
