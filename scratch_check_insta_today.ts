import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const countToday = await prisma.metaChannelWebhookLog.count({
    where: {
      channel: 'INSTAGRAM',
      createdAt: {
        gte: new Date('2026-04-18T00:00:00Z')
      }
    }
  });

  console.log('Total Instagram logs today (2026-04-18):', countToday);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
