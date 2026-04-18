import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const log = await prisma.metaChannelWebhookLog.findFirst({
    where: {
        createdAt: {
            gte: new Date('2026-04-18T07:50:00Z')
        }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(JSON.stringify({
    id: log?.id,
    time: log?.createdAt,
    payload: log?.payload
  }, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
