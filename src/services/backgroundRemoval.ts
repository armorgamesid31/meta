// Background removal via HuggingFace Inference API.
// Model: briaai/RMBG-1.4 — accepts an image blob, returns a transparent PNG.
// Free tier covers low-volume usage (a few logo uploads per salon).

import axios from 'axios';

const HF_TOKEN = (process.env.HUGGINGFACE_API_TOKEN || '').trim();
const HF_MODEL = (process.env.HUGGINGFACE_BG_REMOVAL_MODEL || 'briaai/RMBG-1.4').trim();
const HF_ENDPOINT = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

const HF_TIMEOUT_MS = 60_000;

export class BackgroundRemovalError extends Error {
  public readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'BackgroundRemovalError';
    this.status = status;
  }
}

export function isBackgroundRemovalConfigured(): boolean {
  return Boolean(HF_TOKEN);
}

export async function removeBackground(input: Buffer, contentType = 'application/octet-stream'): Promise<Buffer> {
  if (!HF_TOKEN) {
    throw new BackgroundRemovalError('HUGGINGFACE_API_TOKEN missing.');
  }

  try {
    const response = await axios.post<ArrayBuffer>(HF_ENDPOINT, input, {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': contentType,
        Accept: 'image/png',
      },
      responseType: 'arraybuffer',
      timeout: HF_TIMEOUT_MS,
      validateStatus: (status) => status < 500,
    });

    const status = response.status;
    const buffer = Buffer.from(response.data);

    if (status >= 400) {
      // HuggingFace returns JSON error bodies even for arraybuffer responses.
      const text = (() => {
        try {
          return buffer.toString('utf8').slice(0, 500);
        } catch {
          return '<unreadable>';
        }
      })();
      throw new BackgroundRemovalError(`HF inference failed (status ${status}): ${text}`, status);
    }

    if (!buffer.length) {
      throw new BackgroundRemovalError('HF inference returned empty body.');
    }

    return buffer;
  } catch (err: any) {
    if (err instanceof BackgroundRemovalError) throw err;
    throw new BackgroundRemovalError(err?.message || 'background_removal_failed');
  }
}
