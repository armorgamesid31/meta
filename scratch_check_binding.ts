import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const accountId = "1009188595600173";
  const binding = await prisma.salonChannelBinding.findFirst({
    where: { externalAccountId: accountId }
  });

  console.log('Binding Details:', JSON.stringify(binding, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
