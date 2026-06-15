// Konuşma hafızası (W3) — TEMİZ context builder. ConversationMessageEvent'ten
// son N mesajı yükler; tool-artifact ("[Used tools: ...]") STRIP edilir. Bu,
// bugünkü halüsinasyonun fix'i: model hafızada sahte tool-çıktısı görmez →
// uydurmaz. (n8n'in uçucu in-memory buffer'ının yerine kalıcı DB kaynağı.)

import { prisma } from '../prisma.js';
import type { ChannelType } from '@prisma/client';
import type { AgentMessage } from './types.js';

const DEFAULT_MAX_MESSAGES = Number(process.env.AGENT_MEMORY_MESSAGES || 24);

/** Asistan cevaplarına sızan internal tool-artifact'ı temizle.
 *  - Tam "[Used tools: ...]" bloğu.
 *  - Eski n8n verisinde yarım kalmış varyant (yalnız kapanış "]" baş­ta kalmış,
 *    örn. "] Bilgilerini güncelle...") → baştaki orphan "]" temizlenir.
 *  - Satır içinde sızan Gemini text-mode tool kodu ("tool_code\nprint(tool_x())"). */
export function stripToolArtifacts(text: string): string {
  return text
    .replace(/\[Used tools:[\s\S]*?\]\s*/gi, '')
    .replace(/```?\s*tool_code[\s\S]*?(?:```|$)/gi, '')
    .replace(/\bprint\(\s*tool_[a-z_]+\([^)]*\)\s*\)/gi, '')
    .replace(/^\s*\]\s*/, '')
    .trim();
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
  /** Bu tur işlenmekte olan inbound event id'leri — geçmişe dahil edilmez
   *  (yoksa son müşteri turu hem hafızada hem mergedUserMessage'da çiftlenir). */
  excludeIds?: number[];
}): Promise<AgentMessage[]> {
  const limit = params.maxMessages ?? DEFAULT_MAX_MESSAGES;

  const rows = await prisma.conversationMessageEvent.findMany({
    where: {
      salonId: params.salonId,
      channel: params.channel,
      conversationKey: params.conversationKey,
      ...(params.excludeIds && params.excludeIds.length ? { id: { notIn: params.excludeIds } } : {}),
    },
    orderBy: { eventTimestamp: 'desc' },
    take: limit,
    select: { direction: true, text: true, voiceTranscript: true, mediaDescription: true },
  });
  rows.reverse(); // kronolojik

  const messages: AgentMessage[] = [];
  for (const r of rows) {
    let raw = (r.text || r.voiceTranscript || '').trim();
    // Görsel betimi (varsa) "[Görsel: ...]" olarak eklenir → model önceki turlarda
    // gelen görseli HATIRLAR (başlıksız görsel aksi halde çapraz-tur kaybolur).
    const desc = (r.mediaDescription || '').trim();
    if (desc) raw = raw ? `${raw}\n[Görsel: ${desc}]` : `[Görsel: ${desc}]`;
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
