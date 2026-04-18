import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { id: 'desc' },
    take: 5
  });

  console.log(JSON.stringify(logs.map(l => ({
    id: l.id,
    time: l.createdAt,
    channel: l.channel,
    eventType: l.eventType,
    text: JSON.stringify(l.payload).substring(0, 100)
  })), null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
