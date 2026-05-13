// Salon gallery image service helpers.
//
// Centralizes R2 path conventions, mime/extension mapping, and the
// best-effort delete logic so the route layer (src/routes/gallery.ts)
// stays focused on HTTP concerns.

import { randomUUID } from 'node:crypto';
import {
  buildR2PublicUrl,
  deleteR2Object,
  uploadBufferToR2,
} from '../lib/r2.js';

export const MAX_GALLERY_BYTES = 5 * 1024 * 1024;

// Frontend constraint mirrors this set. Keep image/jpg as an alias.
export const GALLERY_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export const GALLERY_PREFIX = 'salons';

export function isGalleryMimeAllowed(mime: string | undefined | null): boolean {
  if (!mime) return false;
  return GALLERY_ALLOWED_MIME.has(mime.toLowerCase());
}

export function pickGalleryContentType(rawMime: string | undefined | null): string {
  const ct = (rawMime || '').toLowerCase();
  if (ct === 'image/jpg') return 'image/jpeg';
  if (ct === 'image/jpeg' || ct === 'image/png' || ct === 'image/webp') return ct;
  // Caller is expected to have validated already; default to png as a
  // safe fallback rather than blocking the upload here.
  return 'image/png';
}

export function inferGalleryExtension(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
}

export function buildGalleryObjectKey(salonId: number, extension: string): string {
  return `${GALLERY_PREFIX}/${salonId}/gallery/${randomUUID()}.${extension}`;
}

export type UploadGalleryInput = {
  salonId: number;
  buffer: Buffer;
  contentType: string;
};

export type UploadGalleryResult = {
  imageUrl: string;
  objectKey: string;
};

export async function uploadGalleryImage(input: UploadGalleryInput): Promise<UploadGalleryResult> {
  const extension = inferGalleryExtension(input.contentType);
  const objectKey = buildGalleryObjectKey(input.salonId, extension);
  const imageUrl = await uploadBufferToR2({
    objectKey,
    body: input.buffer,
    contentType: input.contentType,
  });
  return { imageUrl, objectKey };
}

// Reverses buildR2PublicUrl() — given an image URL produced by this
// service (or anything that lives on the same bucket), pull out the
// object key so we can DELETE it. Returns null if the URL doesn't
// look like one of our R2 objects.
//
// Accepts both forms produced by buildR2PublicUrl():
//   1. <IMPORTS_PUBLIC_BASE_URL>/<key>
//   2. <IMPORTS_R2_ENDPOINT>/<bucket>/<key>
//
// We don't know which form a given record uses (and the env may have
// changed since insert), so we just take the path and best-effort
// strip a leading bucket segment if it matches the configured bucket.
export function extractR2ObjectKey(imageUrl: string, bucketName?: string): string | null {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  try {
    const parsed = new URL(imageUrl);
    let key = parsed.pathname.replace(/^\/+/, '');
    if (bucketName && key.startsWith(`${bucketName}/`)) {
      key = key.slice(bucketName.length + 1);
    }
    return key || null;
  } catch {
    return null;
  }
}

// Best-effort delete — failures are swallowed (matches deleteR2Object
// in lib/r2.ts which already warns on its own).
export async function deleteGalleryObjectByUrl(imageUrl: string, bucketName?: string): Promise<void> {
  const key = extractR2ObjectKey(imageUrl, bucketName);
  if (!key) return;
  await deleteR2Object(key);
}
