import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  const matches = logs.filter(l => JSON.stringify(l.payload).includes('smb_message_echoes'));

  console.log('SMB Echoes found in last 200 logs:', matches.length);
  if (matches.length > 0) {
    console.log(JSON.stringify(matches.map(m => ({
        id: m.id,
        text: (m.payload as any).entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || 'no-text'
    })), null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
