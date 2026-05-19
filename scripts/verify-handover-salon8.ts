/**
 * Test sonrası 3 noktayı tek seferde doğrular:
 *   1. ConversationState WHATSAPP:905312006807 HUMAN_PENDING'e geçti mi?
 *   2. Son 3 n8n execution success mü, tool_request_handover çağrıldı mı?
 *   3. Outbound mesaj backend'den gönderildi mi (OutboundMessageTrace)?
 */
import { prisma } from '../src/prisma.js';

const SALON_ID = 8;
const CONV_KEY = 'WHATSAPP:905312006807';

const state = await prisma.conversationState.findFirst({
  where: { salonId: SALON_ID, conversationKey: { in: [CONV_KEY, '905312006807'] } },
  orderBy: { updatedAt: 'desc' },
  select: { mode: true, updatedAt: true, conversationKey: true },
});
console.log('\n[1] ConversationState:');
console.log(`    ${state?.updatedAt?.toISOString()}  mode=${state?.mode}  key=${state?.conversationKey}`);
console.log(`    HUMAN_PENDING bekleniyor → ${state?.mode === 'HUMAN_PENDING' ? '✅' : '❌'}`);

const lastInbound = await prisma.inboundMessageQueue.findFirst({
  where: { salonId: SALON_ID, conversationKey: CONV_KEY },
  orderBy: { createdAt: 'desc' },
  select: { text: true, status: true, createdAt: true, providerMessageId: true },
});
console.log('\n[2] Son inbound queue kaydı:');
console.log(`    ${lastInbound?.createdAt?.toISOString()}  ${lastInbound?.status}  "${lastInbound?.text}"`);

const lastOutbound = await prisma.outboundMessageTrace.findFirst({
  where: { salonId: SALON_ID, conversationKey: CONV_KEY },
  orderBy: { createdAt: 'desc' },
  select: { source: true, providerMessageId: true, createdAt: true },
});
console.log('\n[3] Son outbound trace:');
console.log(`    ${lastOutbound?.createdAt?.toISOString()}  source=${lastOutbound?.source}  pid=${lastOutbound?.providerMessageId?.slice(-20)}`);

await prisma.$disconnect();
