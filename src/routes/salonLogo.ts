// Salon logo upload + background removal (Replicate).
//
// Flow:
//  1) POST /api/admin/salon-logo/process  (multipart, file)
//     - upload original to R2
//     - call Replicate (cjwbw/rembg) using the public original URL
//     - upload processed PNG to R2
//     - sign HMAC tokens, return both URLs + tokens
//
//  2) POST /api/admin/salon-logo/approve { processedKey, token, expiresAt, originalKey?, originalToken? }
//     - verify token, write salon.logoUrl, delete original from R2
//
//  3) POST /api/admin/salon-logo/reject   { processedKey?, originalKey?, tokens, expiresAt }
//     - verify tokens, delete both R2 objects
//
// State is HMAC-signed, no Redis needed.

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createHmac, randomBytes } from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import {
  buildR2PublicUrl,
  deleteR2Object,
  isR2Configured,
  uploadBufferToR2,
} from '../lib/r2.js';
import {
  isBackgroundRemovalConfigured,
  removeBackgroundFromUrl,
} from '../services/backgroundRemoval.js';

const router = Router();

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const APPROVAL_TTL_MS = 60 * 60 * 1000;
const LOGO_PREFIX = 'avatars/logos';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
});

const HMAC_SECRET = (() => {
  const candidate =
    process.env.LOGO_APPROVAL_HMAC_SECRET ||
    process.env.INTERNAL_API_KEY ||
    process.env.JWT_SECRET ||
    '';
  return candidate.trim();
})();

function ensureSecret(): string {
  if (!HMAC_SECRET) {
    throw new BusinessError(
      'INTERNAL_ERROR',
      'Logo approval secret is not configured.',
      500,
    );
  }
  return HMAC_SECRET;
}

function signToken(payload: { salonId: number; key: string; expiresAt: number }): string {
  const data = `${payload.salonId}|${payload.key}|${payload.expiresAt}`;
  return createHmac('sha256', ensureSecret()).update(data).digest('hex');
}

function verifyToken(payload: { salonId: number; key: string; expiresAt: number; token: string }): boolean {
  if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) return false;
  const expected = signToken({
    salonId: payload.salonId,
    key: payload.key,
    expiresAt: payload.expiresAt,
  });
  if (expected.length !== payload.token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ payload.token.charCodeAt(i);
  }
  return diff === 0;
}

function pickContentType(file: Express.Multer.File): string {
  const ct = (file.mimetype || '').toLowerCase();
  if (ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/webp') {
    return ct === 'image/jpg' ? 'image/jpeg' : ct;
  }
  return 'image/png';
}

function inferExtension(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

function buildObjectKey(salonId: number, kind: 'original' | 'processed', extension: string): string {
  const random = randomBytes(6).toString('hex');
  const ts = Date.now();
  return `${LOGO_PREFIX}/${salonId}/${kind}-${ts}-${random}.${extension}`;
}

function getSalonId(req: Request): number {
  const salonId = (req as any)?.user?.salonId;
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  return salonId;
}

router.post(
  '/process',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response) => {
    const salonId = getSalonId(req);

    if (!isR2Configured()) {
      throw new BusinessError('STORAGE_NOT_CONFIGURED', 'Logo storage is not available right now.', 503);
    }
    if (!isBackgroundRemovalConfigured()) {
      throw new BusinessError('BG_REMOVAL_NOT_CONFIGURED', 'Logo background removal is not configured.', 503);
    }

    const file = req.file;
    if (!file) {
      throw new BusinessError('VALIDATION_FAILED', 'No logo file provided.', 400);
    }
    if (!file.buffer?.length) {
      throw new BusinessError('VALIDATION_FAILED', 'Logo file is empty.', 400);
    }

    const sourceContentType = pickContentType(file);
    const originalExt = inferExtension(sourceContentType);
    const originalKey = buildObjectKey(salonId, 'original', originalExt);
    const originalUrl = await uploadBufferToR2({
      objectKey: originalKey,
      body: file.buffer,
      contentType: sourceContentType,
    });

    let processedBuffer: Buffer;
    try {
      processedBuffer = await removeBackgroundFromUrl(originalUrl);
    } catch (err: any) {
      await deleteR2Object(originalKey);
      console.error('Logo bg removal failed:', err?.message || err);
      throw new BusinessError(
        'BG_REMOVAL_FAILED',
        'Logo arka planı kaldırılamadı. Lütfen tekrar deneyin.',
        502,
      );
    }

    const processedKey = buildObjectKey(salonId, 'processed', 'png');
    const processedUrl = await uploadBufferToR2({
      objectKey: processedKey,
      body: processedBuffer,
      contentType: 'image/png',
    });

    const expiresAt = Date.now() + APPROVAL_TTL_MS;
    const token = signToken({ salonId, key: processedKey, expiresAt });
    const originalToken = signToken({ salonId, key: originalKey, expiresAt });

    res.status(200).json({
      originalUrl,
      processedUrl,
      originalKey,
      processedKey,
      token,
      originalToken,
      expiresAt,
    });
  },
);

router.post('/approve', authenticateToken, async (req: Request, res: Response) => {
  const salonId = getSalonId(req);

  const processedKey = String(req.body?.processedKey || '').trim();
  const token = String(req.body?.token || '').trim();
  const expiresAt = Number(req.body?.expiresAt);
  const originalKey = typeof req.body?.originalKey === 'string' ? req.body.originalKey.trim() : '';
  const originalToken = typeof req.body?.originalToken === 'string' ? req.body.originalToken.trim() : '';

  if (!processedKey || !token || !Number.isFinite(expiresAt)) {
    throw new BusinessError('VALIDATION_FAILED', 'Missing processedKey/token/expiresAt.', 400);
  }
  if (!verifyToken({ salonId, key: processedKey, expiresAt, token })) {
    throw new BusinessError('INVALID_TOKEN', 'Logo approval token is invalid or expired.', 400);
  }

  const publicUrl = buildR2PublicUrl(processedKey);

  const existing = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { logoUrl: true },
  });

  await prisma.salon.update({
    where: { id: salonId },
    data: { logoUrl: publicUrl },
  });

  if (originalKey && originalToken && verifyToken({ salonId, key: originalKey, expiresAt, token: originalToken })) {
    await deleteR2Object(originalKey);
  }

  if (existing?.logoUrl) {
    try {
      const parsed = new URL(existing.logoUrl);
      const prevKey = parsed.pathname.replace(/^\/+/, '');
      if (prevKey.startsWith(LOGO_PREFIX) && prevKey !== processedKey) {
        await deleteR2Object(prevKey);
      }
    } catch {
      // ignore — old URL may not parse
    }
  }

  res.status(200).json({ ok: true, logoUrl: publicUrl });
});

router.post('/reject', authenticateToken, async (req: Request, res: Response) => {
  const salonId = getSalonId(req);

  const processedKey = typeof req.body?.processedKey === 'string' ? req.body.processedKey.trim() : '';
  const originalKey = typeof req.body?.originalKey === 'string' ? req.body.originalKey.trim() : '';
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const originalToken = typeof req.body?.originalToken === 'string' ? req.body.originalToken.trim() : '';
  const expiresAt = Number(req.body?.expiresAt);

  if (!Number.isFinite(expiresAt)) {
    throw new BusinessError('VALIDATION_FAILED', 'Missing expiresAt.', 400);
  }

  if (processedKey && token && verifyToken({ salonId, key: processedKey, expiresAt, token })) {
    await deleteR2Object(processedKey);
  }
  if (originalKey && originalToken && verifyToken({ salonId, key: originalKey, expiresAt, token: originalToken })) {
    await deleteR2Object(originalKey);
  }

  res.status(200).json({ ok: true });
});

export default router;

export function logoErrorHandler(err: any, _req: Request, res: Response, next: any) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      code: 'FILE_TOO_LARGE',
      message: `Logo dosyası çok büyük (en fazla ${Math.floor(MAX_LOGO_BYTES / (1024 * 1024))}MB).`,
    });
  }
  return next(err);
}
