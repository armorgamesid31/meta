import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const countToday = await prisma.metaChannelWebhookLog.count({
    where: {
      createdAt: {
        gte: new Date('2026-04-18T00:00:00Z')
      }
    }
  });

  console.log('Total logs today (2026-04-18):', countToday);

  if (countToday > 0) {
    const latest = await prisma.metaChannelWebhookLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.log(JSON.stringify(latest, null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
