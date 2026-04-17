import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const id = "wamid.HBgMOTA1MzEyMDA2ODA3FQIAERgSRjQ2NTg0QzY5RTJFMTZCNTA2AA==";
  const msg = await prisma.inboundMessageQueue.findUnique({
    where: { 
      channel_providerMessageId: {
        channel: 'WHATSAPP',
        providerMessageId: id
      }
    }
  });

  console.log('Message Found:', msg ? 'YES' : 'NO');
  if (msg) console.log(JSON.stringify(msg, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
