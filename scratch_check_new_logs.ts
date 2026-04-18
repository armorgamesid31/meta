import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: {
      OR: [
        { salonId: 2 },
        { salonId: null }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const formatted = logs.map(l => ({
    id: l.id,
    time: l.createdAt,
    salonId: l.salonId,
    channel: l.channel,
    direction: l.direction,
    eventType: l.eventType,
    summary: l.payload && (l.payload as any).summary ? (l.payload as any).summary : (l.payload as any).entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || 'no-text'
  }));

  console.log(JSON.stringify(formatted, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
