import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.inboundMessageQueue.findMany({
    where: {
      salonId: 2,
      channel: 'WHATSAPP'
    },
    orderBy: { eventTimestamp: 'desc' },
    take: 20
  });

  const formatted = messages.map(m => ({
    id: m.id,
    time: m.eventTimestamp,
    convKey: m.conversationKey,
    type: m.messageType,
    text: m.text,
    status: m.status
  }));

  console.log(JSON.stringify(formatted, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
