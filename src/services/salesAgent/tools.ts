import { z } from 'zod';
import { tool } from 'ai';
import { getCampaignCounters } from '../campaignTier.js';

const REG_BASE = (
  process.env.LEAD_ACTIVATION_BASE_URL ||
  process.env.VERIFICATION_BASE_URL_KEDY ||
  'https://kedyapp.com'
)
  .trim()
  .replace(/\/+$/, '');

export function buildSalesTools(opts: { onHandover?: (reason: string) => void } = {}) {
  return {
    get_current_pricing: tool({
      description:
        'Canlı Kurucu Salon kampanya fiyatını ve açık kademeyi öğren. Fiyat/kademe sorusu gelince ÇAĞIRILMALI.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const counters = await getCampaignCounters();
          const active = counters.tiers.find((t) => t.active) ?? null;
          if (!active) {
            return {
              kampanya: 'bitti',
              mesaj: 'Kurucu Salon kampanyası dolmuş. Standart fiyat 1.999 TL/ay.',
            };
          }
          return {
            kampanya: 'aktif',
            fiyat: active.monthlyAmount,
            yillikFiyat: active.annualAmount,
            kalanYer: active.remaining,
            mesaj: `Şu an Kurucu Salon kampanyası açık: Aylık ${active.monthlyAmount} TL. Yıllık ödersen ${active.annualAmount} TL (2 ay bedava). Kampanyada ${active.remaining} yer kalmış.`,
          };
        } catch {
          return { hata: 'Fiyat bilgisi şu an alınamadı.' };
        }
      },
    }),

    send_trial_link: tool({
      description:
        'Salon sahibini 30 günlük ücretsiz denemeye yönlendir. Kayıt/deneme niyeti net göründüğünde çağır.',
      inputSchema: z.object({}),
      execute: async () => {
        const url = `${REG_BASE}/kayit?utm_source=whatsapp-agent&utm_medium=chat&utm_campaign=sales-bot`;
        return {
          kayitLinki: url,
          mesaj: '30 günlük ücretsiz deneme sayfanız hazır — kart bilgisi istemiyoruz, taahhüt yok.',
        };
      },
    }),

    request_handover: tool({
      description:
        'Ekibimizin devralması gerektiğinde çağır: cevaplayamadığın, kapsam dışı veya hassas soru.',
      inputSchema: z.object({
        sebep: z.string().describe('Kısa devir sebebi — ekip neden devralıyor?'),
      }),
      execute: async ({ sebep }: { sebep: string }) => {
        opts.onHandover?.(sebep);
        return { aktarildi: true };
      },
    }),
  };
}
