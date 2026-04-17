import { prisma } from './src/prisma.js';

async function main() {
  const conversationKey = '905312006807';
  const messages = await prisma.conversationMessageEvent.findMany({
    where: { 
        channel: 'WHATSAPP',
        conversationKey: {
            contains: conversationKey
        }
    },
    orderBy: { eventTimestamp: 'desc' },
    select: {
        providerMessageId: true,
        conversationKey: true,
        text: true,
        direction: true,
        eventTimestamp: true
    }
  });
  console.log(JSON.stringify(messages, null, 2));
}

main();
