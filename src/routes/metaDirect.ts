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
const META_REDIRECT_URI = (process.env.META_REDIRECT_URI || '').trim();
const META_STATE_SECRET = (process.env.META_STATE_SECRET || process.env.JWT_SECRET || '').trim();
const META_WHATSAPP_CONFIG_ID = (process.env.META_WHATSAPP_CONFIG_ID || '').trim();
const META_INSTAGRAM_CONFIG_ID = (process.env.META_INSTAGRAM_CONFIG_ID || '').trim();
const META_INSTAGRAM_REQUIRE_LONG_LIVED =
  (process.env.META_INSTAGRAM_REQUIRE_LONG_LIVED || '').trim().toLowerCase() === 'true';

type MetaChannel = 'INSTAGRAM' | 'WHATSAPP';
type MetaStatus = 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'FAILED';
type MetaChannelKey = 'instagram' | 'whatsapp';
type ConnectMode = 'OAUTH' | 'EMBEDDED_SIGNUP';
type ConnectionMode = 'INSTAGRAM_LOGIN' | 'WHATSAPP_EMBEDDED_SIGNUP' | 'WHATSAPP_OAUTH';
type CredentialsSource = 'META_INSTAGRAM' | 'META_APP';

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
  lastWebhookAt: string | null;
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

interface MetaTokenResult {
  accessToken: string;
  backupAccessToken?: string | null;
  tokenType: string | null;
  expiresIn: number | null;
  instagramUserId?: string | null;
  longLivedExchangeWarning?: string | null;
}

interface InstagramValidationResult {
  accountId: string;
  username: string | null;
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
    lastWebhookAt: null,
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
        status === 'CONNECTING' || status === 'CONNECTED' || status === 'DEGRADED' || status === 'FAILED' || status === 'NOT_CONNECTED'
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
      lastWebhookAt: typeof value.lastWebhookAt === 'string' ? value.lastWebhookAt : null,
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

  const scopes = parsed.length > 0 ? parsed : defaultScopes[channel];
  if (channel !== 'INSTAGRAM') {
    return scopes;
  }

  const required = ['instagram_business_basic', 'instagram_business_manage_messages'];
  const normalized = new Set(scopes.map((item) => item.trim()).filter(Boolean));
  for (const permission of required) {
    normalized.add(permission);
  }
  return Array.from(normalized);
}

function getClientId(channel: MetaChannel): string {
  if (channel === 'INSTAGRAM') {
    return META_INSTAGRAM_APP_ID;
  }
  return META_APP_ID;
}

function getClientSecret(channel: MetaChannel): string {
  if (channel === 'INSTAGRAM') {
    return META_INSTAGRAM_APP_SECRET;
  }
  return META_APP_SECRET;
}

function getConnectionMode(channel: MetaChannel): ConnectionMode {
  if (channel === 'INSTAGRAM') return 'INSTAGRAM_LOGIN';
  return META_WHATSAPP_CONFIG_ID ? 'WHATSAPP_EMBEDDED_SIGNUP' : 'WHATSAPP_OAUTH';
}

function getCredentialsSource(channel: MetaChannel): CredentialsSource {
  return channel === 'INSTAGRAM' ? 'META_INSTAGRAM' : 'META_APP';
}

function buildAuthorizeUrl(
  channel: MetaChannel,
  redirectUri: string,
  state: string,
  scopes: string[],
): string {
  const clientId = getClientId(channel);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: scopes.join(','),
  });

  if (channel === 'INSTAGRAM') {
    params.set('force_reauth', 'true');
    if (META_INSTAGRAM_CONFIG_ID) {
      params.set('config_id', META_INSTAGRAM_CONFIG_ID);
    }
    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

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
    throw new Error('META_INSTAGRAM_APP_ID and META_INSTAGRAM_APP_SECRET must be configured.');
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
  const instagramUserId =
    typeof shortTokenPayload?.user_id === 'string' && shortTokenPayload.user_id.trim()
      ? shortTokenPayload.user_id.trim()
      : Number.isFinite(Number(shortTokenPayload?.user_id))
        ? String(shortTokenPayload.user_id)
        : null;

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
      backupAccessToken: shortLivedToken,
      tokenType: 'bearer',
      expiresIn: Number.isFinite(Number(longLivedResponse.data?.expires_in))
        ? Number(longLivedResponse.data.expires_in)
        : null,
      instagramUserId,
      longLivedExchangeWarning: null,
    };
  } catch (error) {
    const wrapped = wrapStepError('instagram_exchange_long_lived_token', error);
    if (META_INSTAGRAM_REQUIRE_LONG_LIVED) {
      throw wrapped;
    }
    return {
      accessToken: shortLivedToken,
      backupAccessToken: null,
      tokenType: 'bearer',
      expiresIn: Number.isFinite(Number(shortTokenPayload?.expires_in))
        ? Number(shortTokenPayload.expires_in)
        : null,
      instagramUserId,
      longLivedExchangeWarning: wrapped.message,
    };
  }
}

function pickInstagramMePayload(responseData: any): Record<string, any> {
  if (Array.isArray(responseData?.data)) {
    const first = responseData.data[0];
    if (first && typeof first === 'object') return first as Record<string, any>;
  }
  if (responseData?.data && typeof responseData.data === 'object') {
    return responseData.data as Record<string, any>;
  }
  if (responseData && typeof responseData === 'object') {
    return responseData as Record<string, any>;
  }
  return {};
}

async function validateInstagramToken(
  accessToken: string,
  accountIdCandidate?: string | null,
): Promise<InstagramValidationResult> {
  const normalizedAccountIdCandidate =
    typeof accountIdCandidate === 'string' && accountIdCandidate.trim()
      ? accountIdCandidate.trim()
      : null;
  const endpoints = [
    `https://graph.instagram.com/${META_GRAPH_VERSION}/me`,
    'https://graph.instagram.com/me',
    ...(normalizedAccountIdCandidate
      ? [
          `https://graph.instagram.com/${META_GRAPH_VERSION}/${normalizedAccountIdCandidate}`,
          `https://graph.instagram.com/${normalizedAccountIdCandidate}`,
        ]
      : []),
  ];
  const fieldSets = ['user_id,username', 'id,user_id,username'];

  let lastError: Error | null = null;

  for (const url of endpoints) {
    for (const fields of fieldSets) {
      try {
        const response = await axios.get(url, {
          params: {
            access_token: accessToken,
            fields,
          },
          timeout: 20000,
        });

        const payload = pickInstagramMePayload(response.data);
        const accountId =
          (typeof payload?.user_id === 'string' && payload.user_id.trim()
            ? payload.user_id.trim()
            : '') ||
          (typeof payload?.id === 'string' && payload.id.trim()
            ? payload.id.trim()
            : '');
        const username =
          typeof payload?.username === 'string' && payload.username.trim()
            ? payload.username.trim()
            : null;

        if (!accountId) {
          throw new Error('instagram_validate_token_me: account id missing in /me response payload.');
        }

        return { accountId, username };
      } catch (error) {
        lastError = wrapStepError(`instagram_validate_token_me[fields=${fields}]`, error);
      }
    }
  }

  throw lastError || new Error('instagram_validate_token_me: failed to validate token.');
}

const defaultInstagramSubscribedFields = [
  'messages',
  'messaging_postbacks',
  'messaging_seen',
  'message_reactions',
];

function getInstagramSubscribedFields(): string[] {
  const raw = (process.env.META_INSTAGRAM_SUBSCRIBED_FIELDS || '').trim();
  if (!raw) return defaultInstagramSubscribedFields;
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : defaultInstagramSubscribedFields;
}

async function ensureInstagramSubscription(igAccountId: string, accessToken: string): Promise<void> {
  const subscribedFields = getInstagramSubscribedFields().join(',');
  const body = new URLSearchParams({
    subscribed_fields: subscribedFields,
  }).toString();
  const targets = [
    {
      step: 'instagram_subscribe_apps_me',
      url: `https://graph.instagram.com/${META_GRAPH_VERSION}/me/subscribed_apps`,
    },
    {
      step: 'instagram_subscribe_apps_igid',
      url: `https://graph.instagram.com/${META_GRAPH_VERSION}/${igAccountId}/subscribed_apps`,
    },
  ];

  let lastError: Error | null = null;

  for (const target of targets) {
    try {
      await axios.post(
        target.url,
        body,
        {
          params: { access_token: accessToken },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20000,
        },
      );
      return;
    } catch (error) {
      lastError = wrapStepError(target.step, error);
    }
  }

  throw lastError || new Error('instagram_subscribe_apps: failed to subscribe.');
}

async function exchangeCodeForToken(code: string, redirectUri: string, channel: MetaChannel): Promise<MetaTokenResult> {
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
    instagramUserId: null,
  };
}

function getAxiosErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const fbError = (error.response?.data as any)?.error?.message;
    if (typeof fbError === 'string' && fbError.trim()) {
      return fbError.trim();
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

function getAxiosErrorDetails(error: unknown) {
  if (!axios.isAxiosError(error)) return null;
  const payload = (error.response?.data || {}) as any;
  const fb = (payload?.error || {}) as any;
  return {
    method: error.config?.method ? String(error.config.method).toUpperCase() : null,
    url: error.config?.url || null,
    status: error.response?.status ?? null,
    fbTraceId: fb.fbtrace_id || error.response?.headers?.['x-fb-trace-id'] || null,
    type: fb.type || null,
    code: fb.code ?? null,
    subcode: fb.error_subcode ?? null,
    message: fb.message || error.message || 'Unknown Axios error',
  };
}

function wrapStepError(step: string, error: unknown): Error {
  const details = getAxiosErrorDetails(error);
  if (!details) {
    return new Error(`${step}: ${getAxiosErrorMessage(error)}`);
  }
  const meta = [
    details.method ? `method=${details.method}` : null,
    details.url ? `url=${details.url}` : null,
    details.status ? `status=${details.status}` : null,
    details.type ? `type=${details.type}` : null,
    details.code !== null ? `code=${details.code}` : null,
    details.subcode !== null ? `subcode=${details.subcode}` : null,
    details.fbTraceId ? `fbtrace=${details.fbTraceId}` : null,
  ].filter(Boolean).join(' ');
  return new Error(`${step}: ${details.message}${meta ? ` [${meta}]` : ''}`);
}

async function probeInstagram(accessToken: string) {
  const validation = await validateInstagramToken(accessToken);
  const igId = validation.accountId;
  const username = validation.username;

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
  token: MetaTokenResult;
  prefill?: PrefillConnection;
}) {
  const { salonId, channel, token, prefill } = args;
  const key = toMetaKey(channel);

  let probe: Awaited<ReturnType<typeof runProbe>> | null = null;
  let probeError: string | null = null;
  let status: MetaStatus = 'CONNECTED';
  let message = 'Connected and verified with a live API call.';
  let accessTokenToPersist = token.accessToken;
  const nowIso = new Date().toISOString();

  if (channel === 'INSTAGRAM') {
    const instagramIdCandidate =
      (typeof token.instagramUserId === 'string' && token.instagramUserId.trim()
        ? token.instagramUserId.trim()
        : null) ||
      (typeof prefill?.externalAccountId === 'string' && prefill.externalAccountId.trim()
        ? prefill.externalAccountId.trim()
        : null);
    let tokenToUse = token.accessToken;
    let validation: InstagramValidationResult;
    const longLivedExchangeWarning =
      typeof token.longLivedExchangeWarning === 'string' && token.longLivedExchangeWarning.trim()
        ? token.longLivedExchangeWarning.trim()
        : null;
    try {
      validation = await validateInstagramToken(tokenToUse, instagramIdCandidate);
    } catch (error) {
      const backup = typeof token.backupAccessToken === 'string' ? token.backupAccessToken.trim() : '';
      if (backup && backup !== tokenToUse) {
        try {
          validation = await validateInstagramToken(backup, instagramIdCandidate);
          tokenToUse = backup;
          accessTokenToPersist = backup;
          probeError = `primary_token_failed_fell_back_to_short_lived: ${getAxiosErrorMessage(error)}`;
          status = 'DEGRADED';
          message = 'Connected using short-lived token fallback. Long-lived token validation failed.';
        } catch (backupError) {
          throw backupError;
        }
      } else {
        throw error;
      }
    }

    const bindingIds = sanitizeIds([
      validation.accountId,
      ...(prefill?.bindingIds || []),
      prefill?.externalAccountId || null,
    ]);

    if (!bindingIds.length) {
      throw new Error('Instagram connection did not return a bindable account id.');
    }

    await setBindings(salonId, channel, bindingIds);
    probe = {
      externalAccountId: validation.accountId,
      externalBusinessId: prefill?.externalBusinessId || null,
      externalDisplayName: validation.username || prefill?.externalDisplayName || validation.accountId,
      bindingIds,
    };

    try {
      await ensureInstagramSubscription(validation.accountId, tokenToUse);
      if (status !== 'DEGRADED') {
        status = 'CONNECTED';
        message = longLivedExchangeWarning
          ? 'Connected and validated. Long-lived token exchange is unavailable for this app configuration; using OAuth token.'
          : 'Connected, validated, and webhook subscription requested successfully.';
      }
    } catch (error) {
      probeError = getAxiosErrorMessage(error);
      status = 'DEGRADED';
      message =
        'Connected and token validated, but webhook subscription could not be confirmed. Complete subscription in Meta Dashboard.';
    }
  } else {
    const bindingIds = sanitizeIds(prefill?.bindingIds || []);
    if (bindingIds.length > 0) {
      await setBindings(salonId, channel, bindingIds);
    }

    if (bindingIds.length === 0) {
      try {
        probe = await runProbe(channel, token.accessToken);
        await setBindings(salonId, channel, probe.bindingIds);
      } catch (error) {
        probeError = getAxiosErrorMessage(error);
        status = 'DEGRADED';
        message = `Connected, but probe could not verify channel details: ${probeError}`;
      }
    } else {
      message = 'Connected via Embedded Signup. Binding captured.';
    }
  }

  const loaded = await loadStoreForSalon(salonId);
  loaded.store[key] = {
    ...loaded.store[key],
    status,
    message,
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
    accessToken: accessTokenToPersist,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
    lastConnectedAt: status === 'CONNECTED' || status === 'DEGRADED' ? nowIso : loaded.store[key].lastConnectedAt,
    lastProbeAt: nowIso,
    lastProbeOk: true,
    lastError: probeError,
  };
  await saveStoreForSalon(salonId, loaded.faqAnswers, loaded.store);

  return {
    probe,
    probeError,
    status,
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

    const igBindingIds = sanitizeIds(igBindings);
    const waBindingIds = sanitizeIds(waBindings);
    const igTokenLikelyValid = Boolean(store.instagram.accessToken && store.instagram.lastProbeOk);
    const igWebhookSubscribedLikely =
      store.instagram.status === 'CONNECTED' &&
      !store.instagram.lastError;
    const igMissingRequirements: string[] = [];
    if (!store.instagram.accessToken) igMissingRequirements.push('missing_access_token');
    if (!igBindingIds.length) igMissingRequirements.push('missing_binding');
    if (!igTokenLikelyValid) igMissingRequirements.push('token_not_verified');
    if (!store.instagram.lastWebhookAt) igMissingRequirements.push('webhook_not_observed');
    if (!igWebhookSubscribedLikely) igMissingRequirements.push('webhook_subscription_unconfirmed');

    return res.status(200).json({
      instagram: {
        ...store.instagram,
        connected: store.instagram.status === 'CONNECTED',
        bindingReady: igBindingIds.length > 0 && igTokenLikelyValid,
        activeBindingIds: igBindingIds,
        diagnostics: {
          tokenValid: igTokenLikelyValid,
          bindingExists: igBindingIds.length > 0,
          lastWebhookAt: store.instagram.lastWebhookAt,
          webhookSubscribedLikely: igWebhookSubscribedLikely,
          missingRequirements: igMissingRequirements,
        },
      },
      whatsapp: {
        ...store.whatsapp,
        connected: store.whatsapp.status === 'CONNECTED',
        bindingReady: waBindingIds.length > 0,
        activeBindingIds: waBindingIds,
        diagnostics: {
          tokenValid: Boolean(store.whatsapp.accessToken && store.whatsapp.lastProbeOk),
          bindingExists: waBindingIds.length > 0,
          lastWebhookAt: null,
          webhookSubscribedLikely: null,
          missingRequirements: [
            ...(store.whatsapp.accessToken ? [] : ['missing_access_token']),
            ...(waBindingIds.length > 0 ? [] : ['missing_binding']),
          ],
        },
      },
      connectorNote: 'Chakra flow remains active in production; Meta Direct is active for Instagram DM.',
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
      return res.status(500).json({ message: channel === 'INSTAGRAM' ? 'META_INSTAGRAM_APP_ID is missing.' : 'META_APP_ID is missing.' });
    }
    const appSecret = getClientSecret(channel);
    if (!appSecret) {
      return res.status(500).json({
        message: channel === 'INSTAGRAM' ? 'META_INSTAGRAM_APP_SECRET is missing.' : 'META_APP_SECRET is missing.',
      });
    }
    if (channel === 'INSTAGRAM' && !META_INSTAGRAM_CONFIG_ID) {
      return res.status(500).json({
        message:
          'META_INSTAGRAM_CONFIG_ID is missing. Use Instagram > API setup with Instagram login > Business login settings configuration ID.',
      });
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
    const connectionMode = getConnectionMode(channel);
    const credentialsSource = getCredentialsSource(channel);
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
      connectionMode,
      credentialsSource,
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
    console.error('Meta Direct callback failed:', {
      salonId: statePayload.sid,
      channel,
      message,
    });
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
    const prefillFromToken: PrefillConnection | undefined =
      channel === 'INSTAGRAM' && token.instagramUserId
        ? {
            externalAccountId: token.instagramUserId,
            externalDisplayName: token.instagramUserId,
            bindingIds: [token.instagramUserId],
          }
        : undefined;
    const { probe, status, probeError } = await finalizeConnection({
      salonId: statePayload.sid,
      channel,
      token,
      prefill: prefillFromToken,
    });

    return res.status(200).send(renderCallbackHtml({
      success: status === 'CONNECTED',
      channel,
      message:
        status === 'CONNECTED'
          ? `${channel} connected successfully and initial verification completed.`
          : `Connection completed with warnings (${status}). ${probeError || 'Check Meta webhook subscription.'}`,
    }));
  } catch (error) {
    console.error('Meta Direct callback exchange failed:', {
      salonId: statePayload.sid,
      channel,
      detail: getAxiosErrorDetails(error),
      message: getAxiosErrorMessage(error),
    });
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
        channel === 'INSTAGRAM' ? token.instagramUserId : null,
      ]),
    };

    if (channel === 'INSTAGRAM' && token.instagramUserId) {
      prefill.externalAccountId = token.instagramUserId;
      prefill.externalDisplayName = prefill.externalDisplayName || token.instagramUserId;
    }

    const { probe, probeError, status } = await finalizeConnection({
      salonId,
      channel,
      token,
      prefill,
    });

    const tokenValid = status === 'CONNECTED' || status === 'DEGRADED';
    const bindingReady = Boolean((prefill.bindingIds || []).length > 0 || probe?.bindingIds?.length);

    return res.status(200).json({
      ok: true,
      channel,
      connected: status === 'CONNECTED',
      status,
      bindingReady: bindingReady && tokenValid,
      tokenValid,
      message:
        status === 'CONNECTED'
          ? 'Connected and verified.'
          : status === 'DEGRADED'
            ? `Connected with warnings: ${probeError || 'webhook subscription not confirmed'}.`
            : 'Connection failed validation.',
      probeError,
    });
  } catch (error) {
    console.error('Meta Direct exchange-code failed:', error);
    console.error('Meta Direct exchange-code detail:', {
      detail: getAxiosErrorDetails(error),
      message: getAxiosErrorMessage(error),
    });
    return res.status(400).json({
      ok: false,
      message: getAxiosErrorMessage(error),
    });
  }
});

router.post('/reconcile', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = req?.user?.salonId;
    if (!Number.isInteger(salonId) || salonId <= 0) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const channel = toMetaChannel(req.body?.channel || 'INSTAGRAM');
    if (!channel) {
      return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
    }

    const loaded = await loadStoreForSalon(salonId);
    const key = toMetaKey(channel);
    const state = loaded.store[key];
    if (!state.accessToken) {
      return res.status(400).json({ message: `${channel} access token not found.` });
    }

    const { status, probeError } = await finalizeConnection({
      salonId,
      channel,
      token: {
        accessToken: state.accessToken,
        tokenType: state.tokenType,
        expiresIn: state.expiresIn,
      },
      prefill: {
        externalAccountId: state.externalAccountId,
        externalBusinessId: state.externalBusinessId,
        externalDisplayName: state.externalDisplayName,
        bindingIds: sanitizeIds([state.externalAccountId, state.externalBusinessId]),
      },
    });

    return res.status(200).json({
      ok: true,
      channel,
      status,
      message:
        status === 'CONNECTED'
          ? 'Reconcile completed and connection is healthy.'
          : `Reconcile completed with warnings: ${probeError || 'check diagnostics'}.`,
      warning: probeError,
    });
  } catch (error) {
    console.error('Meta Direct reconcile failed:', error);
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
