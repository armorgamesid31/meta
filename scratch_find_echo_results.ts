import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: { eventType: 'processing_result' },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  const echoes = logs.filter(l => {
    const summary = (l.payload as any).summary;
    if (Array.isArray(summary)) {
        return summary.some((p: any) => p.isEcho === true);
    }
    return false;
  });

  console.log('Echoes in processing results found:', echoes.length);
  if (echoes.length > 0) {
    console.log(JSON.stringify(echoes.map(e => ({
        id: e.id,
        summary: e.payload
    })), null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
