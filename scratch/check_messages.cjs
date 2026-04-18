const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const events = await prisma.conversationMessageEvent.findMany({
    where: { salonId: 2, conversationKey: '905312006807' },
    orderBy: { eventTimestamp: 'desc' },
    take: 5,
    select: {
      id: true,
      providerMessageId: true,
      text: true,
      direction: true,
      eventTimestamp: true
    }
  });
  console.log(JSON.stringify(events, null, 2));
}

main().finally(() => prisma.$disconnect());
