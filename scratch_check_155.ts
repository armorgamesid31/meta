import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const log = await prisma.metaChannelWebhookLog.findUnique({
    where: { id: 155 }
  });

  console.log(JSON.stringify(log, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
