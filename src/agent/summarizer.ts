// Rolling summary (backend-native "150%" hafıza). Son N-mesaj penceresinin
// ÖTESİNDE kalan eski turlar ConversationState.summaryText'e ARTIMLI özetlenir.
// Böylece uzun ilişkilerde (aylar önceki tercih/karar) context pencereden taşmaz.
//
// Tetik: her başarılı turdan SONRA fire-and-forget. Pencereden yeni "düşen"
// (aged-out) mesaj sayısı eşiği aşınca eski özet + yeni düşenler katlanır → tek
// kompakt özet. summaryThroughEventId yüksek-su işareti → tekrar hesaplama yok.

import type { ChannelType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { generatePlainText } from './llm.js';
import { stripToolArtifacts } from './memory.js';

const WINDOW = Number(process.env.AGENT_MEMORY_MESSAGES || 24); // verbatim pencere
const FOLD_THRESHOLD = Number(process.env.AGENT_SUMMARY_FOLD_THRESHOLD || 8);
const SUMMARY_MAX_CHARS = Number(process.env.AGENT_SUMMARY_MAX_CHARS || 1200);

const SUMMARY_SYSTEM = [
  'Sen bir konuşma-özeti asistanısın. Bir güzellik/kuaför salonu ile müşteri',
  'arasındaki yazışmanın KALICI özetini tutuyorsun.',
  'Kurallar:',
  '- Türkçe, kısa, madde değil akıcı paragraf(lar).',
  '- Sadece SONRAKİ turlarda işe yarayacak KALICI bilgiyi tut: müşterinin adı/',
  '  tercihleri, geçmiş hizmetler, uzman/saat tercihi, alerjı/hassasiyet, açık',
  '  kalan konular, verilen sözler/kararlar.',
  '- Geçici sohbet, selamlaşma, çözülmüş ufak sorular ATILIR.',
  `- Toplam ${SUMMARY_MAX_CHARS} karakteri AŞMA. Yeni bilgi eskisini günceller.`,
  '- Uydurma; sadece verilen metinden çıkar.',
].join('\n');

/** Konuşmanın mevcut rolling summary'sini getir (yoksa null). */
export async function loadConversationSummary(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
}): Promise<string | null> {
  const st = await prisma.conversationState.findUnique({
    where: {
      salonId_channel_conversationKey: {
        salonId: params.salonId,
        channel: params.channel,
        conversationKey: params.conversationKey,
      },
    },
    select: { summaryText: true },
  });
  const s = (st?.summaryText || '').trim();
  return s || null;
}

/**
 * Gerekiyorsa rolling summary'yi güncelle. Fire-and-forget; hata yutar.
 * Pencere dışına yeni düşen (id > summaryThroughEventId, eski-blokta) mesaj
 * sayısı eşiği aşınca eski özet + bu mesajları katlar.
 */
export async function summarizeIfNeeded(params: {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  modelName?: string;
}): Promise<void> {
  try {
    const where = {
      salonId: params.salonId,
      channel: params.channel,
      conversationKey: params.conversationKey,
    };

    // Pencere sınırı: en yeni WINDOW event'in EN ESKİSİ verbatim kalır; ondan
    // öncesi özetlenebilir. Sınırı bulmak için son WINDOW event'i çek.
    const recent = await prisma.conversationMessageEvent.findMany({
      where,
      orderBy: { eventTimestamp: 'desc' },
      take: WINDOW,
      select: { id: true, eventTimestamp: true },
    });
    if (recent.length < WINDOW) return; // pencere dolmadı, özete gerek yok
    const windowStart = recent[recent.length - 1].eventTimestamp;

    const state = await prisma.conversationState.findUnique({
      where: { salonId_channel_conversationKey: where },
      select: { id: true, summaryText: true, summaryThroughEventId: true },
    });
    const through = state?.summaryThroughEventId ?? 0;

    // Pencere dışına DÜŞMÜŞ + henüz özetlenmemiş mesajlar.
    const aged = await prisma.conversationMessageEvent.findMany({
      where: {
        ...where,
        eventTimestamp: { lt: windowStart },
        id: { gt: through },
      },
      orderBy: { eventTimestamp: 'asc' },
      select: { id: true, direction: true, text: true, voiceTranscript: true, mediaDescription: true },
    });
    if (aged.length < FOLD_THRESHOLD) return; // henüz katlamaya değmez

    const lines: string[] = [];
    for (const r of aged) {
      let raw = (r.text || r.voiceTranscript || '').trim();
      const desc = (r.mediaDescription || '').trim();
      if (desc) raw = raw ? `${raw}\n[Görsel: ${desc}]` : `[Görsel: ${desc}]`;
      if (!raw) continue;
      if (r.direction === 'INBOUND') lines.push(`Müşteri: ${raw}`);
      else if (r.direction === 'OUTBOUND') {
        const clean = stripToolArtifacts(raw);
        if (clean) lines.push(`Salon: ${clean}`);
      }
    }
    if (lines.length === 0) {
      // İçerik yok ama high-water'ı ilerlet (tekrar taramayalım).
      await bumpThrough(params, aged[aged.length - 1].id);
      return;
    }

    const prevSummary = (state?.summaryText || '').trim();
    const prompt = [
      prevSummary ? `MEVCUT ÖZET:\n${prevSummary}` : 'MEVCUT ÖZET: (yok)',
      '',
      'PENCEREDEN DÜŞEN YENİ TURLAR (kronolojik):',
      lines.join('\n'),
      '',
      'Yukarıdaki yeni turları mevcut özete katlayıp GÜNCEL tek özet üret.',
    ].join('\n');

    const summary = (await generatePlainText({ system: SUMMARY_SYSTEM, prompt, modelName: params.modelName })).trim();
    if (!summary) return;
    const capped = summary.length > SUMMARY_MAX_CHARS ? summary.slice(0, SUMMARY_MAX_CHARS) : summary;

    await prisma.conversationState.upsert({
      where: { salonId_channel_conversationKey: where },
      update: { summaryText: capped, summaryUpdatedAt: new Date(), summaryThroughEventId: aged[aged.length - 1].id },
      create: {
        ...where,
        summaryText: capped,
        summaryUpdatedAt: new Date(),
        summaryThroughEventId: aged[aged.length - 1].id,
      },
    });
  } catch (err: any) {
    console.error('[agent-summarizer] failed', err?.message || err);
  }
}

async function bumpThrough(
  params: { salonId: number; channel: ChannelType; conversationKey: string },
  throughId: number,
): Promise<void> {
  const where = { salonId: params.salonId, channel: params.channel, conversationKey: params.conversationKey };
  await prisma.conversationState
    .updateMany({ where, data: { summaryThroughEventId: throughId } })
    .catch(() => {});
}
