import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  const withMessages = logs.filter(l => JSON.stringify(l).includes('message'));

  console.log('Total message-like logs in last 100:', withMessages.length);
  if (withMessages.length > 0) {
    console.log('Most recent message like log time:', withMessages[0].createdAt);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
