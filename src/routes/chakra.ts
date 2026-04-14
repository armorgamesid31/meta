import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.js';
import { writeAccessAudit } from '../services/accessControl.js';

const router = Router();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

const CHAKRA_SDK_URL = 'https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js';
const DEFAULT_CHAKRA_PASSTHROUGH_WEBHOOK_URL = 'https://app.berkai.shop/api/webhooks/whatsapp';
const CHAKRA_PASSTHROUGH_WEBHOOK_URL = (
  process.env.CHAKRA_PASSTHROUGH_WEBHOOK_URL ||
  process.env.CHAKRA_WEBHOOK_URL ||
  process.env.N8N_CHAKRA_WEBHOOK_URL ||
  DEFAULT_CHAKRA_PASSTHROUGH_WEBHOOK_URL
).trim();

// WhatsApp Master Templates Definitions
const KEDY_MASTER_TEMPLATES = [
  {
    name: 'kedy_randevu_onay',
    category: 'UTILITY',
    eventType: 'CONFIRMATION',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{1}}, {{2}} tarihindeki {{3}} randevunuz başarıyla oluşturulmuştur. Görüşmek üzere!',
        example: { body_text: [['Müşteri', '14 Nisan 15:30', 'Saç Kesimi']] }
      }
    ]
  },
  {
    name: 'kedy_randevu_hatirlatma',
    category: 'UTILITY',
    eventType: 'REMINDER',
    components: [
      {
        type: 'BODY',
        text: 'Hatırlatma: Merhaba {{1}}, yarın saat {{2}}\'de {{3}} randevunuz bulunmaktadır. Sizi bekliyoruz.',
        example: { body_text: [['Müşteri', '15:30', 'Saç Kesimi']] }
      }
    ]
  },
  {
    name: 'kedy_randevu_iptal',
    category: 'UTILITY',
    eventType: 'CANCELLATION',
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{1}}, {{2}} tarihindeki randevunuz iptal edilmiştir. Yeni bir randevu için dilediğiniz zaman bize ulaşabilirsiniz.',
        example: { body_text: [['Müşteri', '14 Nisan 15:30']] }
      }
    ]
  },
  {
    name: 'kedy_dogrulama_kodu',
    category: 'AUTHENTICATION',
    eventType: 'SATISFACTION_SURVEY', // Used for OTP in some contexts
    components: [
      {
        type: 'BODY',
        text: 'Kedy doğrulama kodunuz: {{1}}. Güvenliğiniz için bu kodu kimseyle paylaşmayın.',
        example: { body_text: [['123456']] }
      }
    ]
  },
  {
    name: 'kedy_waitlist_teklifi',
    category: 'UTILITY',
    eventType: 'SATISFACTION_SURVEY', // Map to a specific event type if available, otherwise generic
    components: [
      {
        type: 'BODY',
        text: 'Merhaba {{1}}, beklediğiniz {{2}} için yer açıldı! Randevu oluşturmak için hemen bize ulaşabilirsiniz.',
        example: { body_text: [['Müşteri', 'Saç Kesimi']] }
      }
    ]
  }
];

type ConnectIntent = 'CONNECT' | 'REPLACE_CONNECTION';

function parseConnectIntent(value: unknown): ConnectIntent {
  return typeof value === 'string' && value.trim().toUpperCase() === 'REPLACE_CONNECTION'
    ? 'REPLACE_CONNECTION'
    : 'CONNECT';
}

function isPluginNotFoundError(error: any): boolean {
  const errors = error?.response?.data?._errors;
  if (Array.isArray(errors) && errors.some((item) => typeof item === 'string' && /plugin/i.test(item) && /not found/i.test(item))) {
    return true;
  }

  const message =
    (typeof error?.response?.data?.message === 'string' ? error.response.data.message : '') ||
    (typeof error?.message === 'string' ? error.message : '');

  return /plugin/i.test(message) && /not found/i.test(message);
}

function getSalonIdFromUser(req: any): number | null {
  return req?.user?.salonId && Number.isInteger(req.user.salonId) ? req.user.salonId : null;
}

function sanitizePluginName(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
  return normalized.slice(0, 48) || 'kedyapp-salon';
}

function isConnectSuccessEvent(event: unknown, data: unknown): boolean {
  const eventText = typeof event === 'string' ? event.toLowerCase() : '';
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, any>) : null;
  const dataStatus = typeof dataObj?.status === 'string' ? dataObj.status.toLowerCase() : '';
  const dataState = typeof dataObj?.state === 'string' ? dataObj.state.toLowerCase() : '';
  const hasAuth = Boolean(dataObj?.auth && typeof dataObj.auth === 'object');
  const hasEnabledNumbers =
    Array.isArray(dataObj?.serverConfig?.enabledWhatsappPhoneNumbers) &&
    dataObj.serverConfig.enabledWhatsappPhoneNumbers.some(
      (value: unknown) => typeof value === 'string' && value.trim().length > 0,
    );

  const successPattern = /(connected|linked|success|complete|completed)/i;
  return (
    successPattern.test(eventText) ||
    successPattern.test(dataStatus) ||
    successPattern.test(dataState) ||
    hasAuth ||
    hasEnabledNumbers
  );
}

async function getAuthenticatedSalon(req: any) {
  const salonId = getSalonIdFromUser(req);
  if (!salonId) {
    return null;
  }

  return prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      name: true,
      slug: true,
      chakraPluginId: true,
      chakraPhoneNumberId: true,
      aiAgentSettings: {
        select: {
          faqAnswers: true,
        },
      },
    },
  });
}

async function createPluginForSalon(salon: { id: number; name: string; slug: string | null }) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const pluginNameSeed = salon.slug || salon.name || `salon-${salon.id}`;
  const pluginResponse = await axios.post(
    `${CHAKRA_API_BASE}/plugin`,
    {
      type: 'whatsapp',
      name: sanitizePluginName(pluginNameSeed),
    },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const pluginId = pluginResponse?.data?._data?.id;
  if (!pluginId || typeof pluginId !== 'string') {
    throw new Error('No pluginId returned from Chakra.');
  }

  await prisma.salon.update({
    where: { id: salon.id },
    data: { chakraPluginId: pluginId, chakraPhoneNumberId: null },
  });

  await ensurePluginWebhookConfigured(pluginId);

  return pluginId;
}

async function createConnectToken(pluginId: string) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const tokenResponse = await axios.post(
    `${CHAKRA_API_BASE}/v1/ext/whatsapp-partner/create-connect-token`,
    { pluginId },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const connectToken = tokenResponse?.data?._data?.connectToken;
  if (!!connectToken && typeof connectToken === 'string') {
    return connectToken;
  }

  throw new Error('No connectToken returned from Chakra.');
}

async function syncAndEnsureMasterTemplates(salonId: number, pluginId: string) {
  if (!CHAKRA_API_TOKEN) return;

  try {
    const response = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}/whatsapp-templates`, {
      headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` },
    });

    const externalTemplates = response?.data?._data || [];

    for (const master of KEDY_MASTER_TEMPLATES) {
      const match = externalTemplates.find((ext: any) => ext.name === master.name);
      
      const bodyComponent = master.components.find(c => c.type === 'BODY');
      
      await prisma.salonMessageTemplate.upsert({
        where: {
          salonId_eventType_locale: {
            salonId,
            eventType: master.eventType as any,
            locale: 'tr',
          }
        },
        update: {
          templateName: master.name,
          templateContent: bodyComponent?.text,
          externalId: match?.id,
          metaCategory: match?.category || master.category,
          metaStatus: match?.status || 'PENDING_SUBMISSION',
          lastSyncAt: new Date(),
        },
        create: {
          salonId,
          eventType: master.eventType as any,
          locale: 'tr',
          templateName: master.name,
          templateContent: bodyComponent?.text,
          externalId: match?.id,
          metaCategory: match?.category || master.category,
          metaStatus: match?.status || 'PENDING_SUBMISSION',
          lastSyncAt: new Date(),
        }
      });

      if (!match) {
        console.log(`Submitting master template ${master.name} for salon ${salonId}`);
        await axios.post(
          `${CHAKRA_API_BASE}/plugin/${pluginId}/whatsapp-templates`,
          {
            name: master.name,
            category: master.category,
            language: 'tr',
            components: master.components,
          },
          { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } }
        ).catch(err => {
          console.error(`Submission failed for ${master.name}:`, err?.response?.data || err.message);
        });
      }
    }
  } catch (error) {
    console.error('syncAndEnsureMasterTemplates failed:', error);
  }
}

async function fetchPluginState(pluginId: string) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const response = await axios.get(`${CHAKRA_API_BASE}/plugin/${pluginId}`, {
    headers: {
      Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout: 20000,
  });

  const pluginData = response?.data?._data;
  if (!pluginData || typeof pluginData !== 'object') {
    throw new Error('Invalid plugin state response from Chakra.');
  }

  return pluginData as Record<string, any>;
}

function normalizeEnabledWhatsappPhoneNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function updatePluginServerConfig(pluginId: string, serverConfig: Record<string, any>) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const response = await axios.put(
    `${CHAKRA_API_BASE}/plugin/${pluginId}`,
    {
      pluginId,
      serverConfig,
    },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const pluginData = response?.data?._data;
  if (!pluginData || typeof pluginData !== 'object') {
    throw new Error('Invalid plugin serverConfig response from Chakra.');
  }

  return pluginData as Record<string, any>;
}

function sameStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

async function ensurePluginWebhookConfigured(pluginId: string, preferredPhoneNumberId?: string | null) {
  const webhookUrl = CHAKRA_PASSTHROUGH_WEBHOOK_URL;
  if (!webhookUrl) {
    return fetchPluginState(pluginId);
  }

  const currentPlugin = await fetchPluginState(pluginId);
  const currentServerConfig =
    currentPlugin?.serverConfig && typeof currentPlugin.serverConfig === 'object' && !Array.isArray(currentPlugin.serverConfig)
      ? (currentPlugin.serverConfig as Record<string, any>)
      : {};

  const currentEnabled = normalizeEnabledWhatsappPhoneNumbers(currentServerConfig.enabledWhatsappPhoneNumbers);
  const desiredEnabled = preferredPhoneNumberId ? [preferredPhoneNumberId] : currentEnabled;

  const nextServerConfig: Record<string, any> = {
    ...currentServerConfig,
    passThroughWebhookUrl: webhookUrl,
  };
  if (desiredEnabled.length > 0) {
    nextServerConfig.enabledWhatsappPhoneNumbers = desiredEnabled;
  }

  const webhookAlreadySet = currentServerConfig.passThroughWebhookUrl === webhookUrl;
  const enabledAlreadySet = desiredEnabled.length === 0 || sameStringArray(currentEnabled, desiredEnabled);

  if (webhookAlreadySet && enabledAlreadySet) {
    return currentPlugin;
  }

  return updatePluginServerConfig(pluginId, nextServerConfig);
}

function extractWhatsappPhoneNumberId(payload: any): string | null {
  const enabledNumbers = payload?.serverConfig?.enabledWhatsappPhoneNumbers;
  if (Array.isArray(enabledNumbers)) {
    const first = enabledNumbers.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (first) {
      return first.trim();
    }
  }

  const directPhoneId = payload?.phoneNumberId;
  if (typeof directPhoneId === 'string' && directPhoneId.trim().length > 0) {
    return directPhoneId.trim();
  }

  return null;
}

function normalizeFaqAnswers(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

async function upsertSalonAiAgentFaqAnswers(salonId: number, patch: Record<string, any>) {
  const existing = await prisma.salonAiAgentSettings.findUnique({
    where: { salonId },
    select: { id: true, faqAnswers: true },
  });

  if (!existing) {
    await prisma.salonAiAgentSettings.create({
      data: {
        salonId,
        faqAnswers: patch,
      },
    });
    return;
  }

  const current = normalizeFaqAnswers(existing.faqAnswers);
  const next: Record<string, any> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    next[key] = value;
  }

  await prisma.salonAiAgentSettings.update({
    where: { salonId },
    data: { faqAnswers: next },
  });
}

async function updateSalonChakraState(
  salonId: number,
  patch: {
    chakraPluginId?: string | null;
    chakraPhoneNumberId?: string | null;
  },
) {
  const normalizeExternalId = (value?: string | null): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const syncWhatsappChannelBinding = async (nextWhatsappPhoneNumberId: string | null) => {
    // Deactivate existing WhatsApp bindings for this salon first.
    await prisma.salonChannelBinding.updateMany({
      where: { salonId, channel: 'WHATSAPP' },
      data: { isActive: false },
    });

    if (!nextWhatsappPhoneNumberId) return;

    await prisma.salonChannelBinding.upsert({
      where: {
        channel_externalAccountId: {
          channel: 'WHATSAPP',
          externalAccountId: nextWhatsappPhoneNumberId,
        },
      },
      update: {
        salonId,
        isActive: true,
      },
      create: {
        salonId,
        channel: 'WHATSAPP',
        externalAccountId: nextWhatsappPhoneNumberId,
        isActive: true,
      },
    });
  };

  const data: Record<string, any> = {};
  let shouldSyncWhatsappBinding = false;
  let nextWhatsappPhoneNumberId: string | null = null;

  if (patch.chakraPluginId !== undefined) {
    data.chakraPluginId = patch.chakraPluginId;
  }

  if (patch.chakraPhoneNumberId !== undefined) {
    nextWhatsappPhoneNumberId = normalizeExternalId(patch.chakraPhoneNumberId);
    data.chakraPhoneNumberId = nextWhatsappPhoneNumberId;
    shouldSyncWhatsappBinding = true;
  }

  if (Object.keys(data).length > 0) {
    await prisma.salon.update({
      where: { id: salonId },
      data,
    });
  }

  if (shouldSyncWhatsappBinding) {
    await syncWhatsappChannelBinding(nextWhatsappPhoneNumberId);
  }
}

async function setPluginActiveState(pluginId: string, isActive: boolean) {
  if (!CHAKRA_API_TOKEN) {
    throw new Error('CHAKRA_API_TOKEN missing.');
  }

  const response = await axios.put(
    `${CHAKRA_API_BASE}/plugin/${pluginId}`,
    { pluginId, isActive },
    {
      headers: {
        Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    },
  );

  const pluginData = response?.data?._data;
  if (!pluginData || typeof pluginData !== 'object') {
    throw new Error('Invalid plugin state response from Chakra.');
  }

  return pluginData as Record<string, any>;
}

// Explicit plugin creation route
router.post('/create-plugin', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    if (salon.chakraPluginId) {
      return res.status(200).json({
        success: true,
        pluginId: salon.chakraPluginId,
        salonId: salon.id,
        pluginCreated: false,
      });
    }

    const pluginId = await createPluginForSalon({
      id: salon.id,
      name: salon.name,
      slug: salon.slug,
    });

    return res.status(200).json({
      success: true,
      pluginId,
      salonId: salon.id,
      pluginCreated: true,
    });
  } catch (error: any) {
    console.error('Create plugin failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Create plugin failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// Return current plugin state for UI
router.get('/status', authenticateToken, async (req: any, res: any) => {
  try {
    let salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const faqAnswers = normalizeFaqAnswers(salon.aiAgentSettings?.faqAnswers);
    let pluginActive = Boolean(faqAnswers.whatsappPluginActive);
    let whatsappPhoneNumberId =
      typeof salon.chakraPhoneNumberId === 'string' && salon.chakraPhoneNumberId.trim().length > 0
        ? salon.chakraPhoneNumberId.trim()
        : typeof faqAnswers.whatsappPhoneNumberId === 'string' && faqAnswers.whatsappPhoneNumberId.trim().length > 0
          ? faqAnswers.whatsappPhoneNumberId.trim()
          : null;
    let liveHasAuth = false;
    let liveHasEnabledPhone = false;

    if (salon.chakraPluginId && CHAKRA_API_TOKEN) {
      try {
        const livePluginState = await fetchPluginState(salon.chakraPluginId);
        const liveActive = Boolean(livePluginState.isActive);
        const liveWhatsappPhoneNumberId = extractWhatsappPhoneNumberId(livePluginState);
        liveHasAuth = Boolean(livePluginState?.auth && typeof livePluginState.auth === 'object');
        liveHasEnabledPhone = Boolean(liveWhatsappPhoneNumberId);

        const shouldSyncAnswers =
          liveActive !== pluginActive ||
          (liveWhatsappPhoneNumberId || null) !== (whatsappPhoneNumberId || null);

        pluginActive = liveActive;
        whatsappPhoneNumberId = liveWhatsappPhoneNumberId || whatsappPhoneNumberId;

        if (shouldSyncAnswers) {
          await updateSalonChakraState(salon.id, {
            chakraPhoneNumberId: liveWhatsappPhoneNumberId || whatsappPhoneNumberId || null,
          });
          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: pluginActive,
            whatsappPhoneNumberId,
            whatsappConnectedAt: pluginActive ? new Date().toISOString() : null,
          });
        }
      } catch (liveStatusError: any) {
        if (isPluginNotFoundError(liveStatusError)) {
          await updateSalonChakraState(salon.id, {
            chakraPluginId: null,
            chakraPhoneNumberId: null,
          });
          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: false,
            whatsappPhoneNumberId: null,
            whatsappConnectedAt: null,
          });

          salon = (await getAuthenticatedSalon(req)) as NonNullable<Awaited<ReturnType<typeof getAuthenticatedSalon>>>;
          pluginActive = false;
          whatsappPhoneNumberId = null;
        } else {
          console.warn('Chakra live status fetch failed:', liveStatusError?.response?.data || liveStatusError?.message || liveStatusError);
        }
      }
    }

    const hasConnectionSignal =
      Boolean(whatsappPhoneNumberId) || liveHasAuth || liveHasEnabledPhone;

    // ÖNEMLİ: status endpoint'i plugin active state'ini mutate etmez.
    // Böylece paneldeki aktif/pasif toggle kullanıcının verdiği değeri korur.
    const connected = Boolean(salon.chakraPluginId) && (pluginActive || hasConnectionSignal);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json({
      salonId: salon.id,
      salonName: salon.name,
      slug: salon.slug,
      pluginId: salon.chakraPluginId,
      hasPlugin: Boolean(salon.chakraPluginId),
      connected,
      isActive: pluginActive,
      whatsappPhoneNumberId,
      sdkUrl: CHAKRA_SDK_URL,
    });
  } catch (error: any) {
    console.error('Chakra status failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Chakra status failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// Connect token route (uses saved pluginId)
router.get('/connect-token', authenticateToken, async (req: any, res: any) => {
  try {
    const intent = parseConnectIntent(req.query?.intent);
    let salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    let pluginId = salon.chakraPluginId;

    if (!pluginId) {
      pluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });
      salon = (await getAuthenticatedSalon(req)) as NonNullable<Awaited<ReturnType<typeof getAuthenticatedSalon>>>;
    }

    await ensurePluginWebhookConfigured(pluginId);

    let connectToken: string;
    try {
      connectToken = await createConnectToken(pluginId);
    } catch (tokenError: any) {
      if (!isPluginNotFoundError(tokenError)) {
        throw tokenError;
      }

      await updateSalonChakraState(salon.id, {
        chakraPluginId: null,
        chakraPhoneNumberId: null,
      });

      const recreatedPluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });

      pluginId = recreatedPluginId;
      await ensurePluginWebhookConfigured(pluginId);
      connectToken = await createConnectToken(pluginId);
    }

    return res.status(200).json({
      connectToken,
      pluginId,
      sdkUrl: CHAKRA_SDK_URL,
      intent,
    });
  } catch (error: any) {
    console.error('Token generation failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Token generation failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// Capture popup/sdk response and echo normalized connection state
router.post('/connect-event', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const event = req.body?.event;
    const data = req.body?.data;
    const intent = parseConnectIntent(req.body?.intent);
    const pluginIdFromClient =
      typeof req.body?.pluginId === 'string' && req.body.pluginId.trim() ? req.body.pluginId.trim() : null;
    const pluginId = pluginIdFromClient || salon.chakraPluginId || null;

    if (!pluginId) {
      return res.status(400).json({ message: 'Plugin id is missing.' });
    }
    if (salon.chakraPluginId && pluginId !== salon.chakraPluginId) {
      return res.status(403).json({ message: 'Plugin does not match salon scope.' });
    }

    let connected = isConnectSuccessEvent(event, data);
    let pluginState: Record<string, any> | null = null;
    let whatsappPhoneNumberId: string | null = null;
    const oldPhoneNumberId =
      typeof salon.chakraPhoneNumberId === 'string' && salon.chakraPhoneNumberId.trim().length > 0
        ? salon.chakraPhoneNumberId.trim()
        : null;

    if (!salon.chakraPluginId) {
      await updateSalonChakraState(salon.id, {
        chakraPluginId: pluginId,
      });
    }

    if (connected) {
      pluginState = await setPluginActiveState(pluginId, true);
      whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || extractWhatsappPhoneNumberId(data);
      pluginState = await ensurePluginWebhookConfigured(pluginId, whatsappPhoneNumberId);
      whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || whatsappPhoneNumberId;

      await updateSalonChakraState(salon.id, {
        chakraPhoneNumberId: whatsappPhoneNumberId,
      });

      await upsertSalonAiAgentFaqAnswers(salon.id, {
        whatsappPluginActive: true,
        whatsappPhoneNumberId,
        whatsappConnectedAt: new Date().toISOString(),
      });

      // SYNC MASTER TEMPLATES ON SUCCESS
      await syncAndEnsureMasterTemplates(salon.id, pluginId).catch(err => {
        console.error('Initial template sync failed:', err);
      });
    } else if (CHAKRA_API_TOKEN) {
      // Popup event adı beklediğimiz formatta gelmese bile canlı plugin durumundan doğrulayalım.
      try {
        const livePluginState = await fetchPluginState(pluginId);
        const liveHasAuth = Boolean(livePluginState?.auth && typeof livePluginState.auth === 'object');
        const livePhoneId = extractWhatsappPhoneNumberId(livePluginState);
        if (liveHasAuth || livePhoneId) {
          pluginState = await setPluginActiveState(pluginId, true);
          whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || livePhoneId || null;
          pluginState = await ensurePluginWebhookConfigured(pluginId, whatsappPhoneNumberId);
          whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || whatsappPhoneNumberId;
          connected = true;

          await updateSalonChakraState(salon.id, {
            chakraPhoneNumberId: whatsappPhoneNumberId,
          });

          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: true,
            whatsappPhoneNumberId,
            whatsappConnectedAt: new Date().toISOString(),
          });

          // SYNC MASTER TEMPLATES ON SUCCESS (Live Check)
          await syncAndEnsureMasterTemplates(salon.id, pluginId).catch(err => {
            console.error('Initial template sync (live) failed:', err);
          });
        }
      } catch (liveCheckError: any) {
        console.warn('Connect-event live check failed:', liveCheckError?.response?.data || liveCheckError?.message || liveCheckError);
      }
    }

    if (
      connected &&
      intent === 'REPLACE_CONNECTION' &&
      oldPhoneNumberId &&
      whatsappPhoneNumberId &&
      oldPhoneNumberId !== whatsappPhoneNumberId
    ) {
      await writeAccessAudit({
        salonId: salon.id,
        actorUserId: Number.isInteger(req?.user?.userId) ? Number(req.user.userId) : null,
        action: 'channel_identity_replaced',
        targetType: 'WHATSAPP',
        targetId: whatsappPhoneNumberId,
        metadata: {
          intent,
          oldId: oldPhoneNumberId,
          newId: whatsappPhoneNumberId,
          pluginId,
          changedAt: new Date().toISOString(),
        },
      });
    }

    console.log('Chakra connect event', {
      salonId: salon.id,
      pluginId,
      event,
      data,
      connected,
      whatsappPhoneNumberId,
      intent,
    });

    return res.status(200).json({
      ok: true,
      pluginId,
      connected,
      isActive: connected ? true : null,
      whatsappPhoneNumberId,
      pluginState,
      event: typeof event === 'string' ? event : null,
      intent,
    });
  } catch (error: any) {
    console.error('Connect event capture failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Connect event capture failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// Toggle plugin active/passive state explicitly from panel
router.put('/plugin-active', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    const bodyPluginId = typeof req.body?.pluginId === 'string' ? req.body.pluginId.trim() : '';
    const pluginId = bodyPluginId || salon.chakraPluginId || '';
    const isActive = req.body?.isActive;

    if (!pluginId) {
      return res.status(400).json({ message: 'Plugin id is missing.' });
    }
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be boolean.' });
    }
    if (salon.chakraPluginId && pluginId !== salon.chakraPluginId) {
      return res.status(403).json({ message: 'Plugin does not match salon scope.' });
    }

    if (!salon.chakraPluginId) {
      await updateSalonChakraState(salon.id, {
        chakraPluginId: pluginId,
      });
    }

    const pluginState = await setPluginActiveState(pluginId, isActive);

    // Chakra tarafında state değişimi bazen gecikmeli yansıyabildiği için
    // canlı plugin state'i okuyup doğruluyoruz.
    let verifiedState = pluginState;
    try {
      verifiedState = await fetchPluginState(pluginId);
      if (Boolean(verifiedState?.isActive) !== isActive) {
        // Bir kez daha dene (eventual consistency)
        await setPluginActiveState(pluginId, isActive);
        verifiedState = await fetchPluginState(pluginId);
      }
    } catch (verifyError: any) {
      console.warn('Plugin active verify failed:', verifyError?.response?.data || verifyError?.message || verifyError);
    }

    const finalIsActive = Boolean(verifiedState?.isActive);
    const whatsappPhoneNumberId = extractWhatsappPhoneNumberId(verifiedState);
    const webhookSyncedState = await ensurePluginWebhookConfigured(pluginId, whatsappPhoneNumberId);
    const syncedWhatsappPhoneNumberId =
      extractWhatsappPhoneNumberId(webhookSyncedState) || whatsappPhoneNumberId || salon.chakraPhoneNumberId || null;

    await updateSalonChakraState(salon.id, {
      chakraPhoneNumberId: syncedWhatsappPhoneNumberId,
    });

    await upsertSalonAiAgentFaqAnswers(salon.id, {
      whatsappPluginActive: finalIsActive,
      whatsappPhoneNumberId: syncedWhatsappPhoneNumberId,
      whatsappConnectedAt: finalIsActive ? new Date().toISOString() : null,
    });

    return res.status(200).json({
      ok: true,
      pluginId,
      requestedIsActive: isActive,
      isActive: finalIsActive,
      whatsappPhoneNumberId: syncedWhatsappPhoneNumberId,
      pluginState: webhookSyncedState,
    });
  } catch (error: any) {
    console.error('Plugin active toggle failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Plugin active toggle failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// One-shot flow: create plugin (if missing) + create connect token
router.post('/setup-connect', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    let pluginId = salon.chakraPluginId;
    let pluginCreated = false;

    if (!pluginId) {
      pluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });
      pluginCreated = true;
    }

    await ensurePluginWebhookConfigured(pluginId);

    const connectToken = await createConnectToken(pluginId);

    return res.status(200).json({
      salonId: salon.id,
      pluginId,
      pluginCreated,
      connectToken,
      sdkUrl: CHAKRA_SDK_URL,
      containerId: 'chakra-whatsapp-connect-container',
    });
  } catch (error: any) {
    console.error('Setup connect failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Setup connect failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// Template routes
router.get('/templates', authenticateToken, async (req: any, res: any) => {
  try {
    const salonId = getSalonIdFromUser(req);
    if (!salonId) return res.status(401).json({ message: 'Unauthorized' });

    const templates = await prisma.salonMessageTemplate.findMany({
      where: { salonId },
      orderBy: { eventType: 'asc' }
    });

    return res.status(200).json({ templates });
  } catch (error: any) {
    return res.status(500).json({ message: 'Failed to fetch templates' });
  }
});

router.post('/templates/sync', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon || !salon.chakraPluginId) return res.status(400).json({ message: 'WhatsApp not connected' });

    await syncAndEnsureMasterTemplates(salon.id, salon.chakraPluginId);
    
    const templates = await prisma.salonMessageTemplate.findMany({
      where: { salonId: salon.id }
    });

    return res.status(200).json({ templates });
  } catch (error: any) {
    return res.status(500).json({ message: 'Sync failed' });
  }
});

router.post('/templates/:templateId/appeal', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon || !salon.chakraPluginId) return res.status(400).json({ message: 'WhatsApp not connected' });

    const { templateId } = req.params;
    const template = await prisma.salonMessageTemplate.findFirst({
      where: { id: parseInt(templateId), salonId: salon.id }
    });

    if (!template || !template.templateName) return res.status(404).json({ message: 'Template not found' });

    // Look up the master config
    const master = KEDY_MASTER_TEMPLATES.find(m => m.name === template.templateName);
    if (!master) return res.status(400).json({ message: 'Not a master template' });

    // Re-submit with original category as a way to "appeal/force"
    await axios.post(
      `${CHAKRA_API_BASE}/plugin/${salon.chakraPluginId}/whatsapp-templates`,
      {
        name: master.name,
        category: master.category,
        language: 'tr',
        components: master.components,
      },
      { headers: { Authorization: `Bearer ${CHAKRA_API_TOKEN}` } }
    );

    await prisma.salonMessageTemplate.update({
      where: { id: template.id },
      data: { metaStatus: 'APPEALED', lastSyncAt: new Date() }
    });

    return res.status(200).json({ message: 'Appeal submitted' });
  } catch (error: any) {
    console.error('Appeal failed:', error?.response?.data || error);
    return res.status(500).json({ message: 'Appeal failed' });
  }
});

export default router;
