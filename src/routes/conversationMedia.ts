// Conversation media read + retention endpoints.
//
//   GET  /conversations/messages/:messageId/media/:mediaIndex
//        Returns a short-lived signed R2 URL for the cached media item.
//        Lazy-fetches from Meta on cache miss. Inbound + outbound treated
//        symmetrically (outbound is just always already cached).
//
//   POST /conversations/customer-data/delete (admin/internal — see internalRoutes)
//
// Auth: caller must be a member of the salon that owns the message.

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import {
  isMediaCacheEnabled,
  presignReadUrl,
  putToR2,
  persistMediaCached,
  resolveMetaTokenForChannel,
  coalesce,
  coalesceKey,
  classifyMediaKind,
  MEDIA_LIMITS,
  type MediaItemMeta,
  type MediaCachedMeta,
} from '../services/conversationMediaCache.js';
import {
  fetchWhatsAppMedia,
  fetchInstagramMedia,
} from '../services/conversationMediaProviders.js';

const router = Router();

router.get(
  '/conversations/messages/:messageId/media/:mediaIndex',
  authenticateToken,
  async (req: any, res: any) => {
    if (!isMediaCacheEnabled()) {
      throw new BusinessError(
        'PRECONDITION_FAILED',
        'Medya önbelleği yapılandırılmamış.',
        412,
      );
    }
    if (!req.user?.salonId) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }
    const salonId = req.user.salonId as number;

    const messageId = Number(req.params.messageId);
    const mediaIndex = Number(req.params.mediaIndex);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      throw new BusinessError('VALIDATION_FAILED', 'messageId gerekli.', 400);
    }
    if (!Number.isInteger(mediaIndex) || mediaIndex < 0) {
      throw new BusinessError('VALIDATION_FAILED', 'mediaIndex gerekli.', 400);
    }

    const row = await prisma.conversationMessageEvent.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        salonId: true,
        channel: true,
        conversationKey: true,
        mediaItems: true,
        mediaCached: true,
      },
    });
    if (!row || row.salonId !== salonId) {
      throw new BusinessError('NOT_FOUND', 'Mesaj bulunamadı.', 404);
    }

    const items = Array.isArray(row.mediaItems) ? (row.mediaItems as unknown as MediaItemMeta[]) : [];
    const item = items.find(it => it && it.index === mediaIndex) || items[mediaIndex];
    if (!item) {
      throw new BusinessError('NOT_FOUND', 'Medya parçası bulunamadı.', 404);
    }

    const cachedList = Array.isArray(row.mediaCached) ? (row.mediaCached as unknown as MediaCachedMeta[]) : [];
    const existing = cachedList.find(c => c && c.index === mediaIndex);
    if (existing) {
      const url = await presignReadUrl(existing);
      if (!url) {
        throw new BusinessError('INTERNAL_ERROR', 'İmzalı URL oluşturulamadı.', 500);
      }
      return res.status(200).json({
        url,
        mimeType: item.mimeType,
        type: item.type,
        caption: item.caption || null,
        isVoice: !!item.isVoice,
      });
    }

    // Lazy fetch. Coalesce so two simultaneous requests don't double-fetch.
    const cached = await coalesce(coalesceKey(messageId, mediaIndex), async () => {
      const token = await resolveMetaTokenForChannel(salonId, row.channel);
      if (!token) {
        throw new BusinessError('PRECONDITION_FAILED', 'Meta token yok.', 412);
      }

      let downloaded: { buffer: Buffer; mimeType: string; sizeBytes: number };
      if (row.channel === 'WHATSAPP') {
        if (!item.providerMediaId) {
          throw new BusinessError('GONE', 'Medya kimliği yok.', 410);
        }
        downloaded = await fetchWhatsAppMedia({
          mediaId: item.providerMediaId,
          token,
        });
      } else if (row.channel === 'INSTAGRAM') {
        if (!item.providerMediaUrl) {
          throw new BusinessError('GONE', 'Medya URL yok.', 410);
        }
        downloaded = await fetchInstagramMedia({
          url: item.providerMediaUrl,
          token,
        });
      } else {
        throw new BusinessError('VALIDATION_FAILED', 'Desteklenmeyen kanal.', 400);
      }

      const kind = classifyMediaKind(item.type);
      if (!kind) {
        throw new BusinessError('VALIDATION_FAILED', 'Desteklenmeyen medya türü.', 400);
      }
      if (downloaded.sizeBytes > MEDIA_LIMITS[kind]) {
        throw new BusinessError('PAYLOAD_TOO_LARGE', 'Medya boyutu sınırı aşıyor.', 413);
      }

      const saved = await putToR2({
        salonId,
        channel: row.channel,
        conversationKey: row.conversationKey,
        messageId,
        mediaIndex,
        mimeType: downloaded.mimeType || item.mimeType || 'application/octet-stream',
        kind,
        buffer: downloaded.buffer,
      });
      if (!saved) {
        throw new BusinessError('INTERNAL_ERROR', 'R2 yazma başarısız.', 500);
      }
      await persistMediaCached({
        messageId,
        newEntries: [saved],
      });
      return saved;
    });

    if (!cached) {
      throw new BusinessError('INTERNAL_ERROR', 'Cache yazılamadı.', 500);
    }
    const url = await presignReadUrl(cached);
    if (!url) {
      throw new BusinessError('INTERNAL_ERROR', 'İmzalı URL oluşturulamadı.', 500);
    }

    return res.status(200).json({
      url,
      mimeType: item.mimeType,
      type: item.type,
      caption: item.caption || null,
      isVoice: !!item.isVoice,
    });
  },
);

export default router;
