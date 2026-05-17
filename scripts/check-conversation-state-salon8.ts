import { prisma } from '../src/prisma.js';

const s = await prisma.conversationState.findMany({
  where: { salonId: 8 },
  orderBy: { updatedAt: 'desc' },
  take: 10,
  select: { conversationKey: true, channel: true, mode: true, updatedAt: true },
});
console.log('Son 10 conversation state (salon 8):');
for (const r of s) {
  console.log(' ', r.updatedAt.toISOString(), r.channel.padEnd(10), r.mode.padEnd(22), '|', r.conversationKey);
}
await prisma.$disconnect();
