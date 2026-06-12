// Konuşma hafızası (W3) — TEMİZ context builder. ConversationMessageEvent'ten
// son N mesajı yükler; tool-artifact ("[Used tools: ...]") STRIP edilir. Bu,
// bugünkü halüsinasyonun fix'i: model hafızada sahte tool-çıktısı görmez →
// uydurmaz. (n8n'in uçucu in-memory buffer'ının yerine kalıcı DB kaynağı.)

import { prisma } from '../prisma.js';
import type { ChannelType } from '@prisma/client';
import type { AgentMessage } from './types.js';

const DEFAULT_MAX_MESSAGES = Number(process.env.AGENT_MEMORY_MESSAGES || 24);

/** Asistan cevaplarına sızan internal tool-artifact'ı temizle. */
export function stripToolArtifacts(text: string): string {
  return text.replace(/\[Used tools:[\s\S]*?\]\s*/gi, '').trim();
}

/**
 * Bir konuşmanın son N mesajını temiz user/assistant turları olarak yükle.
 * - INBOUND → user (metin yoksa voice transcript).
 * - OUTBOUND (AI veya insan) → assistant (müşteri-yüzlü taraf; tool-artifact strip).
 * - SYSTEM / boş / medya-only → atlanır (medya etiketleri W5'te eklenecek).
 */
export async function loadConversationMemory(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  maxMessages?: number;
}): Promise<AgentMessage[]> {
  const limit = params.maxMessages ?? DEFAULT_MAX_MESSAGES;

  const rows = await prisma.conversationMessageEvent.findMany({
    where: {
      salonId: params.salonId,
      channel: params.channel,
      conversationKey: params.conversationKey,
    },
    orderBy: { eventTimestamp: 'desc' },
    take: limit,
    select: { direction: true, text: true, voiceTranscript: true },
  });
  rows.reverse(); // kronolojik

  const messages: AgentMessage[] = [];
  for (const r of rows) {
    const raw = (r.text || r.voiceTranscript || '').trim();
    if (!raw) continue;
    if (r.direction === 'INBOUND') {
      messages.push({ role: 'user', content: raw });
    } else if (r.direction === 'OUTBOUND') {
      const clean = stripToolArtifacts(raw);
      if (clean) messages.push({ role: 'assistant', content: clean });
    }
  }
  return messages;
}
