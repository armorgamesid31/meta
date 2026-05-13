// Salon gallery management endpoints.
//
// Mounted at /api/admin/gallery in src/server.ts. These replace the
// "ship the whole gallery in JSON" flow that previously lived under
// PUT /api/admin/website/content — that endpoint still works for
// backwards compatibility, but new clients should:
//
//   POST   /api/admin/gallery/upload    multipart file -> R2 + DB row
//   PATCH  /api/admin/gallery/reorder   { ids } -> updates displayOrder
//   DELETE /api/admin/gallery/:id       removes row + best-effort R2 delete
//
// Auth is required on every route. Salon scope is taken from the
// authenticated user (req.user.salonId) — clients cannot target a
// different salon.

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth.js';
import { BusinessError } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import { isR2Configured, r2BucketName } from '../lib/r2.js';
import {
  GALLERY_ALLOWED_MIME,
  MAX_GALLERY_BYTES,
  deleteGalleryObjectByUrl,
  isGalleryMimeAllowed,
  pickGalleryContentType,
  uploadGalleryImage,
} from '../services/galleryService.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_GALLERY_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isGalleryMimeAllowed(file.mimetype)) {
      cb(null, true);
    } else {
      // Tag with a known code so the error handler can convert this
      // into a 400 with a useful message rather than a generic 500.
      const err: any = new Error('UNSUPPORTED_MIME');
      err.code = 'UNSUPPORTED_MIME';
      cb(err);
    }
  },
});

function getSalonId(req: Request): number {
  const salonId = (req as any)?.user?.salonId;
  if (!Number.isInteger(salonId) || salonId <= 0) {
    throw new BusinessError('UNAUTHORIZED', 'Unauthorized.', 401);
  }
  return salonId;
}

function parseOptionalCategoryId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BusinessError('VALIDATION_FAILED', 'categoryId must be a positive integer.', 400);
  }
  return n;
}

function parseOptionalAltText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BusinessError('VALIDATION_FAILED', 'altText must be a string.', 400);
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
}

// POST /api/admin/gallery/upload
//
// Multipart: file (required, <= 5MB, image/jpeg | image/png | image/webp)
// Body: altText? (string), categoryId? (positive integer)
//
// Flow: upload buffer to R2 -> create SalonGalleryImage row with
// displayOrder = max(currentOrder) + 1 so the new image lands at the
// end of the gallery.
router.post(
  '/upload',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response) => {
    const salonId = getSalonId(req);

    if (!isR2Configured()) {
      throw new BusinessError(
        'STORAGE_NOT_CONFIGURED',
        'Gallery storage is not available right now.',
        503,
      );
    }

    const file = req.file;
    if (!file) {
      throw new BusinessError('VALIDATION_FAILED', 'No image file provided.', 400);
    }
    if (!file.buffer?.length) {
      throw new BusinessError('VALIDATION_FAILED', 'Image file is empty.', 400);
    }
    // Multer fileFilter has already gated this, but a defensive
    // recheck protects against accidental config drift.
    if (!isGalleryMimeAllowed(file.mimetype)) {
      throw new BusinessError(
        'VALIDATION_FAILED',
        `Unsupported image type. Allowed: ${Array.from(GALLERY_ALLOWED_MIME).join(', ')}.`,
        400,
      );
    }

    const altText = parseOptionalAltText(req.body?.altText);
    const categoryId = parseOptionalCategoryId(req.body?.categoryId);

    // Validate the categoryId belongs to this salon's tenant scope.
    // ServiceCategory is shared across salons, so we don't enforce
    // ownership here, but we do verify it exists.
    if (categoryId !== null) {
      const exists = await prisma.serviceCategory.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      if (!exists) {
        throw new BusinessError('VALIDATION_FAILED', 'categoryId not found.', 400);
      }
    }

    const contentType = pickGalleryContentType(file.mimetype);

    let uploadResult: { imageUrl: string; objectKey: string };
    try {
      uploadResult = await uploadGalleryImage({
        salonId,
        buffer: file.buffer,
        contentType,
      });
    } catch (err: any) {
      console.error('Gallery R2 upload failed:', err?.message || err);
      throw new BusinessError(
        'STORAGE_UPLOAD_FAILED',
        'Galeri görseli yüklenemedi. Lütfen tekrar deneyin.',
        500,
      );
    }

    // displayOrder = max(currentOrder) + 1 so new uploads append. Done
    // inside a transaction with the create so two parallel uploads
    // can't race to the same order value — though even if they do, the
    // (displayOrder asc, id asc) sort in list reads is still stable.
    const created = await prisma.$transaction(async (tx) => {
      const top = await tx.salonGalleryImage.findFirst({
        where: { salonId },
        orderBy: [{ displayOrder: 'desc' }, { id: 'desc' }],
        select: { displayOrder: true },
      });
      const nextOrder = (top?.displayOrder ?? -1) + 1;
      return tx.salonGalleryImage.create({
        data: {
          salonId,
          imageUrl: uploadResult.imageUrl,
          altText,
          categoryId,
          displayOrder: nextOrder,
        },
        select: {
          id: true,
          imageUrl: true,
          altText: true,
          displayOrder: true,
          categoryId: true,
        },
      });
    });

    return res.status(201).json({ image: created });
  },
);

// PATCH /api/admin/gallery/reorder
//
// Body: { ids: number[] }  — new visual order, position 0 is first.
//
// Validation:
//   - ids must be a non-empty array of positive integers
//   - every id must belong to this salon (404 otherwise)
//
// Partial reorder is allowed: only the listed ids get their
// displayOrder rewritten (to 0..N-1). Anything not listed keeps its
// existing value. Frontend drag-drop typically sends the full list so
// this edge case rarely matters, but it lets us avoid wiping ordering
// on a half-broken client request.
router.patch(
  '/reorder',
  authenticateToken,
  async (req: Request, res: Response) => {
    const salonId = getSalonId(req);

    const rawIds = (req.body && req.body.ids) as unknown;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new BusinessError('VALIDATION_FAILED', 'ids must be a non-empty array.', 400);
    }
    const ids: number[] = [];
    for (const value of rawIds) {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        throw new BusinessError('VALIDATION_FAILED', 'ids must contain positive integers.', 400);
      }
      ids.push(n);
    }
    // Reject duplicates — they'd produce undefined ordering.
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new BusinessError('VALIDATION_FAILED', 'ids must not contain duplicates.', 400);
    }

    // Ownership check: pull every id at once, ensure (a) all exist and
    // (b) all belong to this salon. One round-trip beats N point reads.
    const owned = await prisma.salonGalleryImage.findMany({
      where: { id: { in: ids }, salonId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new BusinessError(
        'NOT_FOUND',
        'One or more gallery image ids do not belong to this salon.',
        404,
      );
    }

    // Apply new orders inside a single transaction. We use update()
    // per id (rather than updateMany) because each row gets a
    // different displayOrder.
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.salonGalleryImage.update({
          where: { id },
          data: { displayOrder: index },
        }),
      ),
    );

    const items = await prisma.salonGalleryImage.findMany({
      where: { salonId },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        imageUrl: true,
        altText: true,
        displayOrder: true,
        categoryId: true,
      },
    });

    return res.status(200).json({ success: true, items });
  },
);

// DELETE /api/admin/gallery/:id
//
// Verifies salon ownership, deletes the DB row, then attempts (best
// effort) to remove the underlying R2 object. If the R2 delete fails
// the DB row is already gone — orphaned blobs are preferred over
// dangling DB references.
router.delete(
  '/:id',
  authenticateToken,
  async (req: Request, res: Response) => {
    const salonId = getSalonId(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessError('VALIDATION_FAILED', 'Invalid gallery image id.', 400);
    }

    const existing = await prisma.salonGalleryImage.findFirst({
      where: { id, salonId },
      select: { id: true, imageUrl: true },
    });
    if (!existing) {
      throw new BusinessError('NOT_FOUND', 'Gallery image not found.', 404);
    }

    await prisma.salonGalleryImage.delete({ where: { id } });

    // Best effort — log but don't fail the request if R2 hiccups.
    try {
      await deleteGalleryObjectByUrl(existing.imageUrl, r2BucketName());
    } catch (err: any) {
      console.warn('Gallery R2 delete failed (row already removed):', err?.message || err);
    }

    return res.status(200).json({ success: true });
  },
);

export default router;

// Multer surfaces upload-stage failures (size limit, file filter) as
// errors with a `code` property. We translate them here so callers see
// our standard { code, message } envelope instead of a generic 500.
export function galleryErrorHandler(err: any, _req: Request, res: Response, next: any) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      code: 'FILE_TOO_LARGE',
      message: `Görsel çok büyük (en fazla ${Math.floor(MAX_GALLERY_BYTES / (1024 * 1024))}MB).`,
    });
  }
  if (err && err.code === 'UNSUPPORTED_MIME') {
    return res.status(400).json({
      code: 'VALIDATION_FAILED',
      message: 'Sadece JPEG, PNG veya WebP görseller yüklenebilir.',
    });
  }
  return next(err);
}
