// Background removal via Replicate (cjwbw/rembg, ~3sec on T4).
//
// Backend uploads the original image to R2 first, then asks Replicate to
// process the public URL. We poll the prediction with the `Prefer: wait=60`
// header so the call returns synchronously in most cases; fall back to short
// polling if Replicate keeps the request open longer than that.

import axios from 'axios';

const REPLICATE_TOKEN = (process.env.REPLICATE_API_TOKEN || '').trim();
// Pinned version hash for cjwbw/rembg — change here to upgrade.
const REPLICATE_BG_MODEL_VERSION =
  (process.env.REPLICATE_BG_MODEL_VERSION || '').trim() ||
  'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003';

const REPLICATE_BASE = 'https://api.replicate.com/v1';
const TOTAL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_500;

export class BackgroundRemovalError extends Error {
  public readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'BackgroundRemovalError';
    this.status = status;
  }
}

export function isBackgroundRemovalConfigured(): boolean {
  return Boolean(REPLICATE_TOKEN);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${REPLICATE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output: string | string[] | null;
  error: string | null;
  urls?: { get?: string; cancel?: string };
};

async function pollPrediction(getUrl: string, deadline: number): Promise<ReplicatePrediction> {
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await axios.get<ReplicatePrediction>(getUrl, {
      headers: authHeaders(),
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      throw new BackgroundRemovalError(
        `Replicate poll failed (status ${res.status}): ${JSON.stringify(res.data).slice(0, 200)}`,
        res.status,
      );
    }
    const data = res.data;
    if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'canceled') {
      return data;
    }
  }
  throw new BackgroundRemovalError('Replicate prediction timed out.');
}

export async function removeBackgroundFromUrl(imageUrl: string): Promise<Buffer> {
  if (!REPLICATE_TOKEN) {
    throw new BackgroundRemovalError('REPLICATE_API_TOKEN missing.');
  }

  const startedAt = Date.now();
  const deadline = startedAt + TOTAL_TIMEOUT_MS;

  // Kick off the prediction, asking Replicate to wait up to 60s before responding.
  const createRes = await axios.post<ReplicatePrediction>(
    `${REPLICATE_BASE}/predictions`,
    {
      version: REPLICATE_BG_MODEL_VERSION,
      input: { image: imageUrl },
    },
    {
      headers: {
        ...authHeaders(),
        Prefer: 'wait=60',
      },
      timeout: 70_000,
      validateStatus: () => true,
    },
  );

  if (createRes.status >= 400) {
    throw new BackgroundRemovalError(
      `Replicate create failed (status ${createRes.status}): ${JSON.stringify(createRes.data).slice(0, 300)}`,
      createRes.status,
    );
  }

  let prediction = createRes.data;
  if (prediction.status !== 'succeeded' && prediction.status !== 'failed' && prediction.status !== 'canceled') {
    const getUrl = prediction.urls?.get;
    if (!getUrl) {
      throw new BackgroundRemovalError('Replicate response missing urls.get for polling.');
    }
    prediction = await pollPrediction(getUrl, deadline);
  }

  if (prediction.status !== 'succeeded') {
    throw new BackgroundRemovalError(
      prediction.error || `Replicate prediction status: ${prediction.status}`,
    );
  }

  const output = prediction.output;
  const outputUrl = typeof output === 'string' ? output : Array.isArray(output) ? output[0] : null;
  if (!outputUrl) {
    throw new BackgroundRemovalError('Replicate prediction had no output URL.');
  }

  const fileRes = await axios.get<ArrayBuffer>(outputUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (fileRes.status >= 400) {
    throw new BackgroundRemovalError(
      `Replicate output download failed (status ${fileRes.status}).`,
      fileRes.status,
    );
  }
  const buffer = Buffer.from(fileRes.data);
  if (!buffer.length) {
    throw new BackgroundRemovalError('Replicate output download returned empty body.');
  }
  return buffer;
}
