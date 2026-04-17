import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const salonId = 2;
  const messages = await prisma.inboundMessageQueue.findMany({
    where: { salonId, channel: 'WHATSAPP' },
    orderBy: { eventTimestamp: 'desc' },
    take: 5
  });

  console.log('Recent WhatsApp Inbound Messages:', JSON.stringify(messages, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
