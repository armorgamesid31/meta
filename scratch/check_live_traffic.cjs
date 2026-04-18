const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.metaChannelWebhookLog.count({
    where: { 
      headers: { path: ['host'], equals: 'app.berkai.shop' },
      createdAt: { gte: new Date(Date.now() - 30 * 60000) }
    }
  });
  console.log('Incoming webhooks to app.berkai.shop in last 30 mins:', count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
