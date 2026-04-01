import crypto from 'crypto';
import { Router } from 'express';
import axios from 'axios';
import { ChannelType, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v23.0').trim();
const META_APP_ID = (process.env.META_APP_ID || '').trim();
const META_APP_SECRET = (process.env.META_APP_SECRET || '').trim();
const META_INSTAGRAM_APP_ID = (process.env.META_INSTAGRAM_APP_ID || '').trim();
const META_INSTAGRAM_APP_SECRET = (process.env.META_INSTAGRAM_APP_SECRET || '').trim();
const META_INSTAGRAM_EMBED_URL = (process.env.META_INSTAGRAM_EMBED_URL || '').trim();
const META_REDIRECT_URI = (process.env.META_REDIRECT_URI || '').trim();
const META_STATE_SECRET = (process.env.META_STATE_SECRET || process.env.JWT_SECRET || '').trim();
const META_WHATSAPP_CONFIG_ID = (process.env.META_WHATSAPP_CONFIG_ID || '').trim();
const META_INSTAGRAM_CONFIG_ID = (process.env.META_INSTAGRAM_CONFIG_ID || '').trim();

type MetaChannel = 'INSTAGRAM' | 'WHATSAPP';
type MetaStatus = 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'FAILED';
type MetaChannelKey = 'instagram' | 'whatsapp';
type ConnectMode = 'OAUTH' | 'EMBEDDED_SIGNUP';

interface MetaChannelState {
  status: MetaStatus;
  message: string;
  externalAccountId: string | null;
  externalBusinessId: string | null;
  externalDisplayName: string | null;
  accessToken: string | null;
  tokenType: string | null;
  expiresIn: number | null;
  lastConnectedAt: string | null;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  lastError: string | null;
}

interface MetaStore {
  instagram: MetaChannelState;
  whatsapp: MetaChannelState;
}

interface StatePayload {
  sid: number;
  ch: MetaChannel;
  ts: number;
  nonce: string;
}

interface PrefillConnection {
  externalAccountId?: string | null;
  externalBusinessId?: string | null;
  externalDisplayName?: string | null;
  bindingIds?: string[];
}

const defaultScopes: Record<MetaChannel, string[]> = {
  INSTAGRAM: [
    'instagram_business_basic',
    'instagram_business_manage_messages',
  ],
  WHATSAPP: [
    'whatsapp_business_management',
    'whatsapp_business_messaging',
  ],
};

function toMetaChannel(value: unknown): MetaChannel | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') {
    return normalized;
  }

  return null;
}

function toMetaKey(channel: MetaChannel): MetaChannelKey {
  return channel === 'INSTAGRAM' ? 'instagram' : 'whatsapp';
}

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

function defaultChannelState(): MetaChannelState {
  return {
    status: 'NOT_CONNECTED',
    message: 'Not connected.',
    externalAccountId: null,
    externalBusinessId: null,
    externalDisplayName: null,
    accessToken: null,
    tokenType: null,
    expiresIn: null,
    lastConnectedAt: null,
    lastProbeAt: null,
    lastProbeOk: null,
    lastError: null,
  };
}

function normalizeStore(input: unknown): MetaStore {
  const raw = asObject(input);

  const readChannel = (key: MetaChannelKey): MetaChannelState => {
    const base = defaultChannelState();
    const value = asObject(raw[key]);
    const status = typeof value.status === 'string' ? value.status.toUpperCase() : base.status;

    return {
      status:
        status === 'CONNECTING' || status === 'CONNECTED' || status === 'FAILED' || status === 'NOT_CONNECTED'
          ? (status as MetaStatus)
          : base.status,
      message: typeof value.message === 'string' ? value.message : base.message,
      externalAccountId: typeof value.externalAccountId === 'string' && value.externalAccountId.trim()
        ? value.externalAccountId.trim()
        : null,
      externalBusinessId: typeof value.externalBusinessId === 'string' && value.externalBusinessId.trim()
        ? value.externalBusinessId.trim()
        : null,
      externalDisplayName: typeof value.externalDisplayName === 'string' && value.externalDisplayName.trim()
        ? value.externalDisplayName.trim()
        : null,
      accessToken: typeof value.accessToken === 'string' && value.accessToken.trim()
        ? value.accessToken.trim()
        : null,
      tokenType: typeof value.tokenType === 'string' && value.tokenType.trim()
        ? value.tokenType.trim()
        : null,
      expiresIn: typeof value.expiresIn === 'number' ? value.expiresIn : null,
      lastConnectedAt: typeof value.lastConnectedAt === 'string' ? value.lastConnectedAt : null,
      lastProbeAt: typeof value.lastProbeAt === 'string' ? value.lastProbeAt : null,
      lastProbeOk: typeof value.lastProbeOk === 'boolean' ? value.lastProbeOk : null,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
    };
  };

  return {
    instagram: readChannel('instagram'),
    whatsapp: readChannel('whatsapp'),
  };
}

function encodeState(payload: StatePayload): string {
  if (!META_STATE_SECRET) {
    throw new Error('META_STATE_SECRET or JWT_SECRET must be configured.');
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', META_STATE_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeState(token: string): StatePayload | null {
  if (!META_STATE_SECRET || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }

  const [body, signature] = token.split('.', 2);
  if (!body || !signature) {
    return null;
  }

  const expected = crypto.createHmac('sha256', META_STATE_SECRET).update(body).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const channel = toMetaChannel(parsed?.ch);
    const salonId = Number(parsed?.sid);
    const timestamp = Number(parsed?.ts);

    if (!channel || !Number.isInteger(salonId) || salonId <= 0 || !Number.isFinite(timestamp)) {
      return null;
    }

    if (Date.now() - timestamp > 1000 * 60 * 15) {
      return null;
    }

    return {
      sid: salonId,
      ch: channel,
      ts: timestamp,
      nonce: typeof parsed?.nonce === 'string' ? parsed.nonce : '',
    };
  } catch {
    return null;
  }
}

function getScopes(channel: MetaChannel): string[] {
  const envKey = channel === 'INSTAGRAM' ? 'META_INSTAGRAM_SCOPES' : 'META_WHATSAPP_SCOPES';
  const raw = (process.env[envKey] || '').trim();
  if (!raw) {
    return defaultScopes[channel];
  }

  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : defaultScopes[channel];
}

function getClientId(channel: MetaChannel): string {
  if (channel === 'INSTAGRAM') {
    return META_INSTAGRAM_APP_ID || META_APP_ID;
  }
  return META_APP_ID;
}

function getClientSecret(channel: MetaChannel): string {
  if (channel === 'INSTAGRAM') {
    return META_INSTAGRAM_APP_SECRET || META_APP_SECRET;
  }
  return META_APP_SECRET;
}

function buildAuthorizeUrl(
  channel: MetaChannel,
  redirectUri: string,
  state: string,
  scopes: string[],
): string {
  const clientId = getClientId(channel);

  if (channel === 'INSTAGRAM') {
    if (META_INSTAGRAM_EMBED_URL) {
      try {
        const embedUrl = new URL(META_INSTAGRAM_EMBED_URL);
        if (!embedUrl.searchParams.get('client_id')) {
          embedUrl.searchParams.set('client_id', clientId);
        }
        embedUrl.searchParams.set('redirect_uri', redirectUri);
        embedUrl.searchParams.set('response_type', 'code');
        embedUrl.searchParams.set('state', state);

        const hasConfigId = Boolean(embedUrl.searchParams.get('config_id'));
        if (!hasConfigId && !embedUrl.searchParams.get('scope') && scopes.length > 0) {
          embedUrl.searchParams.set('scope', scopes.join(','));
        }

        return embedUrl.toString();
      } catch (error) {
        console.warn('META_INSTAGRAM_EMBED_URL is invalid, falling back to generated OAuth URL.');
      }
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
    });

    if (META_INSTAGRAM_CONFIG_ID) {
      params.set('config_id', META_INSTAGRAM_CONFIG_ID);
    } else if (scopes.length > 0) {
      params.set('scope', scopes.join(','));
    }

    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: scopes.join(','),
  });

  // Optional: Login for Business config-based flow (Embedded Signup compatible) for WhatsApp.
  if (META_WHATSAPP_CONFIG_ID) {
    params.set('config_id', META_WHATSAPP_CONFIG_ID);
  }

  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

function getRedirectUri(req: any): string {
  if (META_REDIRECT_URI) {
    return META_REDIRECT_URI;
  }
  const protocol = req.protocol || 'https';
  const host = req.get('host');
  return `${protocol}://${host}/api/app/meta-direct/callback`;
}

function sanitizeIds(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }

  return out;
}

async function loadStoreForSalon(salonId: number) {
  const record = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { faqAnswers: true },
  });

  const faqAnswers = asObject(record?.faqAnswers);
  const store = normalizeStore(asObject(faqAnswers.metaDirect));

  return { faqAnswers, store };
}

async function saveStoreForSalon(salonId: number, faqAnswers: Record<string, any>, store: MetaStore) {
  const nextFaqAnswers = {
    ...faqAnswers,
    metaDirect: {
      instagram: store.instagram,
      whatsapp: store.whatsapp,
    },
  };

  await prisma.salonAiAgentSettings.upsert({
    where: { salonId },
    update: { faqAnswers: nextFaqAnswers as unknown as Prisma.InputJsonValue },
    create: {
      salonId,
      faqAnswers: nextFaqAnswers as unknown as Prisma.InputJsonValue,
    },
  });
}

async function setBindings(salonId: number, channel: MetaChannel, ids: string[]) {
  const normalizedIds = sanitizeIds(ids);

  await prisma.salonChannelBinding.updateMany({
    where: { salonId, channel },
    data: { isActive: false },
  });

  for (const externalAccountId of normalizedIds) {
    await prisma.salonChannelBinding.upsert({
      where: {
        channel_externalAccountId: {
          channel,
          externalAccountId,
        },
      },
      update: {
        salonId,
        isActive: true,
      },
      create: {
        salonId,
        channel,
        externalAccountId,
        isActive: true,
      },
    });
  }
}

async function exchangeInstagramToken(code: string, redirectUri: string) {
  const instagramAppId = getClientId('INSTAGRAM');
  const instagramAppSecret = getClientSecret('INSTAGRAM');
  if (!instagramAppId || !instagramAppSecret) {
    throw new Error(
      'META_INSTAGRAM_APP_ID (or META_APP_ID) and META_INSTAGRAM_APP_SECRET (or META_APP_SECRET) must be configured.',
    );
  }

  const shortLivedResponse = await axios.post(
    'https://api.instagram.com/oauth/access_token',
    new URLSearchParams({
      client_id: instagramAppId,
      client_secret: instagramAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    },
  );

  const shortTokenPayload = Array.isArray(shortLivedResponse.data?.data)
    ? shortLivedResponse.data.data[0] || {}
    : shortLivedResponse.data || {};

  const shortLivedToken = shortTokenPayload?.access_token;
  if (!shortLivedToken || typeof shortLivedToken !== 'string') {
    throw new Error('Instagram did not return short-lived access token.');
  }

  try {
    const longLivedResponse = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: instagramAppSecret,
        access_token: shortLivedToken,
      },
      timeout: 20000,
    });

    const longLivedToken = longLivedResponse.data?.access_token;
    if (!longLivedToken || typeof longLivedToken !== 'string') {
      throw new Error('Instagram did not return long-lived access token.');
    }

    return {
      accessToken: longLivedToken,
      tokenType: 'bearer',
      expiresIn: Number.isFinite(Number(longLivedResponse.data?.expires_in))
        ? Number(longLivedResponse.data.expires_in)
        : null,
    };
  } catch (error) {
    // Some Instagram Login configurations reject ig_exchange_token with method errors.
    // Keep connection usable by falling back to short-lived token.
    console.warn('Instagram long-lived token exchange failed, using short-lived token:', getAxiosErrorMessage(error));
    return {
      accessToken: shortLivedToken,
      tokenType: 'bearer',
      expiresIn: Number.isFinite(Number(shortTokenPayload?.expires_in))
        ? Number(shortTokenPayload.expires_in)
        : null,
    };
  }
}

async function exchangeCodeForToken(code: string, redirectUri: string, channel: MetaChannel) {
  if (channel === 'INSTAGRAM') {
    return exchangeInstagramToken(code, redirectUri);
  }

  const appId = getClientId(channel);
  const appSecret = getClientSecret(channel);
  if (!appId || !appSecret) {
    throw new Error('META_APP_ID and META_APP_SECRET must be configured.');
  }

  const response = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    },
    timeout: 20000,
  });

  const accessToken = response.data?.access_token;
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Meta did not return access token.');
  }

  return {
    accessToken,
    tokenType: typeof response.data?.token_type === 'string' ? response.data.token_type : null,
    expiresIn: Number.isFinite(Number(response.data?.expires_in)) ? Number(response.data.expires_in) : null,
  };
}

function getAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData = (error.response?.data as any) || {};
    const nestedMessage = responseData?.error?.message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage.trim();
    }

    const flatMessage = responseData?.error_message;
    if (typeof flatMessage === 'string' && flatMessage.trim()) {
      const errorType = typeof responseData?.error_type === 'string' ? responseData.error_type.trim() : '';
      const code = responseData?.code;
      const meta = [errorType, Number.isFinite(Number(code)) ? `code ${code}` : ''].filter(Boolean).join(', ');
      return meta ? `${flatMessage.trim()} (${meta})` : flatMessage.trim();
    }

    if (typeof responseData?.message === 'string' && responseData.message.trim()) {
      return responseData.message.trim();
    }

    if (error.response?.status) {
      return `Meta API request failed with status ${error.response.status}.`;
    }

    if (error.message?.trim()) {
      return error.message.trim();
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Unknown Meta API error.';
}

async function probeInstagram(accessToken: string) {
  const response = await axios.get('https://graph.instagram.com/me', {
    params: {
      access_token: accessToken,
      fields: 'id,username',
    },
    timeout: 20000,
  });

  const igId = typeof response.data?.id === 'string' ? response.data.id.trim() : '';
  if (!igId) {
    throw new Error('Instagram professional account not found.');
  }

  const username =
    typeof response.data?.username === 'string' && response.data.username.trim()
      ? response.data.username.trim()
      : null;

  return {
    externalAccountId: igId,
    externalBusinessId: null,
    externalDisplayName: username || igId,
    bindingIds: sanitizeIds([igId]),
  };
}

async function probeWhatsApp(accessToken: string) {
  const response = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/businesses`, {
    params: {
      access_token: accessToken,
      fields: 'id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number}}',
      limit: 50,
    },
    timeout: 20000,
  });

  const businesses = Array.isArray(response.data?.data) ? response.data.data : [];
  for (const business of businesses) {
    const businessId = typeof business?.id === 'string' ? business.id : null;
    const wabas = Array.isArray(business?.owned_whatsapp_business_accounts?.data)
      ? business.owned_whatsapp_business_accounts.data
      : [];

    for (const waba of wabas) {
      const wabaId = typeof waba?.id === 'string' ? waba.id : null;
      const phones = Array.isArray(waba?.phone_numbers?.data) ? waba.phone_numbers.data : [];
      const phone = phones.find((item: any) => typeof item?.id === 'string' && item.id.trim());

      if (phone && wabaId) {
        const phoneId = phone.id.trim();
        const display =
          typeof phone.display_phone_number === 'string' && phone.display_phone_number.trim()
            ? phone.display_phone_number.trim()
            : typeof waba?.name === 'string' && waba.name.trim()
              ? waba.name.trim()
              : phoneId;

        return {
          externalAccountId: phoneId,
          externalBusinessId: wabaId,
          externalDisplayName: display,
          bindingIds: sanitizeIds([phoneId, wabaId, businessId]),
        };
      }
    }
  }

  throw new Error('No WhatsApp Business Account phone number found in Meta Business assets.');
}

async function runProbe(channel: MetaChannel, accessToken: string) {
  return channel === 'INSTAGRAM' ? probeInstagram(accessToken) : probeWhatsApp(accessToken);
}

async function finalizeConnection(args: {
  salonId: number;
  channel: MetaChannel;
  token: { accessToken: string; tokenType: string | null; expiresIn: number | null };
  prefill?: PrefillConnection;
}) {
  const { salonId, channel, token, prefill } = args;
  const key = toMetaKey(channel);

  let probe: Awaited<ReturnType<typeof runProbe>> | null = null;
  let probeError: string | null = null;

  const bindingIds = sanitizeIds(prefill?.bindingIds || []);
  if (bindingIds.length > 0) {
    await setBindings(salonId, channel, bindingIds);
  }

  if (bindingIds.length === 0) {
    try {
      probe = await runProbe(channel, token.accessToken);
      await setBindings(salonId, channel, probe.bindingIds);
    } catch (error) {
      // Token can still be valid; probe can be retried later with broader business setup.
      probeError = getAxiosErrorMessage(error);
    }
  }

  const loaded = await loadStoreForSalon(salonId);
  loaded.store[key] = {
    ...loaded.store[key],
    status: 'CONNECTED',
    message: probe
      ? 'Connected and verified with a live API call.'
      : bindingIds.length > 0
        ? 'Connected via Embedded Signup. Binding captured.'
        : 'Connected. Token saved. Run Probe to finalize account binding.',
    externalAccountId:
      probe?.externalAccountId ||
      prefill?.externalAccountId ||
      loaded.store[key].externalAccountId,
    externalBusinessId:
      probe?.externalBusinessId ||
      prefill?.externalBusinessId ||
      loaded.store[key].externalBusinessId,
    externalDisplayName:
      probe?.externalDisplayName ||
      prefill?.externalDisplayName ||
      loaded.store[key].externalDisplayName,
    accessToken: token.accessToken,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
    lastConnectedAt: new Date().toISOString(),
    lastProbeAt: probe ? new Date().toISOString() : loaded.store[key].lastProbeAt,
    lastProbeOk: probe ? true : loaded.store[key].lastProbeOk,
    lastError: probe ? null : probeError,
  };
  await saveStoreForSalon(salonId, loaded.faqAnswers, loaded.store);

  return {
    probe,
    probeError,
  };
}

function renderCallbackHtml(payload: { success: boolean; channel: MetaChannel | 'UNKNOWN'; message: string }) {
  const serialized = JSON.stringify({
    type: 'meta-direct-callback',
    success: payload.success,
    channel: payload.channel,
    message: payload.message,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Meta Direct Callback</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f7f6f6; margin: 0; padding: 24px; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border: 1px solid #ddd; border-radius: 12px; padding: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${payload.success ? 'Connection successful' : 'Connection failed'}</h2>
    <p>${payload.message}</p>
    <p>You can close this window now.</p>
  </div>
  <script>
    (function () {
      try {
        var payload = ${serialized};
        if (window.opener && typeof window.opener.postMessage === 'function') {
          window.opener.postMessage(payload, '*');
        }
      } catch (error) {
        // ignore
      }
      setTimeout(function () {
        window.close();
      }, 500);
    })();
  </script>
</body>
</html>`;
}

router.get('/status', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = req?.user?.salonId;
    if (!Number.isInteger(salonId) || salonId <= 0) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const [{ store }, bindings] = await Promise.all([
      loadStoreForSalon(salonId),
      prisma.salonChannelBinding.findMany({
        where: {
          salonId,
          channel: { in: [ChannelType.INSTAGRAM, ChannelType.WHATSAPP] },
          isActive: true,
        },
        select: { channel: true, externalAccountId: true },
      }),
    ]);

    const igBindings = bindings
      .filter((item) => item.channel === ChannelType.INSTAGRAM)
      .map((item) => item.externalAccountId);

    const waBindings = bindings
      .filter((item) => item.channel === ChannelType.WHATSAPP)
      .map((item) => item.externalAccountId);

    return res.status(200).json({
      instagram: {
        ...store.instagram,
        connected: store.instagram.status === 'CONNECTED',
        bindingReady: igBindings.length > 0,
        activeBindingIds: sanitizeIds(igBindings),
      },
      whatsapp: {
        ...store.whatsapp,
        connected: store.whatsapp.status === 'CONNECTED',
        bindingReady: waBindings.length > 0,
        activeBindingIds: sanitizeIds(waBindings),
      },
      connectorNote: 'Chakra flow remains active in production; Meta Direct is in beta prep.',
      graphVersion: META_GRAPH_VERSION,
    });
  } catch (error) {
    console.error('Meta Direct status failed:', error);
    return res.status(500).json({ message: 'Meta Direct status failed.' });
  }
});

router.post('/connect-url', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = req?.user?.salonId;
    if (!Number.isInteger(salonId) || salonId <= 0) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const channel = toMetaChannel(req.body?.channel);
    if (!channel) {
      return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
    }

    const appId = getClientId(channel);
    if (!appId) {
      return res.status(500).json({ message: channel === 'INSTAGRAM' ? 'META_INSTAGRAM_APP_ID (or META_APP_ID) is missing.' : 'META_APP_ID is missing.' });
    }

    if (!META_STATE_SECRET) {
      return res.status(500).json({ message: 'META_STATE_SECRET (or JWT_SECRET) is missing.' });
    }

    const redirectUri = getRedirectUri(req);
    const statePayload: StatePayload = {
      sid: salonId,
      ch: channel,
      ts: Date.now(),
      nonce: crypto.randomBytes(12).toString('hex'),
    };

    const state = encodeState(statePayload);
    const scopes = getScopes(channel);
    const authorizeUrl = buildAuthorizeUrl(channel, redirectUri, state, scopes);
    const connectMode: ConnectMode =
      channel === 'WHATSAPP' && META_WHATSAPP_CONFIG_ID
        ? 'EMBEDDED_SIGNUP'
        : 'OAUTH';
    const configId = channel === 'WHATSAPP'
      ? (META_WHATSAPP_CONFIG_ID || null)
      : (META_INSTAGRAM_CONFIG_ID || null);

    const loaded = await loadStoreForSalon(salonId);
    const key = toMetaKey(channel);
    loaded.store[key] = {
      ...loaded.store[key],
      status: 'CONNECTING',
      message: 'OAuth URL generated. Waiting for callback.',
      lastError: null,
    };
    await saveStoreForSalon(salonId, loaded.faqAnswers, loaded.store);

    return res.status(200).json({
      channel,
      connectMode,
      authorizeUrl,
      redirectUri,
      appId,
      configId,
      scopes,
      state,
    });
  } catch (error) {
    console.error('Meta Direct connect-url failed:', error);
    return res.status(500).json({ message: 'Meta Direct connect-url failed.' });
  }
});

router.get('/callback', async (req: any, res: any) => {
  const rawState = typeof req.query?.state === 'string' ? req.query.state : '';
  const code = typeof req.query?.code === 'string' ? req.query.code : '';
  const errorParam = typeof req.query?.error === 'string' ? req.query.error : '';
  const errorDescription = typeof req.query?.error_description === 'string' ? req.query.error_description : '';

  const statePayload = decodeState(rawState);
  if (!statePayload) {
    return res.status(400).send(renderCallbackHtml({
      success: false,
      channel: 'UNKNOWN',
      message: 'Invalid or expired state token.',
    }));
  }

  const channel = statePayload.ch;
  const key = toMetaKey(channel);

  const fail = async (message: string) => {
    try {
      const loaded = await loadStoreForSalon(statePayload.sid);
      loaded.store[key] = {
        ...loaded.store[key],
        status: 'FAILED',
        message,
        lastProbeAt: new Date().toISOString(),
        lastProbeOk: false,
        lastError: message,
      };
      await saveStoreForSalon(statePayload.sid, loaded.faqAnswers, loaded.store);
    } catch (persistError) {
      console.error('Meta Direct callback persist failed:', persistError);
    }

    return res.status(200).send(renderCallbackHtml({
      success: false,
      channel,
      message,
    }));
  };

  if (errorParam) {
    return fail(errorDescription || errorParam || 'Meta authorization rejected.');
  }

  if (!code) {
    return fail('Meta callback did not include authorization code.');
  }

  try {
    const redirectUri = getRedirectUri(req);
    const token = await exchangeCodeForToken(code, redirectUri, channel);
    const { probe } = await finalizeConnection({
      salonId: statePayload.sid,
      channel,
      token,
    });

    return res.status(200).send(renderCallbackHtml({
      success: true,
      channel,
      message: probe
        ? `${channel} connected successfully and initial API call completed.`
        : `${channel} connected successfully. Run Probe in app to finalize binding.`,
    }));
  } catch (error) {
    return fail(getAxiosErrorMessage(error));
  }
});

router.post('/exchange-code', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = req?.user?.salonId;
    if (!Number.isInteger(salonId) || salonId <= 0) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const channel = toMetaChannel(req.body?.channel);
    if (!channel) {
      return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return res.status(400).json({ message: 'code is required.' });
    }

    const redirectUri = getRedirectUri(req);
    const token = await exchangeCodeForToken(code, redirectUri, channel);

    const prefill: PrefillConnection = {
      externalAccountId:
        typeof req.body?.phoneNumberId === 'string' && req.body.phoneNumberId.trim()
          ? req.body.phoneNumberId.trim()
          : typeof req.body?.externalAccountId === 'string' && req.body.externalAccountId.trim()
            ? req.body.externalAccountId.trim()
            : null,
      externalBusinessId:
        typeof req.body?.wabaId === 'string' && req.body.wabaId.trim()
          ? req.body.wabaId.trim()
          : typeof req.body?.businessId === 'string' && req.body.businessId.trim()
            ? req.body.businessId.trim()
            : typeof req.body?.externalBusinessId === 'string' && req.body.externalBusinessId.trim()
              ? req.body.externalBusinessId.trim()
              : null,
      externalDisplayName:
        typeof req.body?.displayPhoneNumber === 'string' && req.body.displayPhoneNumber.trim()
          ? req.body.displayPhoneNumber.trim()
          : typeof req.body?.externalDisplayName === 'string' && req.body.externalDisplayName.trim()
            ? req.body.externalDisplayName.trim()
            : null,
      bindingIds: sanitizeIds([
        req.body?.phoneNumberId,
        req.body?.wabaId,
        req.body?.businessId,
        req.body?.externalAccountId,
        req.body?.externalBusinessId,
      ]),
    };

    const { probe, probeError } = await finalizeConnection({
      salonId,
      channel,
      token,
      prefill,
    });

    return res.status(200).json({
      ok: true,
      channel,
      connected: true,
      bindingReady: Boolean(probe || (prefill.bindingIds || []).length > 0),
      message: probe
        ? 'Connected and probe succeeded.'
        : (prefill.bindingIds || []).length > 0
          ? 'Connected via Embedded Signup and binding captured.'
          : 'Connected. Token saved. Run Probe to finalize binding.',
      probeError,
    });
  } catch (error) {
    console.error('Meta Direct exchange-code failed:', error);
    return res.status(400).json({
      ok: false,
      message: getAxiosErrorMessage(error),
    });
  }
});

router.post('/disconnect', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = req?.user?.salonId;
    if (!Number.isInteger(salonId) || salonId <= 0) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const channel = toMetaChannel(req.body?.channel);
    if (!channel) {
      return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
    }

    const loaded = await loadStoreForSalon(salonId);
    loaded.store[toMetaKey(channel)] = {
      ...defaultChannelState(),
      status: 'NOT_CONNECTED',
      message: 'Disconnected by user.',
    };

    await Promise.all([
      saveStoreForSalon(salonId, loaded.faqAnswers, loaded.store),
      setBindings(salonId, channel, []),
    ]);

    return res.status(200).json({ ok: true, channel });
  } catch (error) {
    console.error('Meta Direct disconnect failed:', error);
    return res.status(500).json({ message: 'Meta Direct disconnect failed.' });
  }
});

router.post('/probe', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = req?.user?.salonId;
    if (!Number.isInteger(salonId) || salonId <= 0) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const channel = toMetaChannel(req.body?.channel);
    if (!channel) {
      return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
    }

    const loaded = await loadStoreForSalon(salonId);
    const key = toMetaKey(channel);
    const current = loaded.store[key];

    if (!current.accessToken) {
      return res.status(400).json({ message: `${channel} access token not found. Connect first.` });
    }

    try {
      const probe = await runProbe(channel, current.accessToken);
      await setBindings(salonId, channel, probe.bindingIds);

      loaded.store[key] = {
        ...loaded.store[key],
        status: 'CONNECTED',
        message: 'Probe successful. Latest API call verified.',
        externalAccountId: probe.externalAccountId,
        externalBusinessId: probe.externalBusinessId,
        externalDisplayName: probe.externalDisplayName,
        lastProbeAt: new Date().toISOString(),
        lastProbeOk: true,
        lastError: null,
      };

      await saveStoreForSalon(salonId, loaded.faqAnswers, loaded.store);

      return res.status(200).json({
        ok: true,
        channel,
        probe,
      });
    } catch (probeError) {
      const message = getAxiosErrorMessage(probeError);

      loaded.store[key] = {
        ...loaded.store[key],
        status: 'FAILED',
        message,
        lastProbeAt: new Date().toISOString(),
        lastProbeOk: false,
        lastError: message,
      };

      await saveStoreForSalon(salonId, loaded.faqAnswers, loaded.store);

      return res.status(400).json({
        ok: false,
        channel,
        message,
      });
    }
  } catch (error) {
    console.error('Meta Direct probe failed:', error);
    return res.status(500).json({ message: 'Meta Direct probe failed.' });
  }
});

export default router;
