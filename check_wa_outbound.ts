import { prisma } from './src/prisma.js';

async function main() {
  const messages = await prisma.conversationMessageEvent.findMany({
    where: { channel: 'WHATSAPP', direction: 'OUTBOUND' },
    orderBy: { eventTimestamp: 'desc' },
    take: 10,
    select: {
        providerMessageId: true,
        conversationKey: true,
        text: true,
        eventTimestamp: true
    }
  });
  console.log(JSON.stringify(messages, null, 2));
}

main();
