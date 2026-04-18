import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: { 
      payload: {
        path: ['entry', '0', 'changes', '0', 'field'],
        equals: 'smb_message_echoes'
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log('Echoes found:', logs.length);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
