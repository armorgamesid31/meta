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
import multer from 'multer';
import { Prisma, ChannelType } from '@prisma/client';
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
  type MediaKind,
} from '../services/conversationMediaCache.js';
import {
  fetchWhatsAppMedia,
  fetchInstagramMedia,
} from '../services/conversationMediaProviders.js';
import { sendOutboundMedia } from '../services/conversationMediaSend.js';

const router = Router();

// Multer config: memory storage (we proxy to R2/Meta immediately, no disk
// touch needed). Hard limit at the largest of our per-kind limits.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB — header for any kind
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function parseChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  if (v === 'WHATSAPP' || v === 'INSTAGRAM') return v as ChannelType;
  return null;
}

function parseKind(value: unknown): MediaKind | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'image' || v === 'video' || v === 'audio') return v as MediaKind;
  return null;
}

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

// ─────────────────────────────────────────────────────────────────
// POST /conversations/:channel/:conversationKey/send-media
//
// Multipart body:
//   file:     <binary>           (required)
//   kind:     image|video|audio  (required)
//   caption:  string             (optional, audio ignores)
//   isVoice:  '1' for audio voice notes (PTT bubble)
//   recipient: E.164 digits (WhatsApp) or PSID (Instagram)
//
// Returns: { messageId, providerMessageId, mediaItem }
// ─────────────────────────────────────────────────────────────────
router.post(
  '/conversations/:channel/:conversationKey/send-media',
  authenticateToken,
  upload.single('file'),
  async (req: any, res: any) => {
    if (!isMediaCacheEnabled()) {
      throw new BusinessError(
        'PRECONDITION_FAILED',
        'Medya gönderimi yapılandırılmamış.',
        412,
      );
    }
    if (!req.user?.salonId) {
      throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
    }
    const salonId = req.user.salonId as number;
    const channel = parseChannel(req.params.channel);
    if (!channel) {
      throw new BusinessError('VALIDATION_FAILED', 'channel WHATSAPP veya INSTAGRAM olmalı.', 400);
    }
    const conversationKey = typeof req.params.conversationKey === 'string'
      ? req.params.conversationKey.trim()
      : '';
    if (!conversationKey) {
      throw new BusinessError('VALIDATION_FAILED', 'conversationKey gerekli.', 400);
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      throw new BusinessError('VALIDATION_FAILED', 'Dosya gerekli.', 400);
    }
    const kind = parseKind(req.body?.kind);
    if (!kind) {
      throw new BusinessError('VALIDATION_FAILED', 'kind image|video|audio olmalı.', 400);
    }
    if (file.size > MEDIA_LIMITS[kind]) {
      throw new BusinessError(
        'PAYLOAD_TOO_LARGE',
        `${kind} en fazla ${Math.round(MEDIA_LIMITS[kind] / 1024 / 1024)} MB olabilir.`,
        413,
      );
    }
    const recipient = typeof req.body?.recipient === 'string'
      ? req.body.recipient.trim()
      : '';
    if (!recipient) {
      throw new BusinessError('VALIDATION_FAILED', 'recipient gerekli.', 400);
    }
    const caption = typeof req.body?.caption === 'string'
      ? req.body.caption.trim().slice(0, 1024)
      : null;
    const isVoice = req.body?.isVoice === '1' || req.body?.isVoice === 'true';

    const senderUserId = Number.isInteger(Number(req.user?.userId))
      ? Number(req.user.userId)
      : null;
    const senderUserEmail = typeof req.user?.email === 'string' ? req.user.email : null;

    try {
      const result = await sendOutboundMedia({
        salonId,
        channel,
        conversationKey,
        recipientPhoneOrPsid: recipient,
        kind,
        mimeType: file.mimetype || 'application/octet-stream',
        buffer: file.buffer,
        caption,
        isVoice,
        senderUserId,
        senderUserEmail,
      });
      return res.status(200).json({
        ok: true,
        messageId: result.messageId,
        providerMessageId: result.providerMessageId,
        mediaItem: result.mediaItem,
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg === 'instagram_outbound_not_implemented') {
        throw new BusinessError(
          'NOT_IMPLEMENTED',
          'Instagram\'a medya gönderimi henüz desteklenmiyor.',
          501,
        );
      }
      if (msg === 'salon_whatsapp_not_connected') {
        throw new BusinessError(
          'PRECONDITION_FAILED',
          'WhatsApp bağlantısı eksik.',
          412,
        );
      }
      if (msg.startsWith('media_too_large')) {
        throw new BusinessError('PAYLOAD_TOO_LARGE', 'Boyut sınırını aşıyor.', 413);
      }
      console.error('[conversationMedia/send-media] failed:', err?.response?.data || err);
      throw new BusinessError('INTERNAL_ERROR', 'Medya gönderimi başarısız.', 500, {
        reason: msg,
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────
// POST /conversations/customer-data/delete
//
// KVKK/GDPR data deletion: removes all cached media for a given
// conversationKey from R2 and clears the DB pointers. Does NOT delete
// the message rows themselves — the salon may need the text history
// for legal/operational reasons; only the media bytes go away.
//
// Auth: same authenticateToken middleware. Caller must be a salon
// member; deletion is scoped to that salon's events.
// ─────────────────────────────────────────────────────────────────
router.post('/conversations/customer-data/delete', authenticateToken, async (req: any, res: any) => {
  if (!isMediaCacheEnabled()) {
    return res.status(200).json({ ok: true, deleted: 0, message: 'Cache not configured.' });
  }
  if (!req.user?.salonId) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  const salonId = req.user.salonId as number;

  const conversationKey = typeof req.body?.conversationKey === 'string'
    ? req.body.conversationKey.trim()
    : '';
  if (!conversationKey) {
    throw new BusinessError('VALIDATION_FAILED', 'conversationKey gerekli.', 400);
  }

  const { deleteFromR2 } = await import('../services/conversationMediaCache.js');

  const rows = await prisma.conversationMessageEvent.findMany({
    where: {
      salonId,
      conversationKey,
      NOT: { mediaCached: { equals: null as any } as any },
    },
    select: { id: true, mediaCached: true },
  });

  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    const cached = Array.isArray(row.mediaCached) ? (row.mediaCached as any[]) : [];
    for (const c of cached) {
      if (!c) continue;
      try {
        await deleteFromR2(c);
        deleted++;
      } catch (err) {
        console.error('[customer-data/delete] r2 delete failed:', err);
        failed++;
      }
    }
    await prisma.conversationMessageEvent.update({
      where: { id: row.id },
      data: { mediaCached: Prisma.JsonNull, mediaCachedAt: null },
    });
  }

  return res.status(200).json({
    ok: true,
    rowsTouched: rows.length,
    objectsDeleted: deleted,
    objectsFailed: failed,
  });
});

export default router;
