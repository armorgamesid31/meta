const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: { 
      channel: 'WHATSAPP',
      createdAt: { gte: new Date(Date.now() - 30 * 60000) } // last 30 mins
    },
    orderBy: { createdAt: 'desc' }
  });
  
  const realEchoes = logs.filter(l => {
    const p = l.payload;
    if (p?.entry?.[0]?.changes?.[0]?.field === 'smb_message_echoes') return true;
    const msg = p?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg && msg.from === p?.entry?.[0]?.changes?.[0]?.value?.metadata?.display_phone_number) return true;
    return false;
  });

  console.log('Found', realEchoes.length, 'potential echoes');
  if (realEchoes.length > 0) {
    console.log(JSON.stringify(realEchoes[0], null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
