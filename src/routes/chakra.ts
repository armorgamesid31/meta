import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

const CHAKRA_SDK_URL = 'https://embed.chakrahq.com/whatsapp-partner-connect/v1_0_1/sdk.js';

function getSalonIdFromUser(req: any): number | null {
  return req?.user?.salonId && Number.isInteger(req.user.salonId) ? req.user.salonId : null;
}

function sanitizePluginName(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-_]/g, '');
  return normalized.slice(0, 48) || 'kedyapp-salon';
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

// Explicit plugin creation route
router.post('/create-plugin', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
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
    });
  } catch (error: any) {
    console.error('Create plugin failed:', error?.response?.data || error);
    return res.status(500).json({
      message: 'Create plugin failed.',
      error: error?.response?.data || error?.message || 'Unknown error',
    });
  }
});

// Connect token route (uses saved pluginId)
router.get('/connect-token', authenticateToken, async (req: any, res: any) => {
  try {
    const salon = await getAuthenticatedSalon(req);
    if (!salon) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    if (!salon.chakraPluginId) {
      return res.status(400).json({ message: 'Salon does not have a pluginId yet. Create one first.' });
    }

    const connectToken = await createConnectToken(salon.chakraPluginId);
    return res.status(200).json({
      connectToken,
      pluginId: salon.chakraPluginId,
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
