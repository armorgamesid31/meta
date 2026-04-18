import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: {
      channel: 'INSTAGRAM',
      eventType: 'processing_result',
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log(JSON.stringify(logs.map(l => ({ id: l.id, res: (l.payload as any).summary })), null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
