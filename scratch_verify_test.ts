import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const log = await prisma.metaChannelWebhookLog.findFirst({
    where: {
        payload: {
            path: ['entry', '0', 'changes', '0', 'value', 'messages', '0', 'text', 'body'],
            equals: 'TESTING_ANTIGRAVITY'
        }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('Found log:', log ? log.id : 'NOT FOUND');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
