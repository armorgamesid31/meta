// W4 — Backend-native konuşma orkestrasyonu (n8n buffer'ının yerini alır).
//
// Akış (bir inbound geldiğinde):
//   1. AI izinli mi? (state.aiAllowed) değilse hiç çalışma.
//   2. Per-konuşma kilidi al. Alınamazsa: mesaj zaten PENDING yazıldı, aktif
//      runner'ın re-check'i yakalar → çık.
//   3. DÖNGÜ:
//        a. 5sn debounce (hızlı ardışık mesajlar tek tura birleşsin).
//        b. Bu konuşmanın PENDING inbound'larını çek → metni birleştir.
//        c. Hiç yoksa → bitir.
//        d. TASLAK tur (yan-etkisiz): memory(hariç=batch) + merged → reply+intents.
//        e. RE-CHECK: taslak sürerken yeni mesaj geldi mi? Geldiyse → döngü başa
//           (sınır YOK; müşteri sözünü bitirene kadar; eski cevabı GÖNDERME).
//        f. Stabil → intents'i çalıştır (buton hazırla) + reply'i butonla TEK
//           mesajda gönder + hafızaya işle + batch'i DONE işaretle → bitir.
//   4. Kilidi bırak.
//
// Çekirdek ilke (halüsinasyon + çift-cevap fix'i): taslak turlar YAN-ETKİSİZ;
// gerçek yan-etki (buton mint, gönderim, commit) yalnız NİHAİ (stabil) turda.

import type { ChannelType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { buildAgentSystemPrompt } from './systemPrompt.js';
import { runAgentDraft, executeIntents } from './orchestrator.js';
import { sendAgentReply } from './outbound.js';
import { acquireConversationLock, releaseConversationLock } from './lock.js';
import { resolveBatchMedia, type MediaSourceEvent } from './media.js';

/** channelWebhooks'un ürettiği normalize item'dan ihtiyaç duyduğumuz alanlar. */
export interface AgentInboundItem {
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  canonicalUserId: string | null;
  customerId: number | null;
  channelProfileName: string | null;
  registeredName: string | null;
  customerName?: string | null;
  externalAccountId?: string | null;
  aiAllowed: boolean;
  repliedTo?: Parameters<typeof buildAgentSystemPrompt>[0]['repliedTo'];
  modelName?: string;
}

const DEBOUNCE_MS = Number(process.env.AGENT_DEBOUNCE_MS || 5_000);
const PENDING_WINDOW_MS = Number(process.env.AGENT_PENDING_WINDOW_MS || 15 * 60_000);
const MAX_RECHECK_ROUNDS = Number(process.env.AGENT_MAX_RECHECK_ROUNDS || 30);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PendingMsg {
  id: number;
  text: string;
  ts: Date;
  hasMedia: boolean;
  media: MediaSourceEvent;
}

/** Bu konuşmanın işlenmemiş (PENDING) inbound mesajlarını kronolojik çek.
 *  Medya event'leri (görsel/ses) metni boş olsa da TUTULUR — W5 model part'ı. */
async function fetchPending(item: AgentInboundItem): Promise<PendingMsg[]> {
  const since = new Date(Date.now() - PENDING_WINDOW_MS);
  const rows = await prisma.conversationMessageEvent.findMany({
    where: {
      salonId: item.salonId,
      channel: item.channel,
      conversationKey: item.conversationKey,
      direction: 'INBOUND',
      processingStatus: 'PENDING',
      eventTimestamp: { gte: since },
    },
    orderBy: { eventTimestamp: 'asc' },
    select: {
      id: true,
      text: true,
      voiceTranscript: true,
      eventTimestamp: true,
      mediaItems: true,
      mediaCached: true,
    },
  });
  return rows
    .map((r) => {
      const hasMedia = Array.isArray(r.mediaItems) && (r.mediaItems as unknown[]).length > 0;
      return {
        id: r.id,
        text: (r.text || r.voiceTranscript || '').trim(),
        ts: r.eventTimestamp,
        hasMedia,
        media: {
          id: r.id,
          salonId: item.salonId,
          channel: item.channel,
          conversationKey: item.conversationKey,
          mediaItems: r.mediaItems,
          mediaCached: r.mediaCached,
        } as MediaSourceEvent,
      };
    })
    .filter((r) => r.text.length > 0 || r.hasMedia);
}

/** Inbound batch'i işlendi olarak işaretle (DONE) — tekrar işlenmesin. */
async function markDone(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await prisma.conversationMessageEvent
    .updateMany({ where: { id: { in: ids } }, data: { processingStatus: 'DONE' } })
    .catch((err) => console.error('[agent-dispatch] markDone failed', err?.message || err));
}

/**
 * Bir inbound mesajı işle. channelWebhooks (W6 cutover'da) forwardToN8n yerine
 * bunu çağırır. Fire-and-forget güvenli (await edilmese de kilit + PENDING ile
 * tutarlı). Hata yutulur (webhook 200 dönmeye devam etmeli).
 */
export async function dispatchAgentInbound(item: AgentInboundItem): Promise<void> {
  if (!item.aiAllowed) return;

  const got = await acquireConversationLock(item.salonId, item.channel, item.conversationKey);
  if (!got) return; // aktif runner re-check'te yakalar

  try {
    const systemPrompt = await buildAgentSystemPrompt({
      salonId: item.salonId,
      customerId: item.customerId,
      channelProfileName: item.channelProfileName,
      registeredName: item.registeredName,
      repliedTo: item.repliedTo,
    });

    let rounds = 0;
    while (rounds < MAX_RECHECK_ROUNDS) {
      rounds += 1;
      await sleep(DEBOUNCE_MS);

      const pending = await fetchPending(item);
      if (pending.length === 0) break;

      const batchIds = pending.map((p) => p.id);
      const maxTs = pending[pending.length - 1].ts;
      const merged = pending.map((p) => p.text).filter(Boolean).join('\n');

      // W5: current-batch görsel/ses → model part'ları (hata izole, atlanır).
      const mediaEvents = pending.filter((p) => p.hasMedia).map((p) => p.media);
      const media = mediaEvents.length ? await resolveBatchMedia(mediaEvents) : [];

      const draft = await runAgentDraft({
        salonId: item.salonId,
        channel: item.channel,
        conversationKey: item.conversationKey,
        canonicalUserId: item.canonicalUserId,
        customerId: item.customerId,
        systemPrompt,
        mergedUserMessage: merged,
        modelName: item.modelName,
        excludeIds: batchIds,
        media,
      });

      // RE-CHECK: taslak sürerken yeni mesaj geldi mi? (sınır yok — yakala)
      const newer = await prisma.conversationMessageEvent.count({
        where: {
          salonId: item.salonId,
          channel: item.channel,
          conversationKey: item.conversationKey,
          direction: 'INBOUND',
          processingStatus: 'PENDING',
          eventTimestamp: { gt: maxTs },
        },
      });
      if (newer > 0) continue; // catch-up: eski cevabı gönderme, döngü başa

      // STABİL → yan-etkileri çalıştır + butonlu TEK mesaj gönder + commit.
      const reply = (draft.reply || '').trim();
      const { buttons } = await executeIntents({
        salonId: item.salonId,
        channel: item.channel,
        conversationKey: item.conversationKey,
        canonicalUserId: item.canonicalUserId,
        customerId: item.customerId,
        intents: draft.intents,
      });

      if (reply) {
        await sendAgentReply({
          salonId: item.salonId,
          channel: item.channel,
          conversationKey: item.conversationKey,
          canonicalUserId: item.canonicalUserId,
          customerId: item.customerId,
          customerName: item.customerName ?? item.registeredName ?? item.channelProfileName ?? null,
          text: reply,
          buttons,
          externalAccountId: item.externalAccountId ?? null,
        });
      }

      await markDone(batchIds);
      break;
    }
  } catch (err: any) {
    console.error('[agent-dispatch] failed', err?.message || err);
  } finally {
    await releaseConversationLock(item.salonId, item.channel, item.conversationKey);
  }
}
