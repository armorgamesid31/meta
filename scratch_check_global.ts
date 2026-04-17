import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.inboundMessageQueue.findMany({
    where: { channel: 'WHATSAPP' },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log('Global Recent WhatsApp Messages:', JSON.stringify(messages, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
