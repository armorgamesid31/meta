// Tool registry (W2). buildToolSet(ctx) her tur taze kurulur; ctx executor'lara
// closure'lanır. Tool ADLARI `tool_*` (canonical `buildSystemPrompt`'la birebir
// hizalı — prompt o adlarla tetikliyor). İKİ sınıf:
//  - READ: taslakta da çalışır (yan-etki yok). get_prices/services/faq/campaigns
//    GERÇEK portlandı (queries.ts); customer_lookup/check_day_open TODO(W2).
//  - SIDE-EFFECTING: taslakta niyet kaydeder, ÇALIŞTIRMAZ (re-run güvenli);
//    nihai turda işlenir. booking_link/request_location/profile_edit/handover.

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { queryServicePrices, searchServices, getSalonFaq } from './queries.js';
import { prisma } from '../../prisma.js';
import type { ToolContext } from '../types.js';

export function buildToolSet(ctx: ToolContext): ToolSet {
  // Yan-etkili: taslakta niyet kaydet + dön; değilse executor'ı çalıştır.
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
    // ─── READ ─────────────────────────────────────────────────────────────
    tool_get_prices: tool({
      description:
        "Müşteri FİYAT sorduğunda ZORUNLU çağır — fiyatı ASLA kendin söyleme/uydurma. Tetikleyiciler: 'fiyat', 'ücret', 'kaç para', 'ne kadar', 'kaça', spesifik hizmet adı. service_name + varsa related_terms ver.",
      inputSchema: z.object({
        service_name: z.string().describe('Sorulan hizmet adı'),
        related_terms: z.string().optional().describe('Eşanlamlı/ilişkili terimler, virgülle'),
      }),
      execute: async (args) => ({ prices: await queryServicePrices(ctx.salonId, args.service_name, args.related_terms || '') }),
    }),

    tool_get_services: tool({
      description: 'Müşteri salonun HİZMETLERİNİ/işlemlerini sorduğunda çağır. q + varsa related_terms/limit.',
      inputSchema: z.object({
        q: z.string().describe('Hizmet adı veya kategori'),
        related_terms: z.string().optional().describe('Eşanlamlı/ilişkili terimler, virgülle'),
        limit: z.number().optional().describe('1-20, default 10'),
      }),
      execute: async (args) => ({ services: await searchServices(ctx.salonId, args.q, args.related_terms || '', args.limit ?? 10) }),
    }),

    tool_get_faq: tool({
      description: 'SSS/genel soru (otopark, ödeme, evcil hayvan, içerik vb.) sorulduğunda çağır.',
      inputSchema: z.object({
        category_id: z.string().optional().describe('Kategori id (opsiyonel)'),
        category_name: z.string().optional().describe('Kategori adı (opsiyonel)'),
      }),
      execute: async (args) => getSalonFaq(ctx.salonId, args.category_id, args.category_name),
    }),

    tool_get_campaigns: tool({
      description:
        "Müşteri KAMPANYA/indirim sorduğunda ZORUNLU çağır — kampanya bilgisini ASLA kendin uydurma. Tetikleyiciler: 'indirim', 'kampanya', 'fırsat', 'promosyon', 'paket'.",
      inputSchema: z.object({}),
      execute: async () => {
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

    tool_customer_lookup: tool({
      description: "Müşterinin 5 randevudan eski geçmişine atıf varsa veya kayıtlı kimliğini doğrulamak için çağır (opsiyonel).",
      inputSchema: z.object({ subject: z.string().optional().describe('Kanal subject (telefon/IGSID); yoksa boş') }),
      execute: async (_args) => {
        // TODO(W2): internalAgent customer-lookup mantığını in-process çağır.
        return { found: false, _todo: 'W2_port_customer_lookup' };
      },
    }),

    tool_check_day_open: tool({
      description:
        "GÜN bazlı açık/kapalı sorusunda ZORUNLU çağır — açık mı kapalı mı bilgisini kendin söyleme. Tetikleyiciler: 'açık mısınız', 'yarın açık', 'X günü çalışıyor musunuz', 'bayramda', 'kurban bayramı', 'sevgililer günü', 'yılbaşı', 'tatil', 'pazar açık'. date_expression'a müşteri ne dediyse Türkçe yaz.",
      inputSchema: z.object({ date_expression: z.string().describe('Doğal-dil gün ifadesi') }),
      execute: async (_args) => {
        // TODO(W2): holidayCalendar + SalonClosure mantığını in-process çağır.
        return { _todo: 'W2_port_check_day_open' };
      },
    }),

    // ─── SIDE-EFFECTING (taslakta ertelenir) ─────────────────────────────
    tool_booking_link: tool({
      description: 'Randevu/rezervasyon/müsait-saat/iptal/erteleme/SPESİFİK SAAT sorusunda ZORUNLU çağır. Tek-tık randevu butonu gönderilir.',
      inputSchema: z.object({}),
      execute: async () =>
        sideEffect('tool_booking_link', {}, async () => {
          // TODO(W2/W4): magicLinkService.ensureMagicLink (BOOKING) + buton gönder.
          return { success: true, _todo: 'W2_port_booking_link' };
        }),
    }),

    tool_request_location: tool({
      description: 'Müşteri salonun KONUMUNU/ADRESİNİ sorduğunda ZORUNLU çağır. Konum butonu gönderilir.',
      inputSchema: z.object({}),
      execute: async () =>
        sideEffect('tool_request_location', {}, async () => {
          // TODO(W2/W4): locationIntent — place_id cache + konum butonu gönder.
          return { hasButton: true, _todo: 'W2_port_request_location' };
        }),
    }),

    tool_request_profile_edit: tool({
      description: 'Müşteri kendi bilgilerini (ad/numara/Instagram) değiştirmek istediğinde ZORUNLU çağır. Güvenli düzenleme bağlantısı gönderilir.',
      inputSchema: z.object({}),
      execute: async () =>
        sideEffect('tool_request_profile_edit', {}, async () => {
          // TODO(W2/W4): profileEdit — global kimlik çöz + portal token mint + buton gönder.
          return { found: true, _todo: 'W2_port_request_profile_edit' };
        }),
    }),

    tool_request_handover: tool({
      description: "Müşteri bir insanla görüşmek isterse / şikayet / agresif dil / AI çözemezse çağır.",
      inputSchema: z.object({ note: z.string().optional().describe('Devir nedeni kısa not') }),
      execute: async (args) =>
        sideEffect('tool_request_handover', args as Record<string, unknown>, async () => {
          // TODO(W2/W4): conversation-state mode=HUMAN_PENDING + handover alarmı.
          return { handover: true, _todo: 'W2_port_request_handover' };
        }),
    }),
  };
}
