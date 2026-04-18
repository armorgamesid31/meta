const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking MetaChannelWebhookLog (Last 10 mins) ---');
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: { 
      createdAt: { gte: new Date(Date.now() - 10 * 60000) }
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  logs.forEach(l => {
    console.log(`ID: ${l.id}, Type: ${l.eventType}, Created: ${l.createdAt}, Host: ${l.headers?.host}`);
    if (l.eventType === 'message' || l.eventType === 'other') {
      const msg = l.payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || l.payload?.entry?.[0]?.changes?.[0]?.value?.message_echoes?.[0];
      if (msg) {
        console.log(`  Content: ${msg.text?.body || msg.caption || 'Media/Other'}`);
        console.log(`  From: ${msg.from}, To: ${msg.to}`);
      }
    }
  });

  console.log('\n--- Checking ConversationMessageEvent (Last 10 mins) ---');
  const messages = await prisma.conversationMessageEvent.findMany({
    where: { 
      salonId: 2,
      createdAt: { gte: new Date(Date.now() - 10 * 60000) }
    },
    orderBy: { createdAt: 'desc' }
  });

  messages.forEach(m => {
    console.log(`ID: ${m.id}, Text: ${m.text}, isEcho: ${m.isEcho}, Created: ${m.createdAt}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
