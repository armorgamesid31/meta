// Background removal via Pixian.ai.
//
// Per-logo cost ~$0.0045 (about 0.23 credits) on the smallest credit pack
// and drops further on larger packs. Quality matches PhotoRoom on logos
// while being ~4x cheaper.
//
// Auth uses HTTP Basic with API Id as username and API Secret as password.
// We send the buffer straight as the multipart `image` field — no base64
// roundtrip needed.

import axios from 'axios';

const PIXIAN_ID = (process.env.PIXIAN_API_ID || '').trim();
const PIXIAN_SECRET = (process.env.PIXIAN_API_SECRET || '').trim();
const PIXIAN_TEST_MODE =
  (process.env.PIXIAN_TEST_MODE || '').trim().toLowerCase() === 'true';
const PIXIAN_ENDPOINT = 'https://api.pixian.ai/api/v2/remove-background';
const PIXIAN_TIMEOUT_MS = 60_000;

export class BackgroundRemovalError extends Error {
  public readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'BackgroundRemovalError';
    this.status = status;
  }
}

export function isBackgroundRemovalConfigured(): boolean {
  return Boolean(PIXIAN_ID && PIXIAN_SECRET);
}

export async function removeBackground(input: Buffer): Promise<Buffer> {
  if (!PIXIAN_ID || !PIXIAN_SECRET) {
    throw new BackgroundRemovalError('Pixian credentials missing (PIXIAN_API_ID/PIXIAN_API_SECRET).');
  }

  const form = new FormData();
  // Wrap the Buffer in a Blob; undici/global FormData accepts that.
  form.append('image', new Blob([new Uint8Array(input)]), 'logo');
  if (PIXIAN_TEST_MODE) {
    form.append('test', 'true');
  }

  const response = await axios.post<ArrayBuffer>(PIXIAN_ENDPOINT, form, {
    auth: {
      username: PIXIAN_ID,
      password: PIXIAN_SECRET,
    },
    responseType: 'arraybuffer',
    timeout: PIXIAN_TIMEOUT_MS,
    maxBodyLength: 50 * 1024 * 1024,
    maxContentLength: 50 * 1024 * 1024,
    validateStatus: () => true,
    // Let axios set the multipart boundary automatically for FormData.
  });

  if (response.status >= 400) {
    const body = Buffer.from(response.data).toString('utf8').slice(0, 500);
    throw new BackgroundRemovalError(
      `Pixian error (${response.status}): ${body}`,
      response.status,
    );
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) {
    throw new BackgroundRemovalError('Pixian returned empty body.');
  }
  return buffer;
}
