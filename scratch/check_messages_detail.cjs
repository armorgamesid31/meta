const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.conversationMessageEvent.findMany({
    where: { 
      salonId: 2,
      createdAt: { gte: new Date(Date.now() - 10 * 60000) }
    },
    orderBy: { createdAt: 'desc' }
  });
  console.log(JSON.stringify(messages, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
