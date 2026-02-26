import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';

const router = Router();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

router.get('/connect-token', async (req: any, res: any) => {
  let salon = req.salon;

  // Fallback to Palm Beauty (ID: 1) if no salon context found (for testing on api.kedyapp.com)
  if (!salon) {
    console.log('No salon context found, falling back to ID 1 for testing.');
    salon = await prisma.salon.findUnique({ where: { id: 1 } });
  }

  if (!salon) {
    return res.status(400).json({ message: 'Salon context missing and fallback failed.' });
  }

  if (!CHAKRA_API_TOKEN) {
    return res.status(500).json({ message: 'CHAKRA_API_TOKEN not configured.' });
  }

  try {
    let pluginId = salon.chakraPluginId;

    // 1. Create plugin if it doesn't exist
    if (!pluginId) {
      console.log(`Creating Chakra plugin for salon: ${salon.name}`);
      const pluginResponse = await axios.post(
        `${CHAKRA_API_BASE}/plugin`,
        {
          type: 'whatsapp',
          name: `${salon.name} - WhatsApp`,
        },
        {
          headers: {
            Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Chakra returns data inside _data property
      pluginId = pluginResponse.data._data?.id;

      if (!pluginId) {
          throw new Error('Chakra API did not return a valid plugin ID in _data.');
      }

      // Update salon record
      await prisma.salon.update({
        where: { id: salon.id },
        data: { chakraPluginId: pluginId },
      });
      console.log(`Saved chakraPluginId ${pluginId} for salon ${salon.id}`);
    }

    // 2. Generate connect token
    console.log(`Generating connect token for pluginId: ${pluginId}`);
    const tokenResponse = await axios.post(
      `${CHAKRA_API_BASE}/v1/ext/whatsapp-partner/create-connect-token`,
      { pluginId },
      {
        headers: {
          Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Chakra returns data inside _data property
    const connectToken = tokenResponse.data._data?.connectToken;
    
    if (!connectToken) {
        throw new Error('Chakra API did not return a valid connectToken in _data.');
    }

    res.json({ connectToken });
  } catch (error: any) {
    console.error('Chakra Integration Error:', error.response?.data || error.message);
    res.status(500).json({
      message: 'Failed to integrate with Chakra.',
      error: error.response?.data || error.message,
    });
  }
});

export default router;
