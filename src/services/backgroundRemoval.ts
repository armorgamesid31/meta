// Background removal via remove.bg.
//
// Professional-grade BG removal with crisp edges and proper interior alpha
// — matches the quality Canva/Photoshop give in their UIs. Free tier covers
// 50 calls/month; beyond that it's $0.20/img (prepaid credit packs).
//
// We pass the original's public R2 URL straight to remove.bg as image_url,
// so the salon's PNG never needs to be base64-encoded or re-uploaded.

import axios from 'axios';

const REMOVEBG_TOKEN = (process.env.REMOVEBG_API_KEY || '').trim();
const REMOVEBG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg';
const REMOVEBG_TIMEOUT_MS = 60_000;

export class BackgroundRemovalError extends Error {
  public readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'BackgroundRemovalError';
    this.status = status;
  }
}

export function isBackgroundRemovalConfigured(): boolean {
  return Boolean(REMOVEBG_TOKEN);
}

export async function removeBackgroundFromUrl(imageUrl: string): Promise<Buffer> {
  if (!REMOVEBG_TOKEN) {
    throw new BackgroundRemovalError('REMOVEBG_API_KEY missing.');
  }

  const form = new FormData();
  form.set('image_url', imageUrl);
  form.set('size', 'auto');
  form.set('format', 'png');

  const response = await axios.post<ArrayBuffer>(REMOVEBG_ENDPOINT, form, {
    headers: {
      'X-Api-Key': REMOVEBG_TOKEN,
      Accept: 'image/png',
    },
    responseType: 'arraybuffer',
    timeout: REMOVEBG_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const body = Buffer.from(response.data).toString('utf8').slice(0, 500);
    throw new BackgroundRemovalError(
      `remove.bg error (${response.status}): ${body}`,
      response.status,
    );
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) {
    throw new BackgroundRemovalError('remove.bg returned empty body.');
  }
  return buffer;
}
