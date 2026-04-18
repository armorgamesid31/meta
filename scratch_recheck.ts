import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  const formatted = logs.map(l => ({
    id: l.id,
    time: l.createdAt,
    salonId: l.salonId,
    direction: l.direction,
    eventType: l.eventType,
    summary: l.payload && (l.payload as any).summary ? (l.payload as any).summary : 'no-summary',
    text: (l.payload as any).entry?.[0]?.changes?.[0]?.value?.message_echoes?.[0]?.text?.body || 
          (l.payload as any).entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || 'no-text'
  }));

  console.log(JSON.stringify(formatted, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
