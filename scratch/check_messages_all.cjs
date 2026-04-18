const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const events = await prisma.conversationMessageEvent.findMany({
    orderBy: { eventTimestamp: 'desc' },
    take: 5,
    select: {
      salonId: true,
      conversationKey: true,
      text: true,
      direction: true,
      eventTimestamp: true
    }
  });
  console.log(JSON.stringify(events, null, 2));
}

main().finally(() => prisma.$disconnect());
