/**
 * Salon 8 için InboundMessageQueue'nun anlık durumunu gösterir.
 * Hangi conversationKey'lerde takılı PROCESSING/PENDING kayıt var, hangi
 * providerMessageId ve hangi yaştalar — debug için.
 */
import { prisma } from '../src/prisma.js';

const SALON_ID = 8;

async function main() {
  const all = await prisma.inboundMessageQueue.findMany({
    where: { salonId: SALON_ID },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      channel: true,
      conversationKey: true,
      providerMessageId: true,
      messageType: true,
      status: true,
      text: true,
      eventTimestamp: true,
      processedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  console.log(`\n=== salonId=${SALON_ID} — son 30 inbound queue kaydı (en yeni üstte) ===\n`);
  for (const r of all) {
    const ageMs = Date.now() - (r.createdAt?.getTime() || 0);
    const ageSec = Math.round(ageMs / 1000);
    const text = (r.text || '').slice(0, 40).replace(/\n/g, ' ');
    console.log(
      `[${r.status.padEnd(11)}] ${r.channel.padEnd(10)} ` +
      `conv=${(r.conversationKey || '').slice(-15).padEnd(15)} ` +
      `msg=${(r.providerMessageId || '').slice(-20).padEnd(20)} ` +
      `type=${r.messageType.padEnd(12)} ` +
      `age=${ageSec}s  text="${text}"`
    );
  }

  const byStatus = await prisma.inboundMessageQueue.groupBy({
    by: ['status', 'channel'],
    where: { salonId: SALON_ID },
    _count: { _all: true },
  });
  console.log('\n=== Toplam (tüm zamanlar) ===');
  for (const r of byStatus) {
    console.log(`  ${r.channel.padEnd(10)} ${r.status.padEnd(12)} → ${r._count._all}`);
  }
  console.log();
}

main()
  .catch((err) => {
    console.error('HATA:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
