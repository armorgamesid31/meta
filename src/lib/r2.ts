// Generic R2 (S3-compatible) helper. Shares the IMPORTS_R2_* env block with
// the existing avatar/import code so we don't multiply credentials. Use
// uploadBuffer() for any new R2 write path.

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const R2_ENABLED = (process.env.IMPORTS_R2_ENABLED || '').trim().toLowerCase() === 'true';
const R2_BUCKET = (process.env.IMPORTS_R2_BUCKET || '').trim();
const R2_ENDPOINT = (process.env.IMPORTS_R2_ENDPOINT || '').trim();
const R2_ACCESS_KEY_ID = (process.env.IMPORTS_R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.IMPORTS_R2_SECRET_ACCESS_KEY || '').trim();
const R2_REGION = (process.env.IMPORTS_R2_REGION || 'auto').trim();
const R2_PUBLIC_BASE_URL = (process.env.IMPORTS_PUBLIC_BASE_URL || process.env.IMPORTS_R2_PUBLIC_BASE_URL || '').trim();
const R2_FORCE_PATH_STYLE = (process.env.IMPORTS_R2_FORCE_PATH_STYLE || 'true').trim().toLowerCase() !== 'false';

let clientSingleton: S3Client | null | undefined;

export function isR2Configured(): boolean {
  return Boolean(R2_ENABLED && R2_BUCKET && R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

export function getR2Client(): S3Client | null {
  if (!isR2Configured()) return null;
  if (clientSingleton !== undefined) return clientSingleton;
  clientSingleton = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    forcePathStyle: R2_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return clientSingleton;
}

export function r2BucketName(): string {
  return R2_BUCKET;
}

export function buildR2PublicUrl(objectKey: string): string {
  if (R2_PUBLIC_BASE_URL) {
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${objectKey}`;
  }
  return `${R2_ENDPOINT.replace(/\/+$/, '')}/${R2_BUCKET}/${objectKey}`;
}

export type UploadInput = {
  objectKey: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
};

export async function uploadBufferToR2(input: UploadInput): Promise<string> {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 not configured.');
  }
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: input.cacheControl || 'public, max-age=86400',
    }),
  );
  return buildR2PublicUrl(input.objectKey);
}

export async function deleteR2Object(objectKey: string): Promise<void> {
  const client = getR2Client();
  if (!client) return;
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: objectKey,
      }),
    );
  } catch (err: any) {
    console.warn('R2 delete failed:', objectKey, err?.message || err);
  }
}
