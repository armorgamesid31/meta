/**
 * Salon 8 için WhatsApp + Instagram'da işlenmemiş (PENDING / PROCESSING)
 * InboundMessageQueue kayıtlarını siler. n8n workflow'unun debounce/sıra
 * mantığı tıkanırsa kuyruğu temizlemek için tek seferlik kullanılır.
 *
 * Çalıştır: npx tsx scripts/purge-unprocessed-inbound-salon8.ts
 */
import { prisma } from '../src/prisma.js';

const SALON_ID = 8;
const CHANNELS = ['WHATSAPP', 'INSTAGRAM'] as const;
const STATUSES = ['PENDING', 'PROCESSING'] as const;

async function main() {
  const before = await prisma.inboundMessageQueue.groupBy({
    by: ['channel', 'status'],
    where: {
      salonId: SALON_ID,
      channel: { in: CHANNELS as any },
      status: { in: STATUSES as any },
    },
    _count: { _all: true },
  });

  console.log(`\n=== salonId=${SALON_ID} — silinecek kayıtlar ===`);
  if (before.length === 0) {
    console.log('  (hiç eşleşen kayıt yok — temiz)');
  } else {
    for (const row of before) {
      console.log(`  ${row.channel.padEnd(10)} ${row.status.padEnd(12)} → ${row._count._all}`);
    }
    const total = before.reduce((sum, r) => sum + r._count._all, 0);
    console.log(`  TOPLAM: ${total}\n`);
  }

  const result = await prisma.inboundMessageQueue.deleteMany({
    where: {
      salonId: SALON_ID,
      channel: { in: CHANNELS as any },
      status: { in: STATUSES as any },
    },
  });

  console.log(`✅ Silindi: ${result.count} kayıt`);

  // Doğrulama
  const after = await prisma.inboundMessageQueue.count({
    where: {
      salonId: SALON_ID,
      channel: { in: CHANNELS as any },
      status: { in: STATUSES as any },
    },
  });
  console.log(`📊 Sonrası kalan işlenmemiş kayıt: ${after}\n`);
}

main()
  .catch((err) => {
    console.error('HATA:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
