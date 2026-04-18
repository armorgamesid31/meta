import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const log = await prisma.metaChannelWebhookLog.findUnique({
    where: { id: 155 }
  });

  const body = (log?.payload as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;
  console.log('Text body for 155:', body);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
