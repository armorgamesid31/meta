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
import { acquireConversationLock, renewConversationLock, releaseConversationLock } from './lock.js';
import { resolveBatchMedia, type MediaSourceEvent } from './media.js';
import { describeAndStoreImages } from './mediaDescribe.js';
import { loadConversationSummary, summarizeIfNeeded } from './summarizer.js';

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

const DEBOUNCE_MS = Number(process.env.AGENT_DEBOUNCE_MS || 6_000);
// Yan-etki + gönderimden HEMEN ÖNCE son kısa bekleme + ek re-check: taslak
// biterken DB'ye yeni düşmüş ama ilk re-check anında henüz PENDING görünmeyen
// mesajı yakalar (çift-yanıt fix). continue ederse hiç yan-etki/gönderim olmaz.
const SETTLE_MS = Number(process.env.AGENT_SETTLE_MS || 2_500);
const PENDING_WINDOW_MS = Number(process.env.AGENT_PENDING_WINDOW_MS || 15 * 60_000);
const MAX_RECHECK_ROUNDS = Number(process.env.AGENT_MAX_RECHECK_ROUNDS || 30);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── NARRATION GÜVENLİK AĞI (W4.1) ──────────────────────────────────────────
// Model bazen yan-etkili bir eylemi "yaptım/yapıyorum" diye ANLATIP tool'u
// ÇAĞIRMAYABİLİYOR (temiz hafıza tool-izini sakladığı için geçmiş narration'ı
// görüp "zaten yaptım" sanıyor). Sonuç: müşteri "yönlendirildiniz / link
// gönderildi" okur ama eylem GERÇEKLEŞMEZ (sessiz hata). Çözüm: cevap gitmeden,
// metin bir eylemi OLUMLU ima ediyor + tool çağrılmadıysa → ZORLA.
// Yalnız OLUMLU çekimleri yakalar; olumsuz/soru/mastar ("yönlendiremiyorum",
// "yönlendirmek ister misiniz?") ve eşsesli ("iletişim"≠"ilet") TETİKLEMEZ.
// 45 tuzakla doğrulandı (scratch/net_regex_test.mjs). Eylemler idempotent.
//
// NET_POS: olumlu fiil çekim ekleri. Baştaki [ae]? ünlü-düşmesini (bağl+adım)
// yutar; olumsuz "em/am-ıyor" & mastar "-mek/-mak" eşleşMEZ (hiçbir olumlu ek
// 'm' ile başlamaz).
const NET_POS =
  '(?:[ıiuü]yor(?:um|uz|sun(?:uz)?)?|[ae]?d[ıiuü](?:m|k|n[ıiuü]z)?|[ae]?t[ıiuü](?:m|k)?|[ae]ca[kğ](?:[ıi]m)?|[ae]ce[kğ](?:[ıi]m)?|[ae]y[ıi]m|[ae]l[ıi]m)';
const NET_W = '[\\s\\wçğıöşüÇĞİÖŞÜ]{0,28}';
const NET_W2 = '[\\s\\wçğıöşüÇĞİÖŞÜ]{0,16}';
const NET_W3 = '[\\s\\wçğıöşüÇĞİÖŞÜ]{0,45}';

const NARRATION_NETS: Array<{ tool: string; re: RegExp }> = [
  {
    tool: 'tool_request_handover',
    re: new RegExp(
      `(uzman|insan|yetkili|temsilci|danışman|ekibimiz|ekibimize|arkadaşımız)${NET_W}(yönlendir|aktar|ilet|ulaştır|bağl|havale\\s*et)${NET_POS}`,
      'i',
    ),
  },
  {
    tool: 'tool_request_location',
    re: new RegExp(
      `((konum|adres|lokasyon|harita)${NET_W}(paylaş|gönder|yolla)${NET_POS}|(konum|adres)${NET_W2}(iletiyor|ilett[ıi]|at[ıi]yor|att[ıi])|işte${NET_W2}(konum|adres))`,
      'i',
    ),
  },
  {
    tool: 'tool_booking_link',
    // Olumsuz/arızalı "link gönderemiyorum / link çalışmıyor"u dışla: link/buton'a
    // OLUMLU sun-fiili (gönder+POS) ya da sunum-ipucu (aşağıda/buyur/hazır) ŞART.
    re: new RegExp(
      `(tek\\s*t[ıi]k${NET_W}(randevu|rezervasyon)` +
        `|(randevu|rezervasyon)${NET_W}oluşturabilir` +
        `|(randevu|rezervasyon)${NET_W2}(link|buton)${NET_W2}(gönder|paylaş|yolla|ilet)${NET_POS}` +
        `|(randevu|rezervasyon)${NET_W2}(link|buton)${NET_W2}(hazır|aşağıda|buyur|bulabilir|işte))`,
      'i',
    ),
  },
  {
    tool: 'tool_request_profile_edit',
    // POS ZORUNLU → "link gönderemiyorum" yakalanmaz.
    re: new RegExp(`(profil|bilgi)${NET_W3}(link|bağlant[ıi])${NET_W2}(gönder|paylaş|yolla|ilet|att)${NET_POS}`, 'i'),
  },
];

/** Türkçe-güvenli küçültme (İ→i, I→ı; standart toLowerCase İ'yi "i̇"ye bozar). */
function trLowerNet(s: string): string {
  return s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
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
    // customerId güvenliği: webhook'un per-mesaj çözümü bazen null veriyor
    // (IdentityBinding yok + legacy fallback channelUserId formatına takılıyor).
    // ConversationState konuşmanın bağlı müşterisini KALICI tutuyor → null ise
    // oradan düş. Yoksa kayıtlı müşteri "kayıtsız" sanılıp resmi ("Hanım") konuşur.
    let effectiveCustomerId = item.customerId;
    if (effectiveCustomerId == null) {
      const st = await prisma.conversationState
        .findUnique({
          where: {
            salonId_channel_conversationKey: {
              salonId: item.salonId,
              channel: item.channel,
              conversationKey: item.conversationKey,
            },
          },
          select: { customerId: true },
        })
        .catch(() => null);
      if (st?.customerId) effectiveCustomerId = st.customerId;
    }

    const conversationSummary = await loadConversationSummary({
      salonId: item.salonId,
      channel: item.channel,
      conversationKey: item.conversationKey,
    });
    const systemPrompt = await buildAgentSystemPrompt({
      salonId: item.salonId,
      customerId: effectiveCustomerId,
      channelProfileName: item.channelProfileName,
      registeredName: item.registeredName,
      repliedTo: item.repliedTo,
      conversationSummary,
    });

    let rounds = 0;
    while (rounds < MAX_RECHECK_ROUNDS) {
      rounds += 1;
      // Kilit heartbeat: TTL maksimum loop süresinden bağımsız → paralel-runner
      // riski yok. Kilidi kaybettiysek (başka runner devraldı) çekil.
      if (rounds > 1) {
        const held = await renewConversationLock(item.salonId, item.channel, item.conversationKey);
        if (!held) break;
      }
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
        customerId: effectiveCustomerId,
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
          // gte + batch hariç: WhatsApp aynı saniyede (aynı eventTimestamp) ardışık
          // mesaj teslim edebiliyor; salt `gt: maxTs` bunları kaçırıp ÇİFT YANIT
          // üretiyordu. gte ile aynı-saniye mesajları yakalanır, batchIds kendini saymaz.
          eventTimestamp: { gte: maxTs },
          id: { notIn: batchIds },
        },
      });
      if (newer > 0) continue; // catch-up: eski cevabı gönderme, döngü başa

      // SON SETTLE RE-CHECK (çift-yanıt fix): ilk re-check, 2. mesajın DB satırı
      // tam o an commit olmadıysa kaçırabiliyordu → ayrı tur ayrı cevap. Kısa
      // bekle + bir kez daha bak. Yan-etkilerden ÖNCE: continue güvenli (gönderim
      // ya da buton mint/handover henüz YOK).
      await sleep(SETTLE_MS);
      const newerSettle = await prisma.conversationMessageEvent.count({
        where: {
          salonId: item.salonId,
          channel: item.channel,
          conversationKey: item.conversationKey,
          direction: 'INBOUND',
          processingStatus: 'PENDING',
          eventTimestamp: { gte: maxTs },
          id: { notIn: batchIds },
        },
      });
      if (newerSettle > 0) continue;

      // STABİL → yan-etkileri çalıştır + butonlu TEK mesaj gönder + commit.
      const reply = (draft.reply || '').trim();

      // NARRATION GÜVENLİK AĞI (bkz. NARRATION_NETS): cevap metni bir yan-etkili
      // eylemi OLUMLU ima ediyor ama ilgili tool çağrılmadıysa → ZORLA. Handover
      // (kritik: kimse uyarılmaz) + konum/randevu/profil (buton hiç gitmez) için
      // ortak. Türkçe-güvenli küçültme sonrası eşleşir; eylemler idempotent.
      const replyNorm = trLowerNet(reply);
      for (const net of NARRATION_NETS) {
        if (draft.intents.some((i) => i.tool === net.tool)) continue; // zaten çağrılmış
        if (!net.re.test(replyNorm)) continue;
        draft.intents.push({ tool: net.tool, args: { note: 'narration_safety_net' } });
        console.warn(`[agent-dispatch] narration net: ${net.tool} zorlandı (salon ${item.salonId})`);
      }

      const { buttons } = await executeIntents({
        salonId: item.salonId,
        channel: item.channel,
        conversationKey: item.conversationKey,
        canonicalUserId: item.canonicalUserId,
        customerId: effectiveCustomerId,
        intents: draft.intents,
      });

      if (reply) {
        await sendAgentReply({
          salonId: item.salonId,
          channel: item.channel,
          conversationKey: item.conversationKey,
          canonicalUserId: item.canonicalUserId,
          customerId: effectiveCustomerId,
          customerName: item.customerName ?? item.registeredName ?? item.channelProfileName ?? null,
          text: reply,
          buttons,
          externalAccountId: item.externalAccountId ?? null,
        });
      }

      await markDone(batchIds);

      // Rolling summary güncelle (fire-and-forget; pencere dışı eski turları katlar).
      void summarizeIfNeeded({
        salonId: item.salonId,
        channel: item.channel,
        conversationKey: item.conversationKey,
        modelName: item.modelName,
      });

      // Görsel betimi (fire-and-forget): gelen görselleri salon-bağlamlı betimleyip
      // mediaDescription'a yaz → sonraki turlar HATIRLAR. Cevabı bloklamaz; ses
      // event'leri describer içinde atlanır (izleri voiceTranscript'te).
      if (mediaEvents.length) {
        void describeAndStoreImages({ events: mediaEvents, modelName: item.modelName });
      }

      // BREAK ETME — döngüye devam: kilit bizdeyken (re-check'ten sonra) düşen
      // bir mesaj orphan kalmasın. Sıradaki tur 5sn bekleyip PENDING'i tarar;
      // boşsa (tek-mesajlık konuşma) üstteki kontrol döngüyü bitirir.
    }
  } catch (err: any) {
    console.error('[agent-dispatch] failed', err?.message || err);
  } finally {
    await releaseConversationLock(item.salonId, item.channel, item.conversationKey);
  }
}
