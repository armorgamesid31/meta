import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300
  });

  const matches = logs.filter(l => JSON.stringify(l.payload).includes('smb_message_echoes'));

  console.log('Total SMB Echoes:', matches.length);
  if (matches.length > 0) {
    const first = matches[0];
    console.log('ID:', first.id, 'At:', first.createdAt);
    console.log(JSON.stringify(first.payload, null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
