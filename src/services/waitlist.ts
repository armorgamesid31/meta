import axios from 'axios';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma.js';
import type { DisplaySlot, PersonGroup } from '../modules/availability/types.js';
import { generateAvailability } from './availabilityService.js';
import { createNotification } from './notifications.js';
import { buildWaitlistOfferUrl } from '../utils/waitlistOfferUrl.js';

const OFFER_TTL_MINUTES = 15;
const CHAKRA_WHATSAPP_SEND_URL = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const CHAKRA_API_BASE = (process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com').trim().replace(/\/+$/, '');

export type WaitlistChannel = 'WHATSAPP' | 'WEB_LINK';

type WaitlistCustomerInput = {
  customerId?: number | null;
  customerName: string;
  customerPhone: string;
};

export type WaitlistCreateInput = {
  salonId: number;
  date: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  allowNearbyMatches?: boolean;
  nearbyToleranceMinutes?: number | null;
  groups: PersonGroup[];
  source: 'CUSTOMER' | 'ADMIN';
  customer: WaitlistCustomerInput;
  notes?: string | null;
};

export type WaitlistListItem = {
  id: number;
  customerId: number | null;
  customerName: string;
  customerPhone: string;
  source: 'CUSTOMER' | 'ADMIN';
  status: 'PENDING' | 'OFFERED' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED';
  date: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  notes: string | null;
  allowNearbyMatches: boolean;
  nearbyToleranceMinutes: number;
  createdAt: string;
  latestOffer: null | {
    id: number;
    status: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
    channel: WaitlistChannel;
    slotDate: string;
    slotStartTime: string;
    slotEndTime: string;
    expiresAt: string;
    offerUrl: string | null;
  };
  groups: PersonGroup[];
};

export type WaitlistOfferDetails = {
  offerId: number;
  token: string;
  status: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
  expiresAt: string;
  slotDate: string;
  slotStartTime: string;
  slotEndTime: string;
  customerName: string;
  customerPhone: string;
  services: Array<{ serviceId: number; start: string; end: string; staffId: number }>;
};

type SlotPayload = {
  displayKey: string;
  label: string;
  startTime: string;
  endTime: string;
  personSlots: Array<{
    personId: string;
    slotKey: string;
    startTime: string;
    endTime: string;
    staffId: number;
    serviceSequence: Array<{ serviceId: number; start: string; end: string; staffId: number }>;
  }>;
};

type ReservedBlock = {
  staffId: number;
  startMinute: number;
  endMinute: number;
};

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function normalizeDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function dateToKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function timeToMinute(value: string): number {
  const [hours, minutes] = value.split(':').map((item) => Number(item));
  return (hours || 0) * 60 + (minutes || 0);
}

function minuteToTime(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function groupsFromUnknown(value: unknown): PersonGroup[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row, index) => {
      const item = asObject(row);
      const personId = trimText(item.personId) || `p${index + 1}`;
      const services = Array.isArray(item.services)
        ? item.services
            .map((service) => {
              const raw = asObject(service);
              const serviceId = Number(raw.serviceId);
              if (!Number.isInteger(serviceId) || serviceId <= 0) return null;
              const allowedStaffIds = Array.isArray(raw.allowedStaffIds)
                ? raw.allowedStaffIds
                    .map((id) => Number(id))
                    .filter((id, idx, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === idx)
                : null;
              return {
                serviceId,
                allowedStaffIds: allowedStaffIds && allowedStaffIds.length ? allowedStaffIds : null,
              };
            })
            .filter(Boolean)
        : [];
      if (!services.length) return null;
      return { personId, services } as PersonGroup;
    })
    .filter(Boolean) as PersonGroup[];
}

function displaySlotToPayload(slot: DisplaySlot): SlotPayload {
  return slot as SlotPayload;
}

function slotPayloadToBlocks(payload: SlotPayload): ReservedBlock[] {
  return (payload.personSlots || []).flatMap((personSlot) =>
    (personSlot.serviceSequence || []).map((sequence) => ({
      staffId: Number(sequence.staffId),
      startMinute: timeToMinute(sequence.start),
      endMinute: timeToMinute(sequence.end),
    })),
  );
}

function slotMatchesWindow(slot: DisplaySlot, startMinute: number, endMinute: number): boolean {
  const slotStart = timeToMinute(slot.startTime);
  const slotEnd = timeToMinute(slot.endTime);
  return slotStart >= startMinute && slotEnd <= endMinute;
}

function resolveNearbyWindow(
  startMinute: number,
  endMinute: number,
  allowNearbyMatches: boolean,
  nearbyToleranceMinutes: number,
): { exactStart: number; exactEnd: number; searchStart: number; searchEnd: number } {
  const tolerance = allowNearbyMatches ? Math.max(0, Math.floor(nearbyToleranceMinutes || 0)) : 0;
  return {
    exactStart: startMinute,
    exactEnd: endMinute,
    searchStart: Math.max(0, startMinute - tolerance),
    searchEnd: Math.min(24 * 60, endMinute + tolerance),
  };
}

function slotConflictsWithReserved(slot: DisplaySlot, reservedBlocks: ReservedBlock[]): boolean {
  const candidateBlocks = slotPayloadToBlocks(displaySlotToPayload(slot));
  return candidateBlocks.some((candidate) =>
    reservedBlocks.some(
      (reserved) =>
        reserved.staffId === candidate.staffId &&
        windowsOverlap(candidate.startMinute, candidate.endMinute, reserved.startMinute, reserved.endMinute),
    ),
  );
}

function generateOfferToken(): string {
  return randomBytes(18).toString('base64url');
}

function buildChakraWhatsappSendUrl(pluginId: string, phoneNumberId: string): string {
  if (CHAKRA_WHATSAPP_SEND_URL) {
    const hasPlaceholders =
      CHAKRA_WHATSAPP_SEND_URL.includes('{pluginId}') ||
      CHAKRA_WHATSAPP_SEND_URL.includes('{whatsappPhoneNumberId}');
    if (hasPlaceholders) {
      return CHAKRA_WHATSAPP_SEND_URL
        .replaceAll('{pluginId}', encodeURIComponent(pluginId))
        .replaceAll('{whatsappPhoneNumberId}', encodeURIComponent(phoneNumberId));
    }
    return CHAKRA_WHATSAPP_SEND_URL;
  }

  return `${CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/${encodeURIComponent(pluginId)}/api/v19.0/${encodeURIComponent(phoneNumberId)}/messages`;
}

async function resolveCustomer(input: { salonId: number; customer: WaitlistCustomerInput }) {
  const explicitId = Number(input.customer.customerId || 0);
  if (Number.isInteger(explicitId) && explicitId > 0) {
    const customer = await prisma.customer.findFirst({
      where: { id: explicitId, salonId: input.salonId },
      select: { id: true, name: true, phone: true },
    });
    if (customer) return customer;
  }

  const name = trimText(input.customer.customerName);
  const phone = trimText(input.customer.customerPhone);
  if (!name || !phone) {
    throw new Error('customer_name_and_phone_required');
  }

  const existing = await prisma.customer.findFirst({
    where: { salonId: input.salonId, phone },
    select: { id: true, name: true, phone: true },
  });

  if (existing) {
    if (!existing.name && name) {
      return prisma.customer.update({
        where: { id: existing.id },
        data: { name },
        select: { id: true, name: true, phone: true },
      });
    }
    return existing;
  }

  const created = await prisma.customer.create({
    data: {
      salonId: input.salonId,
      name,
      phone,
      registrationStatus: 'PENDING',
      acceptMarketing: false,
    },
    select: { id: true, name: true, phone: true },
  });

  await prisma.customerRiskProfile.create({
    data: {
      customerId: created.id,
      salonId: input.salonId,
      riskScore: 0,
      riskLevel: null,
    },
  }).catch(() => undefined);

  return created;
}

async function resolveSalonOfferMeta(salonId: number) {
  return prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      id: true,
      slug: true,
      chakraPluginId: true,
      chakraPhoneNumberId: true,
      whatsappPhone: true,
    },
  });
}

async function sendWhatsappOffer(params: {
  salonId: number;
  customerPhone: string;
  customerName: string;
  offerUrl: string;
}) {
  const salon = await resolveSalonOfferMeta(params.salonId);
  if (!salon?.chakraPluginId) {
    throw new Error('Chakra plugin is not connected');
  }
  const phoneNumberId = trimText(salon.chakraPhoneNumberId);
  if (!phoneNumberId) {
    throw new Error('Chakra phone number is not connected');
  }

  const to = normalizeDigits(params.customerPhone);
  if (!to) {
    throw new Error('customer_phone_missing');
  }

  const payload: Record<string, any> = {
    pluginId: salon.chakraPluginId,
    phoneNumberId,
    to,
    type: 'text',
    text: `Merhaba ${params.customerName}, bekleme listeniz icin uygun bir saat acildi. 15 dakika icinde onaylamak icin: ${params.offerUrl}`,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) {
    headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;
  }

  const sendUrl = buildChakraWhatsappSendUrl(salon.chakraPluginId, phoneNumberId);
  const response = await axios.post(sendUrl, payload, { headers, timeout: 25000 });
  return (
    trimText(response.data?.messageId) ||
    trimText(response.data?.id) ||
    trimText(response.data?.data?.id) ||
    `wa_wait_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
}

async function notifySalon(input: {
  salonId: number;
  eventType: 'WAITLIST_MATCH_FOUND' | 'WAITLIST_OFFER_CREATED' | 'WAITLIST_OFFER_EXPIRED' | 'WAITLIST_OFFER_ACCEPTED';
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}) {
  await createNotification({
    salonId: input.salonId,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    payload: {
      route: 'schedule',
      ...(input.payload || {}),
    },
  }).catch(() => undefined);
}

function serializeEntry(entry: any): WaitlistListItem {
  return {
    id: entry.id,
    customerId: entry.customerId || null,
    customerName: entry.customerName,
    customerPhone: entry.customerPhone,
    source: entry.source,
    status: entry.status,
    date: dateToKey(new Date(entry.requestDate)),
    timeWindowStart: minuteToTime(entry.windowStartMinute),
    timeWindowEnd: minuteToTime(entry.windowEndMinute),
    notes: entry.notes || null,
    allowNearbyMatches: Boolean(entry.allowNearbyMatches),
    nearbyToleranceMinutes: Number(entry.nearbyToleranceMinutes || 0),
    createdAt: new Date(entry.createdAt).toISOString(),
    latestOffer: entry.offers?.[0]
      ? {
          id: entry.offers[0].id,
          status: entry.offers[0].status,
          channel: entry.offers[0].channel,
          slotDate: dateToKey(new Date(entry.offers[0].slotDate)),
          slotStartTime: minuteToTime(entry.offers[0].slotStartMinute),
          slotEndTime: minuteToTime(entry.offers[0].slotEndMinute),
          expiresAt: new Date(entry.offers[0].expiresAt).toISOString(),
          offerUrl: entry.offers[0].offerUrl || null,
        }
      : null,
    groups: groupsFromUnknown(entry.groups),
  };
}

export async function createWaitlistEntry(input: WaitlistCreateInput) {
  const groups = groupsFromUnknown(input.groups);
  if (!groups.length) {
    throw new Error('groups_required');
  }

  const requestDate = parseDateOnly(input.date);
  if (Number.isNaN(requestDate.getTime())) {
    throw new Error('invalid_date');
  }

  const windowStartMinute = timeToMinute(input.timeWindowStart);
  const windowEndMinute = timeToMinute(input.timeWindowEnd);
  if (windowStartMinute >= windowEndMinute) {
    throw new Error('invalid_time_window');
  }
  const allowNearbyMatches = Boolean(input.allowNearbyMatches);
  const nearbyToleranceMinutes = Math.max(0, Math.min(180, Math.floor(Number(input.nearbyToleranceMinutes ?? 60) || 60)));

  const customer = await resolveCustomer({ salonId: input.salonId, customer: input.customer });
  const entry = await prisma.waitlistEntry.create({
    data: {
      salonId: input.salonId,
      customerId: customer.id,
      customerName: customer.name || trimText(input.customer.customerName) || 'Guest',
      customerPhone: customer.phone,
      source: input.source,
      requestDate,
      windowStartMinute,
      windowEndMinute,
      allowNearbyMatches,
      nearbyToleranceMinutes,
      groups: groups as any,
      preferredStaffIds: groups.flatMap((group) =>
        group.services.flatMap((service: any) => (Array.isArray(service.allowedStaffIds) ? service.allowedStaffIds : [])),
      ) as any,
      notes: trimText(input.notes) || null,
    },
    include: {
      offers: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  await matchWaitlistForDate(input.salonId, input.date, { specificEntryId: entry.id });

  const fresh = await prisma.waitlistEntry.findUnique({
    where: { id: entry.id },
    include: { offers: { take: 1, orderBy: { createdAt: 'desc' } } },
  });

  return serializeEntry(fresh || entry);
}

export async function listWaitlistEntries(input: { salonId: number; date: string }) {
  await sweepExpiredWaitlistOffers(input.salonId, input.date);
  const rows = await prisma.waitlistEntry.findMany({
    where: {
      salonId: input.salonId,
      requestDate: parseDateOnly(input.date),
    },
    include: {
      offers: {
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
  });

  return rows.map(serializeEntry);
}

export async function cancelWaitlistEntry(input: { salonId: number; entryId: number }) {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
    include: { offers: { where: { status: { in: ['PENDING', 'SENT'] } } } },
  });
  if (!entry) {
    throw new Error('waitlist_entry_not_found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: 'CANCELLED',
        closedAt: new Date(),
      },
    });

    if (entry.offers.length) {
      await tx.waitlistOffer.updateMany({
        where: { id: { in: entry.offers.map((offer) => offer.id) } },
        data: {
          status: 'CANCELLED',
          failedAt: new Date(),
        },
      });
    }
  });
}

export async function sweepExpiredWaitlistOffers(salonId: number, date?: string) {
  const now = new Date();
  const where: any = {
    salonId,
    status: { in: ['PENDING', 'SENT'] },
    expiresAt: { lt: now },
  };
  if (date) {
    where.slotDate = parseDateOnly(date);
  }

  const expired = await prisma.waitlistOffer.findMany({ where });
  if (!expired.length) return;

  const uniqueEntryIds = Array.from(new Set(expired.map((offer) => offer.waitlistEntryId)));
  await prisma.$transaction(async (tx) => {
    await tx.waitlistOffer.updateMany({
      where: { id: { in: expired.map((offer) => offer.id) } },
      data: { status: 'EXPIRED', failedAt: now },
    });

    await tx.waitlistEntry.updateMany({
      where: { id: { in: uniqueEntryIds }, status: 'OFFERED' },
      data: { status: 'PENDING' },
    });
  });

  for (const offer of expired) {
    await notifySalon({
      salonId,
      eventType: 'WAITLIST_OFFER_EXPIRED',
      title: 'Bekleme listesi teklifi sona erdi',
      body: `${offer.token.slice(0, 6)} kodlu teklif suresi doldu.`,
      payload: { offerId: offer.id, waitlistEntryId: offer.waitlistEntryId },
    });
  }

  const uniqueDates = Array.from(new Set(expired.map((offer) => dateToKey(new Date(offer.slotDate)))));
  await Promise.all(uniqueDates.map((day) => matchWaitlistForDate(salonId, day)));
}

export async function matchWaitlistForDate(
  salonId: number,
  date: string,
  options?: { specificEntryId?: number | null },
) {
  await sweepExpiredWaitlistOffers(salonId, date).catch(() => undefined);

  const activeOffers = await prisma.waitlistOffer.findMany({
    where: {
      salonId,
      slotDate: parseDateOnly(date),
      status: { in: ['PENDING', 'SENT'] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'asc' },
  });
  const reservedBlocks = activeOffers.flatMap((offer) => slotPayloadToBlocks(offer.slotPayload as any));

  const entries = await prisma.waitlistEntry.findMany({
    where: {
      salonId,
      requestDate: parseDateOnly(date),
      status: 'PENDING',
      ...(options?.specificEntryId ? { id: options.specificEntryId } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const entry of entries) {
    const groups = groupsFromUnknown(entry.groups);
    if (!groups.length) continue;
    const window = resolveNearbyWindow(
      entry.windowStartMinute,
      entry.windowEndMinute,
      Boolean(entry.allowNearbyMatches),
      Number(entry.nearbyToleranceMinutes || 0),
    );

    const availability = await generateAvailability(
      {
        salonId,
        date,
        groups,
      },
      { persistSearchContext: true },
    );

    const exactSlot = (availability.displaySlots || []).find(
      (candidate) =>
        slotMatchesWindow(candidate, window.exactStart, window.exactEnd) &&
        !slotConflictsWithReserved(candidate, reservedBlocks),
    );
    const nearbySlot =
      exactSlot || !entry.allowNearbyMatches
        ? null
        : (availability.displaySlots || []).find(
            (candidate) =>
              slotMatchesWindow(candidate, window.searchStart, window.searchEnd) &&
              !slotMatchesWindow(candidate, window.exactStart, window.exactEnd) &&
              !slotConflictsWithReserved(candidate, reservedBlocks),
          );
    const slot = exactSlot || nearbySlot;

    if (!slot) {
      continue;
    }

    const salon = await resolveSalonOfferMeta(salonId);
    const token = generateOfferToken();
    const offerUrl = buildWaitlistOfferUrl({ token, salonId, salonSlug: salon?.slug || null });
    const channel: WaitlistChannel = salon?.chakraPluginId ? 'WHATSAPP' : 'WEB_LINK';
    let providerMessageId: string | null = null;
    let status: 'SENT' | 'FAILED' = 'SENT';
    let failureReason: string | null = null;

    if (channel === 'WHATSAPP') {
      try {
        providerMessageId = await sendWhatsappOffer({
          salonId,
          customerName: entry.customerName,
          customerPhone: entry.customerPhone,
          offerUrl,
        });
      } catch (error: any) {
        status = 'FAILED';
        failureReason = error?.message || 'waitlist_whatsapp_send_failed';
      }
    }

    const createdOffer = await prisma.waitlistOffer.create({
      data: {
        waitlistEntryId: entry.id,
        salonId,
        token,
        channel,
        status,
        slotDate: parseDateOnly(date),
        slotStartMinute: timeToMinute(slot.startTime),
        slotEndMinute: timeToMinute(slot.endTime),
        slotPayload: displaySlotToPayload(slot) as any,
        offerUrl,
        providerMessageId,
        failureReason,
        expiresAt: new Date(Date.now() + OFFER_TTL_MINUTES * 60 * 1000),
        sentAt: status === 'SENT' ? new Date() : null,
        failedAt: status === 'FAILED' ? new Date() : null,
      },
    });

    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: status === 'FAILED' ? 'PENDING' : 'OFFERED',
        latestOfferId: createdOffer.id,
        latestMatchedAt: new Date(),
      },
    });

    if (status === 'SENT') {
      reservedBlocks.push(...slotPayloadToBlocks(displaySlotToPayload(slot)));
      await notifySalon({
        salonId,
        eventType: 'WAITLIST_MATCH_FOUND',
        title: 'Bekleme listesi eslesmesi bulundu',
        body: `${entry.customerName} icin ${slot.startTime} saati teklif edildi.`,
        payload: { waitlistEntryId: entry.id, offerId: createdOffer.id },
      });
      await notifySalon({
        salonId,
        eventType: 'WAITLIST_OFFER_CREATED',
        title: 'Bekleme listesi teklifi gonderildi',
        body: `${entry.customerName} icin teklif gonderildi.${nearbySlot ? ' Yakın saat toleransı kullanıldı.' : ''}`,
        payload: { waitlistEntryId: entry.id, offerId: createdOffer.id, offerUrl, matchedNearby: Boolean(nearbySlot) },
      });
    }
  }
}

export async function createManualWaitlistOffer(input: { salonId: number; entryId: number }) {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: input.entryId, salonId: input.salonId },
    select: { id: true, requestDate: true },
  });
  if (!entry) throw new Error('waitlist_entry_not_found');
  await matchWaitlistForDate(input.salonId, dateToKey(new Date(entry.requestDate)), { specificEntryId: entry.id });
  const refreshed = await prisma.waitlistEntry.findUnique({
    where: { id: entry.id },
    include: { offers: { take: 1, orderBy: { createdAt: 'desc' } } },
  });
  return refreshed ? serializeEntry(refreshed) : null;
}

export async function getWaitlistOfferByToken(token: string): Promise<WaitlistOfferDetails | null> {
  const offer = await prisma.waitlistOffer.findUnique({
    where: { token },
    include: { waitlistEntry: true },
  });
  if (!offer) return null;

  if ((offer.status === 'PENDING' || offer.status === 'SENT') && offer.expiresAt < new Date()) {
    await sweepExpiredWaitlistOffers(offer.salonId, dateToKey(new Date(offer.slotDate)));
  }

  const fresh = await prisma.waitlistOffer.findUnique({
    where: { token },
    include: { waitlistEntry: true },
  });
  if (!fresh) return null;

  const payload = fresh.slotPayload as SlotPayload;
  return {
    offerId: fresh.id,
    token: fresh.token,
    status: fresh.status,
    expiresAt: new Date(fresh.expiresAt).toISOString(),
    slotDate: dateToKey(new Date(fresh.slotDate)),
    slotStartTime: minuteToTime(fresh.slotStartMinute),
    slotEndTime: minuteToTime(fresh.slotEndMinute),
    customerName: fresh.waitlistEntry.customerName,
    customerPhone: fresh.waitlistEntry.customerPhone,
    services: payload.personSlots.flatMap((personSlot) => personSlot.serviceSequence || []),
  };
}

export async function rejectWaitlistOffer(token: string) {
  const offer = await prisma.waitlistOffer.findUnique({ where: { token }, include: { waitlistEntry: true } });
  if (!offer) throw new Error('waitlist_offer_not_found');

  await prisma.$transaction(async (tx) => {
    await tx.waitlistOffer.update({
      where: { id: offer.id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });
    await tx.waitlistEntry.update({
      where: { id: offer.waitlistEntryId },
      data: { status: 'PENDING' },
    });
  });

  await matchWaitlistForDate(offer.salonId, dateToKey(new Date(offer.slotDate)));
}

export async function acceptWaitlistOffer(token: string) {
  const offer = await prisma.waitlistOffer.findUnique({
    where: { token },
    include: { waitlistEntry: true },
  });

  if (!offer) {
    throw new Error('waitlist_offer_not_found');
  }
  if (!['PENDING', 'SENT'].includes(offer.status)) {
    throw new Error('waitlist_offer_not_active');
  }
  if (offer.expiresAt < new Date()) {
    await sweepExpiredWaitlistOffers(offer.salonId, dateToKey(new Date(offer.slotDate)));
    throw new Error('waitlist_offer_expired');
  }

  const payload = offer.slotPayload as SlotPayload;
  const serviceBlocks = payload.personSlots.flatMap((personSlot) =>
    (personSlot.serviceSequence || []).map((sequence) => ({
      serviceId: Number(sequence.serviceId),
      staffId: Number(sequence.staffId),
      startTime: new Date(`${dateToKey(new Date(offer.slotDate))}T${sequence.start}:00`),
      endTime: new Date(`${dateToKey(new Date(offer.slotDate))}T${sequence.end}:00`),
    })),
  );

  const serviceIds = Array.from(new Set(serviceBlocks.map((item) => item.serviceId)));
  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, price: true },
  });
  const priceByServiceId = new Map(services.map((service) => [service.id, service.price]));

  const result = await prisma.$transaction(async (tx) => {
    for (const block of serviceBlocks) {
      const conflict = await tx.appointment.findFirst({
        where: {
          salonId: offer.salonId,
          staffId: block.staffId,
          status: { in: ['BOOKED', 'COMPLETED'] },
          startTime: { lt: block.endTime },
          endTime: { gt: block.startTime },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new Error('waitlist_offer_slot_conflict');
      }
    }

    const appointments = [] as any[];
    for (const block of serviceBlocks) {
      const created = await tx.appointment.create({
        data: {
          salonId: offer.salonId,
          customerId: offer.waitlistEntry.customerId,
          customerName: offer.waitlistEntry.customerName,
          customerPhone: offer.waitlistEntry.customerPhone,
          staffId: block.staffId,
          serviceId: block.serviceId,
          startTime: block.startTime,
          endTime: block.endTime,
          status: 'BOOKED',
          source: 'CUSTOMER',
          listPrice: priceByServiceId.get(block.serviceId) || null,
          finalPrice: priceByServiceId.get(block.serviceId) || null,
        },
      });
      appointments.push(created);
    }

    await tx.waitlistOffer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    await tx.waitlistEntry.update({
      where: { id: offer.waitlistEntryId },
      data: { status: 'ACCEPTED', closedAt: new Date() },
    });
    await tx.waitlistOffer.updateMany({
      where: { waitlistEntryId: offer.waitlistEntryId, id: { not: offer.id }, status: { in: ['PENDING', 'SENT'] } },
      data: { status: 'CANCELLED', failedAt: new Date() },
    });

    return appointments;
  });

  await notifySalon({
    salonId: offer.salonId,
    eventType: 'WAITLIST_OFFER_ACCEPTED',
    title: 'Bekleme listesi teklifi kabul edildi',
    body: `${offer.waitlistEntry.customerName} icin randevu olusturuldu.`,
    payload: { waitlistEntryId: offer.waitlistEntryId, offerId: offer.id, appointmentIds: result.map((item) => item.id) },
  });

  return {
    appointments: result.map((item) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      staffId: item.staffId,
      serviceId: item.serviceId,
    })),
  };
}
