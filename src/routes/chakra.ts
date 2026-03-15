import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

const CHAKRA_SDK_URL = 'https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js';

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
    data: { chakraPluginId: pluginId },
  });

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
  if (!connectToken || typeof connectToken !== 'string') {
    throw new Error('No connectToken returned from Chakra.');
  }

  return connectToken;
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
      typeof faqAnswers.whatsappPhoneNumberId === 'string' && faqAnswers.whatsappPhoneNumberId.trim().length > 0
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
          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: pluginActive,
            whatsappPhoneNumberId,
            whatsappConnectedAt: pluginActive ? new Date().toISOString() : null,
          });
        }
      } catch (liveStatusError: any) {
        if (isPluginNotFoundError(liveStatusError)) {
          await prisma.salon.update({
            where: { id: salon.id },
            data: { chakraPluginId: null },
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

    if (salon.chakraPluginId && CHAKRA_API_TOKEN && !pluginActive && hasConnectionSignal) {
      try {
        const activatedState = await setPluginActiveState(salon.chakraPluginId, true);
        pluginActive = Boolean(activatedState?.isActive);
        whatsappPhoneNumberId = extractWhatsappPhoneNumberId(activatedState) || whatsappPhoneNumberId;

        await upsertSalonAiAgentFaqAnswers(salon.id, {
          whatsappPluginActive: pluginActive,
          whatsappPhoneNumberId,
          whatsappConnectedAt: new Date().toISOString(),
        });
      } catch (activationError: any) {
        console.warn('Chakra plugin auto-activation failed:', activationError?.response?.data || activationError?.message || activationError);
      }
    }

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

    let connectToken: string;
    try {
      connectToken = await createConnectToken(pluginId);
    } catch (tokenError: any) {
      if (!isPluginNotFoundError(tokenError)) {
        throw tokenError;
      }

      await prisma.salon.update({
        where: { id: salon.id },
        data: { chakraPluginId: null },
      });

      const recreatedPluginId = await createPluginForSalon({
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
      });

      pluginId = recreatedPluginId;
      connectToken = await createConnectToken(pluginId);
    }

    return res.status(200).json({
      connectToken,
      pluginId,
      sdkUrl: CHAKRA_SDK_URL,
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

    if (!salon.chakraPluginId) {
      await prisma.salon.update({
        where: { id: salon.id },
        data: { chakraPluginId: pluginId },
      });
    }

    if (connected) {
      pluginState = await setPluginActiveState(pluginId, true);
      whatsappPhoneNumberId = extractWhatsappPhoneNumberId(pluginState) || extractWhatsappPhoneNumberId(data);

      await upsertSalonAiAgentFaqAnswers(salon.id, {
        whatsappPluginActive: true,
        whatsappPhoneNumberId,
        whatsappConnectedAt: new Date().toISOString(),
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
          connected = true;

          await upsertSalonAiAgentFaqAnswers(salon.id, {
            whatsappPluginActive: true,
            whatsappPhoneNumberId,
            whatsappConnectedAt: new Date().toISOString(),
          });
        }
      } catch (liveCheckError: any) {
        console.warn('Connect-event live check failed:', liveCheckError?.response?.data || liveCheckError?.message || liveCheckError);
      }
    }

    console.log('Chakra connect event', {
      salonId: salon.id,
      pluginId,
      event,
      data,
      connected,
      whatsappPhoneNumberId,
    });

    return res.status(200).json({
      ok: true,
      pluginId,
      connected,
      isActive: connected ? true : null,
      whatsappPhoneNumberId,
      pluginState,
      event: typeof event === 'string' ? event : null,
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
      await prisma.salon.update({
        where: { id: salon.id },
        data: { chakraPluginId: pluginId },
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
    const whatsappPhoneNumberId = finalIsActive ? extractWhatsappPhoneNumberId(verifiedState) : null;

    await upsertSalonAiAgentFaqAnswers(salon.id, {
      whatsappPluginActive: finalIsActive,
      whatsappPhoneNumberId,
      whatsappConnectedAt: finalIsActive ? new Date().toISOString() : null,
    });

    return res.status(200).json({
      ok: true,
      pluginId,
      requestedIsActive: isActive,
      isActive: finalIsActive,
      whatsappPhoneNumberId,
      pluginState: verifiedState,
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

export default router;
