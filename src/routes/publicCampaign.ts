/**
 * Public Kurucu Salon kampanya sayaç endpoint'i.
 *
 * Frontend (marketing site + kayıt akışı) canlı tier doluluk durumunu
 * gösterir: "tier1 30/50 dolu, tier2 0/50, ..." gibi. Bu endpoint:
 *   - Auth gerektirmez (marketing sayfası anonim ziyaretçilere gösterir).
 *   - 30 saniye edge cache header'ı set eder (sayaç çok sık değişmez,
 *     DB'yi her sayfa yüklemesinde dövmek gereksiz).
 *   - Salon tablosunda tek MAX() sorgusu — n^2 değil.
 *
 * Mount: server.ts'de /api/public altında. Tenant middleware'inden ÖNCE
 * gelmeli çünkü tenant resolution salon scope gerektirir; bu endpoint
 * global.
 */

import { Router } from 'express';
import { getCampaignCounters } from '../services/campaignTier.js';

const router = Router();

router.get('/campaign-counters', async (_req: any, res: any) => {
  const data = await getCampaignCounters();
  res.set('Cache-Control', 'public, max-age=30');
  return res.status(200).json(data);
});

export default router;
