import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log(`Checking all logs from last 20 entries...`);

  const logs = await prisma.metaChannelWebhookLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  console.log(`Found ${logs.length} logs.`);
  
  for (const log of logs) {
    console.log('---');
    console.log(`ID: ${log.id} | channel: ${log.channel} | direction: ${log.direction} | eventType: ${log.eventType} | time: ${log.createdAt}`);
    console.log(`salonId: ${log.salonId} | conversationKey: ${log.conversationKey}`);
    console.log('Payload:', JSON.stringify(log.payload, null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
