const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestResults = await prisma.metaChannelWebhookLog.findMany({
    where: { 
      eventType: 'processing_result',
      createdAt: { gte: new Date(Date.now() - 10 * 60000) }
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(latestResults, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
