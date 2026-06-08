import { Router } from 'express';
import { prisma } from '../prisma.js';
import type { ChannelType } from '@prisma/client';

/**
 * GET /api/internal/agent/ai-active?salonId=123&channel=WHATSAPP
 *
 * n8n ai_agent workflow'u her gelen mesajda bunu çağırır: bu salon + kanal için
 * yapay zeka asistanı AÇIK mı? `aiActive: false` ise n8n agent'i çalıştırmaz
 * (otomatik yanıt vermez). Böylece "AI Aktif" kararı dinamik backend'de tutulur,
 * n8n graph'ına gömülmez.
 *
 * Güvenli varsayılan: kanal bağlaması yoksa veya hata olursa aiActive = true
 * (yanlışlıkla sessiz kalma riskinden kaçın).
 */
const router = Router();

function parseChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const u = value.trim().toUpperCase();
  return u === 'WHATSAPP' || u === 'INSTAGRAM' ? (u as ChannelType) : null;
}

router.get('/ai-active', async (req: any, res: any) => {
  const salonId = Number(req.query?.salonId);
  const channel = parseChannel(req.query?.channel);
  if (!Number.isInteger(salonId) || salonId <= 0) {
    return res.status(400).json({ ok: false, error: 'salonId_required' });
  }
  try {
    let aiActive = true;
    if (channel) {
      const binding = await prisma.salonChannelBinding.findFirst({
        where: { salonId, channel },
        select: { aiEnabled: true },
        orderBy: { id: 'desc' },
      });
      if (binding && binding.aiEnabled === false) aiActive = false;
    }
    return res.json({ ok: true, aiActive });
  } catch (err: any) {
    console.error('[internalAgent.ai-active] failed', err);
    return res.status(200).json({ ok: true, aiActive: true });
  }
});

export default router;
