const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.metaChannelWebhookLog.findMany({
    where: { 
      channel: 'WHATSAPP',
      createdAt: { gte: new Date(Date.now() - 30 * 60000) }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  const externalEchoes = logs.filter(l => {
    const headers = l.headers || {};
    if (headers.host === 'localhost:3000') return false;
    
    const p = l.payload;
    if (p?.entry?.[0]?.changes?.[0]?.field === 'smb_message_echoes') return true;
    const msg = p?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg && msg.from === p?.entry?.[0]?.changes?.[0]?.value?.metadata?.display_phone_number) return true;
    return false;
  });

  console.log('Found', externalEchoes.length, 'external echoes');
  if (externalEchoes.length > 0) {
    console.log(JSON.stringify(externalEchoes[0], null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
