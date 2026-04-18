import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: { eventType: 'message' },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const matches = logs.filter(l => {
    const payload = l.payload as any;
    const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    return msg?.from === '447463037149';
  });

  console.log('Echo messages found in logs:', JSON.stringify(matches.map(m => ({
    id: m.id,
    text: (m.payload as any).entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body
  })), null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
