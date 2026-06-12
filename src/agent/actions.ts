// Yan-etki aksiyonları (W2 gerçek implementasyon). NİHAİ turda çalışır; mevcut
// backend servislerini REUSE eder (route handler'larını değil — izole). Buton
// üretenler AgentButton döner (orkestratör cevaba iliştirir); handover state değiştirir.

import type { ChannelType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { resolveMapsLink } from '../services/mapsResolver.js';
import { mintPortalToken } from '../services/profilePortalService.js';
import { lookupGlobalIdentityByChannel } from '../services/globalCustomerIdentity.js';
import { ensureMagicLink } from '../services/magicLinkService.js';
import type { AgentButton, ToolContext } from './types.js';

/** KONUM: salonun Maps YER-PROFİLİ butonu (place_id cache; yoksa resolve+cache). */
export async function prepareLocationButton(salonId: number): Promise<AgentButton | null> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true, address: true, district: true, city: true, googleMapsUrl: true, mapsPlaceId: true },
  });
  if (!salon) return null;
  const raw = (salon.googleMapsUrl || '').trim();
  let placeId = (salon.mapsPlaceId || '').trim();
  const dest =
    (salon.address || '').trim() || [salon.district, salon.city].map((p) => (p || '').trim()).filter(Boolean).join(', ');
  const isProperMaps = /^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(raw);

  if (!placeId && raw && !isProperMaps) {
    try {
      const r = await resolveMapsLink(raw);
      if (r.place_id) {
        placeId = r.place_id;
        await prisma.salon.update({ where: { id: salonId }, data: { mapsPlaceId: placeId } }).catch(() => {});
      }
    } catch {
      /* best-effort */
    }
  }

  if (placeId) {
    const q = encodeURIComponent(dest || salon.name || 'salon');
    return { kind: 'location', url: `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(placeId)}` };
  }
  if (raw) return { kind: 'location', url: raw };
  if (dest) return { kind: 'location', url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` };
  return null;
}

/** PROFİL DÜZENLEME: global kimlik çöz + portal token mint → düzenleme butonu.
 *  Tanınan müşteri yoksa null (AI önce kayıt önersin). */
export async function prepareProfileEditButton(ctx: ToolContext): Promise<AgentButton | null> {
  let gid: string | null = null;
  let originSubject = ctx.canonicalUserId || ctx.conversationKey;
  if (ctx.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: ctx.customerId }, select: { globalIdentityId: true, phone: true } });
    gid = c?.globalIdentityId ?? null;
    if (ctx.channel === 'WHATSAPP' && c?.phone) originSubject = c.phone;
  }
  if (!gid && ctx.canonicalUserId) {
    const i = await lookupGlobalIdentityByChannel(ctx.channel as ChannelType, ctx.canonicalUserId);
    gid = i?.id ?? null;
  }
  if (!gid) return null;

  const { token } = await mintPortalToken({
    globalIdentityId: gid,
    originChannel: ctx.channel as ChannelType,
    originSubject,
  });
  const base = (process.env.PROFILE_PORTAL_URL || 'https://kedyapp.com/hesabim').trim().replace(/\/+$/, '');
  return { kind: 'profile_edit', url: `${base}?token=${token}` };
}

/** RANDEVU: booking magic link → randevu butonu. */
export async function prepareBookingButton(ctx: ToolContext): Promise<AgentButton | null> {
  const salon = await prisma.salon.findUnique({ where: { id: ctx.salonId }, select: { slug: true } });
  const r = await ensureMagicLink({
    salonId: ctx.salonId,
    type: 'BOOKING',
    phone: ctx.channel === 'WHATSAPP' ? ctx.canonicalUserId || null : null,
    customerKey: ctx.channel !== 'WHATSAPP' ? ctx.canonicalUserId || null : null,
    channel: ctx.channel as ChannelType,
    conversationKey: ctx.conversationKey,
    canonicalUserId: ctx.canonicalUserId,
    customerId: ctx.customerId,
    salonSlug: salon?.slug || null,
    context: { salonId: ctx.salonId, channel: ctx.channel, conversationKey: ctx.conversationKey },
  });
  return r?.magicUrl ? { kind: 'booking', url: r.magicUrl } : null;
}

/** HANDOVER: konuşmayı insan moduna al (mode=HUMAN_PENDING). */
export async function doHandover(ctx: ToolContext, note?: string): Promise<void> {
  const data = {
    mode: 'HUMAN_PENDING' as const,
    humanPendingSince: new Date(),
    notes: (note && note.trim()) || 'agent_handover',
  };
  await prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: {
        salonId: ctx.salonId,
        channel: ctx.channel as ChannelType,
        conversationKey: ctx.conversationKey,
      },
    },
    update: data,
    create: {
      salonId: ctx.salonId,
      channel: ctx.channel as ChannelType,
      conversationKey: ctx.conversationKey,
      canonicalUserId: ctx.canonicalUserId,
      customerId: ctx.customerId,
      ...data,
    },
  });
}
