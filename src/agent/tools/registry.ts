// Tool registry (W2 iskeleti). buildToolSet(ctx) her tur taze kurulur; ctx
// executor'lara closure'lanır. İKİ sınıf:
//  - READ tool'lar: taslakta da anında çalışır (yan-etki yok): prices/services/
//    campaigns/faq/customer-lookup/check-day-open. n8n'deki gömülü-SQL'ler
//    (services/prices gender-region türetme, faq jsonb merge) BURAYA portlanır.
//  - SIDE-EFFECTING tool'lar: taslakta niyet kaydeder, ÇALIŞTIRMAZ; nihai turda
//    (re-check bitince) işlenir → re-run güvenli: location/profile-edit/booking/
//    handover.
// TODO(W2): execute gövdelerini mevcut backend servislerine bağla (in-process,
//   HTTP yok). Bu dosya şu an deseni + tip güvenliğini kurar.

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import type { ToolContext } from '../types.js';

export function buildToolSet(ctx: ToolContext): ToolSet {
  // Yan-etkili tool yardımcısı: taslakta niyet kaydet + dön; değilse executor'ı çalıştır.
  const sideEffect = async (
    name: string,
    args: Record<string, unknown>,
    run: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> => {
    if (ctx.draft) {
      ctx.intents.push({ tool: name, args });
      return { prepared: true };
    }
    return run();
  };

  return {
    // ─── READ tool'ları (taslakta da çalışır) ─────────────────────────────
    get_prices: tool({
      description:
        'Müşteri bir hizmetin FİYATINI sorduğunda çağır. service_name ve varsa related_terms ver.',
      inputSchema: z.object({
        service_name: z.string().describe('Sorulan hizmet adı'),
        related_terms: z.string().optional().describe('Eşanlamlı/ilişkili terimler, virgülle'),
      }),
      execute: async (_args) => {
        // TODO(W2): n8n tool_get_prices SQL'ini port et (Service + gender/region türetme;
        //   related_terms regexp_split; ServiceGender/ServiceRegion EXISTS türetme).
        return { prices: [], _todo: 'W2_port_get_prices' };
      },
    }),

    get_campaigns: tool({
      description: 'Müşteri aktif KAMPANYA/fırsat/indirim sorduğunda çağır.',
      inputSchema: z.object({}),
      execute: async () => {
        // n8n tool_get_campaigns portu (temiz — raw SQL gerekmez).
        const now = new Date();
        const campaigns = await prisma.campaign.findMany({
          where: {
            salonId: ctx.salonId,
            isActive: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { name: true, description: true, type: true, config: true, startsAt: true, endsAt: true },
        });
        return { campaigns };
      },
    }),

    customer_lookup: tool({
      description:
        'Müşterinin kayıt durumu/geçmiş randevuları gerektiğinde çağır (selamlama/kişiselleştirme).',
      inputSchema: z.object({
        subject: z.string().optional().describe('Kanal subject (telefon/IGSID); yoksa boş'),
      }),
      execute: async (_args) => {
        // TODO(W2): internalAgent customer-lookup mantığını in-process çağır.
        return { found: false, _todo: 'W2_port_customer_lookup' };
      },
    }),

    check_day_open: tool({
      description:
        '"Bayramda/pazar açık mısınız" gibi GÜN-açık sorularında çağır. date_expression ver.',
      inputSchema: z.object({
        date_expression: z.string().describe('Doğal-dil gün ifadesi (örn. "kurban bayramı 2. gün")'),
      }),
      execute: async (_args) => {
        // TODO(W2): holidayCalendar + SalonClosure mantığını çağır.
        return { _todo: 'W2_port_check_day_open' };
      },
    }),

    // ─── SIDE-EFFECTING tool'lar (taslakta ertelenir) ─────────────────────
    request_location: tool({
      description:
        'Müşteri salonun KONUMUNU/ADRESİNİ sorduğunda ZORUNLU çağır. Konum butonu kullanıcıya gönderilir.',
      inputSchema: z.object({}),
      execute: async () =>
        sideEffect('request_location', {}, async () => {
          // TODO(W2): locationIntent — place_id cache + buton gönder (yan-etki).
          return { sent: true, _todo: 'W2_port_request_location' };
        }),
    }),

    request_profile_edit: tool({
      description:
        'Müşteri kendi bilgilerini (ad/numara/Instagram) değiştirmek istediğinde ZORUNLU çağır. Güvenli düzenleme bağlantısı gönderilir.',
      inputSchema: z.object({}),
      execute: async () =>
        sideEffect('request_profile_edit', {}, async () => {
          // TODO(W2): profileEdit — global kimlik çöz + portal token mint + buton gönder.
          return { sent: true, _todo: 'W2_port_request_profile_edit' };
        }),
    }),

    request_handover: tool({
      description: 'Müşteri bir insanla görüşmek istediğinde / AI çözemediğinde çağır.',
      inputSchema: z.object({
        note: z.string().optional().describe('Devir nedeni kısa not'),
      }),
      execute: async (args) =>
        sideEffect('request_handover', args as Record<string, unknown>, async () => {
          // TODO(W2): conversation-state mode=HUMAN_PENDING + handover alarmı.
          return { handover: true, _todo: 'W2_port_request_handover' };
        }),
    }),
  };
}
