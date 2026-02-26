import { Router } from 'express';
import { prisma } from '../prisma.js';
import axios from 'axios';

const router = Router();

const CHAKRA_API_BASE = 'https://api.chakrahq.com';
const CHAKRA_API_TOKEN = process.env.CHAKRA_API_TOKEN;

// Helper to get salon for testing
const getTestSalon = async (req: any) => {
    let salon = req.salon;
    if (!salon) {
        salon = await prisma.salon.findUnique({ where: { id: 1 } });
    }
    return salon;
};

// 1. Create Plugin Manually
router.post('/create-plugin', async (req: any, res: any) => {
    const salon = await getTestSalon(req);
    if (!salon) return res.status(400).json({ message: 'Salon not found.' });
    if (!CHAKRA_API_TOKEN) return res.status(500).json({ message: 'CHAKRA_API_TOKEN missing.' });

    try {
        const pluginResponse = await axios.post(
            `${CHAKRA_API_BASE}/plugin`,
            {
                type: 'whatsapp',
                name: `${salon.name} - WhatsApp Auto`,
            },
            {
                headers: {
                    Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const pluginId = pluginResponse.data._data?.id;
        if (!pluginId) throw new Error('No pluginId returned from Chakra.');

        await prisma.salon.update({
            where: { id: salon.id },
            data: { chakraPluginId: pluginId },
        });

        res.json({ success: true, pluginId, salonName: salon.name });
    } catch (error: any) {
        res.status(500).json({ message: 'Create plugin failed.', error: error.response?.data || error.message });
    }
});

// 2. Generate Connect Token Manually
router.get('/connect-token', async (req: any, res: any) => {
    const salon = await getTestSalon(req);
    if (!salon?.chakraPluginId) return res.status(400).json({ message: 'Salon does not have a pluginId yet. Create one first.' });

    try {
        const tokenResponse = await axios.post(
            `${CHAKRA_API_BASE}/v1/ext/whatsapp-partner/create-connect-token`,
            { pluginId: salon.chakraPluginId },
            {
                headers: {
                    Authorization: `Bearer ${CHAKRA_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const connectToken = tokenResponse.data._data?.connectToken;
        if (!connectToken) throw new Error('No connectToken returned from Chakra.');

        res.json({ connectToken, pluginId: salon.chakraPluginId });
    } catch (error: any) {
        res.status(500).json({ message: 'Token generation failed.', error: error.response?.data || error.message });
    }
});

export default router;
