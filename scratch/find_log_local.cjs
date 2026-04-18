const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  const found = logs.find(l => JSON.stringify(l.payload).includes('ANTIGRAVITY_ECHO_STILL_WORKS_LOCAL'));
  console.log(JSON.stringify(found, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
