// W5 — Inbound medya çözümleme. Gemini 2.5 Flash görüntü + ses'i NATIVE işler
// (ayrı Whisper gerekmez); bytes'ı modele image/file part olarak veririz. Mevcut
// medya altyapısını REUSE eder: R2 cache (presign) öncelikli, yoksa provider
// fetch (token + Chakra/IG). Sadece image + audio (video/document modele gitmez —
// salon trafiğinde nadir + maliyet; etiketle metne düşülür).
//
// Hata izolasyonu: bir medya alınamazsa atlanır, metin cevabı yine üretilir.

import axios from 'axios';
import type { ChannelType } from '@prisma/client';
import {
  presignReadUrl,
  resolveMetaTokenForChannel,
  classifyMediaKind,
  MEDIA_LIMITS,
  type MediaItemMeta,
  type MediaCachedMeta,
} from '../services/conversationMediaCache.js';
import { fetchWhatsAppMedia, fetchInstagramMedia } from '../services/conversationMediaProviders.js';
import type { AgentMediaPart } from './types.js';

// Tur başına medya part üst sınırı (token/maliyet koruması).
const MAX_PARTS = Number(process.env.AGENT_MAX_MEDIA_PARTS || 4);

export interface MediaSourceEvent {
  id: number;
  salonId: number;
  channel: ChannelType;
  conversationKey: string;
  mediaItems: unknown;
  mediaCached: unknown;
}

/** R2 cache'ten presign + indir; yoksa null. */
async function bytesFromCache(cached: MediaCachedMeta): Promise<Buffer | null> {
  try {
    const url = await presignReadUrl(cached);
    if (!url) return null;
    const resp = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 30_000 });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

/** Provider'dan (Chakra/IG) token ile indir. */
async function bytesFromProvider(
  salonId: number,
  channel: ChannelType,
  item: MediaItemMeta,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const token = await resolveMetaTokenForChannel(salonId, channel);
    if (!token) return null;
    if (channel === 'WHATSAPP') {
      if (!item.providerMediaId) return null;
      const d = await fetchWhatsAppMedia({ mediaId: item.providerMediaId, token });
      return { buffer: d.buffer, mimeType: d.mimeType };
    }
    if (channel === 'INSTAGRAM') {
      if (!item.providerMediaUrl) return null;
      const d = await fetchInstagramMedia({ url: item.providerMediaUrl, token });
      return { buffer: d.buffer, mimeType: d.mimeType };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Batch event'lerindeki image/audio medyasını AgentMediaPart[] olarak çöz.
 * Cache öncelikli, yoksa provider. Limitleri/sayıyı sınırlar; hata yutar.
 */
export async function resolveBatchMedia(events: MediaSourceEvent[]): Promise<AgentMediaPart[]> {
  const parts: AgentMediaPart[] = [];

  for (const ev of events) {
    if (parts.length >= MAX_PARTS) break;
    const items = Array.isArray(ev.mediaItems) ? (ev.mediaItems as unknown as MediaItemMeta[]) : [];
    const cachedList = Array.isArray(ev.mediaCached) ? (ev.mediaCached as unknown as MediaCachedMeta[]) : [];

    for (const item of items) {
      if (parts.length >= MAX_PARTS) break;
      if (!item || (item.type !== 'image' && item.type !== 'audio')) continue;
      const kind = classifyMediaKind(item.type);
      if (kind !== 'image' && kind !== 'audio') continue;

      let buffer: Buffer | null = null;
      let mimeType = item.mimeType || (kind === 'image' ? 'image/jpeg' : 'audio/ogg');

      const cached = cachedList.find((c) => c && c.index === item.index);
      if (cached) buffer = await bytesFromCache(cached);
      if (!buffer) {
        const dl = await bytesFromProvider(ev.salonId, ev.channel, item);
        if (dl) {
          buffer = dl.buffer;
          mimeType = dl.mimeType || mimeType;
        }
      }
      if (!buffer) continue;
      if (buffer.length > MEDIA_LIMITS[kind]) continue;

      parts.push({ kind: kind as 'image' | 'audio', mediaType: mimeType, data: buffer });
    }
  }

  return parts;
}
