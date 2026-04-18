const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.conversationMessageEvent.findMany({
    where: { salonId: 2 },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(messages, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
