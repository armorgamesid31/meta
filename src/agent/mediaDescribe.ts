// W5+ — Gelen görselin salon-bağlamlı KALICI betimi. Cevap GÖNDERİLDİKTEN sonra
// async çalışır (müşteri cevabını BLOKLAMAZ). Her görsel event'i için Gemini Flash
// ile ≤2 cümle betim üretip ConversationMessageEvent.mediaDescription'a yazar.
// Hafıza (memory.ts/summarizer.ts) bunu "[Görsel: ...]" olarak okur → SONRAKİ
// turlar görseli HATIRLAR. n8n paritesi: orada da görsel analiz metni hafızaya
// giriyordu; başlıksız görsel aksi halde çapraz-tur kaybolurdu (o anki tur native
// görür ama iz bırakmazdı). Hata izole: betim üretilemezse sessiz geçilir.

import type { ToolSet } from 'ai';
import { prisma } from '../prisma.js';
import { runAgentTurn } from './llm.js';
import { resolveBatchMedia, type MediaSourceEvent } from './media.js';
import type { AgentMessage } from './types.js';

const NO_TOOLS: ToolSet = {};

// Salon bağlamı + KAPSAM (Berkay: "doğru bağlam ve kapsamda analiz kritik"):
// model neyi yakalamalı, neyi yazmamalı.
const DESCRIBE_SYSTEM = [
  'Sen bir güzellik salonu asistanısın. Müşterinin gönderdiği görseli, SONRAKİ',
  'konuşmada hatırlamak üzere KISACA (en fazla 2 cümle) betimle.',
  'Salon bağlamında ÖNEMLİ olanı yaz: saç (renk/uzunluk/kesim/model/durum), cilt,',
  'tırnak, kaş/kirpik, makyaj; veya renk/stil ÖRNEĞİ, ekran görüntüsü, ürün, fiş/fiyat,',
  'referans/ilham fotoğrafı. SADECE betimle — selamlama, öneri, yorum, soru EKLEME.',
  'Görsel salonla ilgisizse kısaca ne olduğunu yaz.',
].join(' ');

/** Event'te görsel-tipli medya var mı (gereksiz indirme/model çağrısı yapmamak için). */
function eventHasImage(ev: MediaSourceEvent): boolean {
  const items = Array.isArray(ev.mediaItems) ? (ev.mediaItems as Array<{ type?: string }>) : [];
  return items.some((it) => it && typeof it === 'object' && it.type === 'image');
}

/**
 * Batch'teki görsel event'lerini betimle + mediaDescription'a yaz. Fire-and-forget
 * (dispatch cevabı gönderdikten sonra `void` ile çağırır). Ses event'leri atlanır
 * (onların izni voiceTranscript zaten taşır).
 */
export async function describeAndStoreImages(params: {
  events: MediaSourceEvent[];
  modelName?: string;
}): Promise<void> {
  for (const ev of params.events) {
    try {
      if (!eventHasImage(ev)) continue;
      const parts = await resolveBatchMedia([ev]);
      const images = parts.filter((p) => p.kind === 'image');
      if (!images.length) continue;

      const messages: AgentMessage[] = [{ role: 'user', content: 'Bu görseli betimle.', media: images }];
      const r = await runAgentTurn({
        system: DESCRIBE_SYSTEM,
        messages,
        tools: NO_TOOLS,
        modelName: params.modelName,
        maxSteps: 1,
      });
      const desc = (r.text || '').trim().slice(0, 2000);
      if (!desc) continue;

      await prisma.conversationMessageEvent
        .update({ where: { id: ev.id }, data: { mediaDescription: desc } })
        .catch(() => {});
    } catch {
      /* best-effort: betimleme başarısızsa atla (cevap zaten gitti) */
    }
  }
}
