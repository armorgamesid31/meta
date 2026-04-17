import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const salonId = 2;
  console.log(`Checking logs for Salon ID: ${salonId}`);

  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: {
      OR: [
        { salonId },
        { payload: { path: ['salonId'], equals: salonId } } // Fallback if payload contains salonId
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  console.log(`Found ${logs.length} logs.`);
  
  for (const log of logs) {
    console.log('---');
    console.log(`ID: ${log.id} | channel: ${log.channel} | direction: ${log.direction} | eventType: ${log.eventType} | time: ${log.createdAt}`);
    console.log(`conversationKey: ${log.conversationKey}`);
    console.log('Payload:', JSON.stringify(log.payload, null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
