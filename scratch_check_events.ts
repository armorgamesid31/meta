import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const events = await prisma.conversationMessageEvent.findMany({
    where: { 
      salonId: 2,
      channel: 'WHATSAPP'
    },
    orderBy: { eventTimestamp: 'desc' },
    take: 10
  });

  console.log('Recent WhatsApp Events for Salon 2:', JSON.stringify(events, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
