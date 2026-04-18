import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const msg = await prisma.conversationMessageEvent.findFirst({
    where: {
      providerMessageId: {
        startsWith: 'antigravity_echo_test'
      }
    }
  });

  console.log('Message in DB:', msg ? JSON.stringify(msg, null, 2) : 'NOT FOUND');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
