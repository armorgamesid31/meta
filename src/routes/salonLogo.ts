// Salon logo upload.
//
// Browser already runs the background removal (via @imgly/background-removal)
// before sending the file. This endpoint only:
//   1) validates the uploaded PNG,
//   2) writes it to R2 under avatars/logos/<salonId>/...,
//   3) updates salon.logoUrl,
//   4) best-effort deletes the previously stored logo from R2.

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import {
  buildR2PublicUrl,
  deleteR2Object,
  isR2Configured,
  uploadBufferToR2,
} from '../lib/r2.js';

const router = Router();

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_PREFIX = 'avatars/logos';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
});

function buildObjectKey(salonId: number): string {
  const random = randomBytes(6).toString('hex');
  const ts = Date.now();
  return `${LOGO_PREFIX}/${salonId}/logo-${ts}-${random}.png`;
}

function getSalonId(req: Request): number {
  const salonId = (req as any)?.user?.salonId;
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  return salonId;
}

function extractR2KeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '');
    if (!path.startsWith(LOGO_PREFIX)) return null;
    return path;
  } catch {
    return null;
  }
}

router.post(
  '/upload',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response) => {
    const salonId = getSalonId(req);

    if (!isR2Configured()) {
      throw new BusinessError(
        'STORAGE_NOT_CONFIGURED',
        'Logo storage is not available right now.',
        503,
      );
    }

    const file = req.file;
    if (!file) {
      throw new BusinessError('VALIDATION_FAILED', 'No logo file provided.', 400);
    }
    if (!file.buffer?.length) {
      throw new BusinessError('VALIDATION_FAILED', 'Logo file is empty.', 400);
    }

    const incomingContentType = (file.mimetype || '').toLowerCase();
    if (incomingContentType && incomingContentType !== 'image/png') {
      throw new BusinessError(
        'VALIDATION_FAILED',
        'Logo must be a transparent PNG.',
        400,
      );
    }

    const objectKey = buildObjectKey(salonId);
    const publicUrl = await uploadBufferToR2({
      objectKey,
      body: file.buffer,
      contentType: 'image/png',
    });

    const existing = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { logoUrl: true },
    });

    await prisma.salon.update({
      where: { id: salonId },
      data: { logoUrl: publicUrl },
    });

    // Clean up the previous logo if it lives in our R2 prefix.
    if (existing?.logoUrl) {
      const prevKey = extractR2KeyFromUrl(existing.logoUrl);
      if (prevKey && prevKey !== objectKey) {
        await deleteR2Object(prevKey);
      }
    }

    res.status(200).json({ ok: true, logoUrl: publicUrl, objectKey });
  },
);

export default router;

// Multer'ın boyut/MIME hatalarını anlamlı koda dönüştürür.
export function logoErrorHandler(err: any, _req: Request, res: Response, next: any) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      code: 'FILE_TOO_LARGE',
      message: `Logo dosyası çok büyük (en fazla ${Math.floor(MAX_LOGO_BYTES / (1024 * 1024))}MB).`,
    });
  }
  return next(err);
}
