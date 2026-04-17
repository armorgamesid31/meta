import { Router } from 'express';
import axios from 'axios';
import { InboundMessageStatus, OutboundMessageSource, type CustomerGender } from '@prisma/client';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { ensureSalonServiceCategories } from '../services/salonCategorySetup.js';
import { ensureSalonServiceRegions } from '../services/salonRegionSetup.js';
import { normalizeInstagramIdentity, normalizePhoneDigits } from '../services/identityService.js';
import { upsertConversationMessageEvent } from '../services/conversationMessageEvents.js';
import { subscribeConversationStream } from '../services/conversationEventsBus.js';
import {
  createNotification,
  getDefaultNotificationPolicy,
  getSalonNotificationPolicy,
  markHandoverTriggered,
  notifySameDayAppointmentChange,
  resolveHandoverAlert,
  upsertSalonNotificationPolicy,
} from '../services/notifications.js';
import {
  buildAppointmentReschedulePreview,
  commitAppointmentReschedule,
} from '../services/appointmentReschedule.js';
import { buildRescheduleOptions } from '../services/appointmentRescheduleOptions.js';
import {
  cancelWaitlistEntry,
  createManualWaitlistOffer,
  createWaitlistEntry,
  listWaitlistEntries,
  matchWaitlistForDate,
} from '../services/waitlist.js';
import { validateMobilePhone } from '../services/phoneValidation.js';
import {
  listCampaignsForSend,
  previewCampaignPricing,
  processCompletionCampaignRewards,
  releaseAppointmentCampaignApplications,
  shouldAutoSendCampaignType,
} from '../services/campaignPricing.js';

const router = Router();

// Website Routes (Moved to top for priority)
router.get('/website/content', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const [salon, gallery] = await prisma.$transaction([
      prisma.salon.findUnique({
        where: { id: salonId },
        select: {
          id: true,
          name: true,
          tagline: true,
          about: true,
          heroImageUrl: true,
          instagramUrl: true,
          whatsappPhone: true,
          city: true,
          heroText: true,
        },
      }),
      prisma.salonGalleryImage.findMany({
        where: { salonId },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          imageUrl: true,
          altText: true,
          displayOrder: true,
          categoryId: true,
        },
      }),
    ]);

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }

    return res.status(200).json({
      salon: {
        name: salon.name,
        tagline: salon.tagline,
        heroText: salon.heroText || salon.tagline,
        about: salon.about,
        heroImageUrl: salon.heroImageUrl,
        instagramUrl: salon.instagramUrl,
        whatsappPhone: salon.whatsappPhone,
        city: salon.city,
      },
      gallery,
    });
  } catch (error) {
    console.error('Admin website content read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/website/content', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const payload = req.body || {};
  const gallery = Array.isArray(payload.gallery) ? payload.gallery : null;

  try {
    const updatedSalon = await prisma.salon.update({
      where: { id: salonId },
      data: {
        ...(typeof payload.salonName === 'string' ? { name: payload.salonName.trim() } : {}),
        ...(typeof payload.tagline === 'string' ? { tagline: payload.tagline.trim() } : {}),
        ...(typeof payload.description === 'string' ? { about: payload.description.trim() } : {}),
        ...(typeof payload.heroImageUrl === 'string' ? { heroImageUrl: payload.heroImageUrl.trim() } : {}),
      },
      select: {
        id: true,
        name: true,
        tagline: true,
        about: true,
        heroImageUrl: true,
        instagramUrl: true,
        whatsappPhone: true,
      },
    });

    if (gallery) {
      const sanitizedGallery = gallery
        .map((item: any, index: number) => {
          const imageUrl = typeof item?.imageUrl === 'string' ? item.imageUrl.trim() : '';
          if (!imageUrl) {
            return null;
          }
          return {
            salonId,
            imageUrl,
            altText: typeof item?.altText === 'string' ? item.altText.trim() || null : null,
            displayOrder: Number.isInteger(item?.displayOrder) ? Number(item.displayOrder) : index,
            categoryId: Number.isInteger(item?.categoryId) ? Number(item.categoryId) : null,
          };
        })
        .filter(Boolean) as Array<{
        salonId: number;
        imageUrl: string;
        altText: string | null;
        displayOrder: number;
        categoryId: number | null;
      }>;

      await prisma.$transaction([
        prisma.salonGalleryImage.deleteMany({ where: { salonId } }),
        ...(sanitizedGallery.length > 0 ? [prisma.salonGalleryImage.createMany({ data: sanitizedGallery })] : []),
      ]);
    }

    const galleryResponse = await prisma.salonGalleryImage.findMany({
      where: { salonId },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        imageUrl: true,
        altText: true,
        displayOrder: true,
        categoryId: true,
      },
    });

    return res.status(200).json({
      salon: {
        ...updatedSalon,
        heroText: updatedSalon.tagline,
      },
      gallery: galleryResponse,
    });
  } catch (error) {
    console.error('Admin website content update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/website/generate', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const salon = await prisma.salon.findUnique({
      where: { id: salonId },
      select: { 
        name: true, city: true, about: true, tagline: true,
        address: true, district: true, heroText: true
      },
    });

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }
    
    const webhookUrl = process.env.N8N_WEBSITE_GENERATE_WEBHOOK_URL;
    const internalApiKey = process.env.N8N_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY;

    if (!webhookUrl) {
      console.warn('[WebsiteGenerate] Webhook URL is missing in .env');
    }

    if (webhookUrl) {
      try {
        console.log(`[WebsiteGenerate] Triggering n8n at: ${webhookUrl}`);
        
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(internalApiKey ? { 'x-internal-api-key': internalApiKey } : {}),
          },
          body: JSON.stringify({
            salonName: typeof req.body?.salonName === 'string' ? req.body.salonName : salon.name,
            city: typeof req.body?.city === 'string' ? req.body.city : salon.city,
            district: salon.district,
            address: salon.address,
            about: salon.about,
            tagline: salon.tagline,
            heroText: salon.heroText,
            callbackUrl: `${process.env.FRONTEND_URL?.replace('mobil', 'app')}/api/internal/website/${salonId}/generate-callback`,
            internalApiKey: internalApiKey,
          }),
        });

        if (!response.ok) {
          console.error(`[WebsiteGenerate] n8n responded with error ${response.status}: ${response.statusText}`);
        } else {
          const text = await response.text();
          let data: any = {};
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (e) {
              console.warn('[WebsiteGenerate] Failed to parse n8n response as JSON:', text);
            }
          }
          
          console.log('[WebsiteGenerate] n8n response received successfully');
          
          // Deep search for generated content in n8n response
          const candidates = [
            data?.output?.generated,
            data?.generated,
            data?.output,
            data
          ];
          
          const resultGenerated = candidates.find(c => c && typeof c === 'object' && c.heroText);
          
          if (resultGenerated) {
            console.log('[WebsiteGenerate] Found AI content in n8n response at some level');
            return res.status(200).json({ 
              generated: {
                heroText: resultGenerated.heroText,
                tagline: resultGenerated.tagline,
                description: resultGenerated.description || resultGenerated.about
              } 
            });
          }
        }
      } catch (webhookError) {
        console.error('[WebsiteGenerate] n8n webhook trigger failed:', webhookError);
      }
    }

    const generated = buildGeneratedWebsiteCopy({
      salonName: typeof req.body?.salonName === 'string' ? req.body.salonName : salon.name,
      city: typeof req.body?.city === 'string' ? req.body.city : salon.city,
    });

    return res.status(200).json({ generated });
  } catch (error) {
    console.error('Admin website copy generate error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/conversations/stream', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const channelFilter = asInboundChannel(req.query.channel);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, salonId, channel: channelFilter || null })}\n\n`);

  const unsubscribe = subscribeConversationStream(salonId, (event) => {
    if (channelFilter && event.channel !== channelFilter) return;
    res.write(`event: conversation.update\ndata: ${JSON.stringify(event)}\n\n`);
  });

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
});

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function asPositiveInt(value: unknown, fallback: number, min = 1, max = 500): number {
  const numeric = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(numeric, min), max);
}

function getSalonId(req: any, res: any): number | null {
  if (!req.user?.salonId) {
    res.status(401).json({ message: 'Unauthorized.' });
    return null;
  }
  return req.user.salonId;
}

function normalizeInstagramUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const username = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return `https://instagram.com/${username}`;
}

type DiscountKind = 'PERCENT' | 'FIXED';

function asDiscountKind(value: unknown): DiscountKind | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PERCENT' || normalized === 'FIXED') {
    return normalized;
  }
  return null;
}

function getAppointmentDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function getSalonTimezone(salonId: number): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COALESCE("timezone", 'Europe/Istanbul') AS "timezone" FROM "SalonSettings" WHERE "salonId" = $1 LIMIT 1`,
    salonId,
  );
  const timezone = String(rows?.[0]?.timezone || 'Europe/Istanbul').trim();
  return timezone || 'Europe/Istanbul';
}

function asPaymentMethod(value: unknown): 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'CASH' || normalized === 'CARD' || normalized === 'TRANSFER' || normalized === 'OTHER') {
    return normalized as 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  }
  return null;
}

function parseAppointmentIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const dedup = new Set<number>();
  for (const raw of input) {
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric > 0) {
      dedup.add(numeric);
    }
  }
  return Array.from(dedup);
}

function parseRescheduleAssignments(input: unknown): Record<number, number> {
  const rows = Array.isArray(input) ? input : [];
  const map: Record<number, number> = {};
  for (const row of rows) {
    const appointmentId = Number((row as any)?.appointmentId);
    const staffId = Number((row as any)?.staffId);
    if (Number.isInteger(appointmentId) && appointmentId > 0 && Number.isInteger(staffId) && staffId > 0) {
      map[appointmentId] = staffId;
    }
  }
  return map;
}

function parseWaitlistGroups(input: unknown): Array<{ personId: string; services: Array<{ serviceId: number; allowedStaffIds: number[] | null }> }> {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row, index) => {
      const item = row && typeof row === 'object' ? (row as any) : {};
      const personId = typeof item.personId === 'string' && item.personId.trim() ? item.personId.trim() : `p${index + 1}`;
      const services = Array.isArray(item.services)
        ? item.services
            .map((service: any) => {
              const serviceId = Number(service?.serviceId);
              if (!Number.isInteger(serviceId) || serviceId <= 0) return null;
              const allowedStaffIds = Array.isArray(service?.allowedStaffIds)
                ? service.allowedStaffIds
                    .map((id: any) => Number(id))
                    .filter((id: number, idx: number, list: number[]) => Number.isInteger(id) && id > 0 && list.indexOf(id) === idx)
                : null;
              return {
                serviceId,
                allowedStaffIds: allowedStaffIds && allowedStaffIds.length ? allowedStaffIds : null,
              };
            })
            .filter(Boolean)
        : [];
      if (!services.length) return null;
      return { personId, services };
    })
    .filter(Boolean) as Array<{ personId: string; services: Array<{ serviceId: number; allowedStaffIds: number[] | null }> }>;
}

function toRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 70) {
    return 'HIGH';
  }
  if (score >= 35) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function asCustomerGender(value: unknown): 'male' | 'female' | 'other' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'male' || normalized === 'female' || normalized === 'other') {
    return normalized;
  }
  return null;
}

function buildGeneratedWebsiteCopy(input: { salonName?: string; city?: string | null }) {
  const salonName = (input.salonName || '').trim() || 'Salonunuz';
  const city = (input.city || '').trim() || 'şehrinizde';

  return {
    heroText: `${salonName} ile kendinize zaman ayırın`,
    tagline: `${city} profesyonel güzellik deneyimi`,
    description:
      `${salonName}, uzman ekibiyle saç, cilt ve bakım hizmetlerinde güvenilir sonuçlar sunar. ` +
      'Hijyenik salon ortamı, kaliteli ürünler ve kişiselleştirilmiş dokunuşlarla her ziyareti keyifli bir deneyime dönüştürür.',
  };
}

function parseCampaignDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

function asCampaignDeliveryMode(value: unknown): 'AUTO' | 'MANUAL' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'AUTO' || normalized === 'MANUAL') return normalized;
  return null;
}

function toPercentDelta(current: number, previous: number): number {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

const ANALYTICS_TIMEZONE = 'Europe/Istanbul';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || 'v23.0').trim();
const DEFAULT_HUMAN_ACTIVE_MINUTES = Number(process.env.CONVERSATION_HUMAN_ACTIVE_MINUTES || 360);
const DEFAULT_WORKING_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
type WorkingDayKey = (typeof DEFAULT_WORKING_DAYS)[number] | 'SUN';
type ConversationAutomationModeValue =
  | 'AUTO'
  | 'HUMAN_PENDING'
  | 'HUMAN_ACTIVE'
  | 'MANUAL_ALWAYS'
  | 'AUTO_RESUME_PENDING';
type ConversationStateSnapshot = {
  channel: 'INSTAGRAM' | 'WHATSAPP';
  conversationKey: string;
  customerId: number | null;
  mode: ConversationAutomationModeValue;
  manualAlways: boolean;
  humanPendingSince: Date | null;
  humanActiveUntil: Date | null;
  lastHumanMessageAt: Date | null;
  lastCustomerMessageAt: Date | null;
  updatedAt: Date | null;
};

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

async function markConversationHumanActive(input: {
  salonId: number;
  channel: 'INSTAGRAM' | 'WHATSAPP';
  conversationKey: string;
  profileName?: string | null;
}) {
  const now = new Date();
  const until = new Date(now.getTime() + DEFAULT_HUMAN_ACTIVE_MINUTES * 60 * 1000);
  return prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: input.conversationKey,
      },
    },
    update: {
      mode: 'HUMAN_ACTIVE',
      manualAlways: false,
      humanPendingSince: null,
      lastHumanMessageAt: now,
      humanActiveUntil: until,
      ...(input.profileName ? { profileName: input.profileName } : {}),
    },
    create: {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      mode: 'HUMAN_ACTIVE',
      manualAlways: false,
      humanPendingSince: null,
      lastHumanMessageAt: now,
      humanActiveUntil: until,
      profileName: input.profileName || null,
    },
  });
}

async function markConversationHumanPending(input: {
  salonId: number;
  channel: 'INSTAGRAM' | 'WHATSAPP';
  conversationKey: string;
  note?: string | null;
  profileName?: string | null;
}) {
  const now = new Date();
  return prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: input.conversationKey,
      },
    },
    update: {
      mode: 'HUMAN_PENDING',
      manualAlways: false,
      humanPendingSince: now,
      humanActiveUntil: null,
      ...(input.note ? { notes: input.note } : {}),
      ...(input.profileName ? { profileName: input.profileName } : {}),
    },
    create: {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      mode: 'HUMAN_PENDING',
      humanPendingSince: now,
      notes: input.note || null,
      profileName: input.profileName || null,
    },
  });
}

async function markConversationAuto(input: {
  salonId: number;
  channel: 'INSTAGRAM' | 'WHATSAPP';
  conversationKey: string;
  note?: string | null;
  profileName?: string | null;
}) {
  return prisma.conversationState.upsert({
    where: {
      salonId_channel_conversationKey: {
        salonId: input.salonId,
        channel: input.channel,
        conversationKey: input.conversationKey,
      },
    },
    update: {
      mode: 'AUTO',
      manualAlways: false,
      humanPendingSince: null,
      humanActiveUntil: null,
      ...(input.note ? { notes: input.note } : {}),
      ...(input.profileName ? { profileName: input.profileName } : {}),
    },
    create: {
      salonId: input.salonId,
      channel: input.channel,
      conversationKey: input.conversationKey,
      mode: 'AUTO',
      manualAlways: false,
      humanPendingSince: null,
      humanActiveUntil: null,
      notes: input.note || null,
      profileName: input.profileName || null,
    },
  });
}

function serializeConversationState(state: ConversationStateSnapshot | null) {
  return {
    automationMode: state?.mode || 'AUTO',
    manualAlways: Boolean(state?.manualAlways),
    humanPendingSince: state?.humanPendingSince?.toISOString() || null,
    humanActiveUntil: state?.humanActiveUntil?.toISOString() || null,
    lastHumanMessageAt: state?.lastHumanMessageAt?.toISOString() || null,
    lastCustomerMessageAt: state?.lastCustomerMessageAt?.toISOString() || null,
  };
}

function isHandoverMode(mode: string | null | undefined): boolean {
  return mode === 'HUMAN_PENDING' || mode === 'HUMAN_ACTIVE';
}

function pickLatestState(rows: ConversationStateSnapshot[]): ConversationStateSnapshot | null {
  if (!rows.length) return null;
  const sorted = rows
    .slice()
    .sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
  return sorted[0] || null;
}

function toTimezoneDateKey(date: Date, timeZone = ANALYTICS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function toTurkishWeekdayLabel(date: Date, timeZone = ANALYTICS_TIMEZONE): string {
  const raw = new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    weekday: 'short',
  }).format(date);
  return raw.replace('.', '');
}

function toTurkishDateLabel(date: Date, timeZone = ANALYTICS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  return `${day}.${month}`;
}

function parseDateKeyToUtcStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function weekdayKeyFromDate(date: Date, timeZone = ANALYTICS_TIMEZONE): WorkingDayKey {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);

  const map: Record<string, WorkingDayKey> = {
    Mon: 'MON',
    Tue: 'TUE',
    Wed: 'WED',
    Thu: 'THU',
    Fri: 'FRI',
    Sat: 'SAT',
    Sun: 'SUN',
  };
  return map[short] || 'MON';
}

function normalizeWorkingDays(raw: unknown): Set<WorkingDayKey> {
  if (!Array.isArray(raw)) {
    return new Set(DEFAULT_WORKING_DAYS);
  }

  const allowed = new Set<WorkingDayKey>(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  const normalized = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is WorkingDayKey => allowed.has(item as WorkingDayKey));

  if (!normalized.length) {
    return new Set(DEFAULT_WORKING_DAYS);
  }

  return new Set(normalized);
}

function isWorkingDay(date: Date, workingDays: Set<WorkingDayKey>, timeZone = ANALYTICS_TIMEZONE): boolean {
  return workingDays.has(weekdayKeyFromDate(date, timeZone));
}

function weekdayIndexMondayFirst(date: Date, timeZone = ANALYTICS_TIMEZONE): number {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);

  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[short] ?? 0;
}

function startOfCurrentWeekMonday(date: Date): Date {
  const todayKey = toTimezoneDateKey(date);
  const todayAtUtcStart = parseDateKeyToUtcStart(todayKey);
  const index = weekdayIndexMondayFirst(todayAtUtcStart);
  const start = new Date(todayAtUtcStart);
  start.setUTCDate(todayAtUtcStart.getUTCDate() - index);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

async function sumCompletedRevenue(params: { salonId: number; from: Date; to: Date }) {
  const rows = await prisma.appointment.findMany({
    where: {
      salonId: params.salonId,
      status: 'COMPLETED',
      startTime: {
        gte: params.from,
        lte: params.to,
      },
    },
    select: {
      service: {
        select: {
          price: true,
        },
      },
    },
  });

  return rows.reduce((total, row) => total + (row.service?.price || 0), 0);
}

async function buildCampaignMetrics(campaign: any) {
  const now = new Date();
  const windowStart = campaign.startsAt || campaign.createdAt || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rawWindowEnd = campaign.endsAt && campaign.endsAt < now ? campaign.endsAt : now;
  const windowEnd = rawWindowEnd > windowStart ? rawWindowEnd : now;

  const durationMs = Math.max(windowEnd.getTime() - windowStart.getTime(), 24 * 60 * 60 * 1000);
  const previousStart = new Date(windowStart.getTime() - durationMs);
  const previousEnd = windowStart;

  const [appointmentsCurrent, appointmentsPrevious, completedCurrent, completedPrevious, cancelledCurrent, cancelledPrevious, newCustomersCurrent, newCustomersPrevious, revenueCurrent, revenuePrevious] =
    await Promise.all([
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          startTime: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'COMPLETED',
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'COMPLETED',
          startTime: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'CANCELLED',
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.appointment.count({
        where: {
          salonId: campaign.salonId,
          status: 'CANCELLED',
          startTime: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      prisma.customer.count({
        where: {
          salonId: campaign.salonId,
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      }),
      prisma.customer.count({
        where: {
          salonId: campaign.salonId,
          createdAt: {
            gte: previousStart,
            lte: previousEnd,
          },
        },
      }),
      sumCompletedRevenue({ salonId: campaign.salonId, from: windowStart, to: windowEnd }),
      sumCompletedRevenue({ salonId: campaign.salonId, from: previousStart, to: previousEnd }),
    ]);

  return {
    window: {
      start: windowStart,
      end: windowEnd,
      previousStart,
      previousEnd,
    },
    current: {
      appointmentCount: appointmentsCurrent,
      completedCount: completedCurrent,
      cancelledCount: cancelledCurrent,
      newCustomerCount: newCustomersCurrent,
      revenueEstimate: Number(revenueCurrent.toFixed(2)),
    },
    previous: {
      appointmentCount: appointmentsPrevious,
      completedCount: completedPrevious,
      cancelledCount: cancelledPrevious,
      newCustomerCount: newCustomersPrevious,
      revenueEstimate: Number(revenuePrevious.toFixed(2)),
    },
    deltas: {
      appointmentPercent: toPercentDelta(appointmentsCurrent, appointmentsPrevious),
      newCustomerPercent: toPercentDelta(newCustomersCurrent, newCustomersPrevious),
      revenuePercent: toPercentDelta(revenueCurrent, revenuePrevious),
    },
  };
}

const TONE_VALUES = new Set(['friendly', 'professional', 'balanced']);
const ANSWER_LENGTH_VALUES = new Set(['short', 'medium', 'detailed']);
const EMOJI_USAGE_VALUES = new Set(['off', 'low', 'normal']);
const BOOKING_GUIDANCE_VALUES = new Set(['low', 'medium', 'high']);
const HANDOVER_THRESHOLD_VALUES = new Set(['early', 'balanced', 'late']);
const AI_DISCLOSURE_VALUES = new Set(['always', 'onQuestion', 'never']);

function asStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const entries = Object.entries(input as Record<string, unknown>);
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      output[key] = value.trim();
    }
  }
  return output;
}

function normalizeCommonQuestions(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const output: Array<{ question: string; answer: string }> = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const question = typeof source.question === 'string' ? source.question.trim() : typeof source.q === 'string' ? source.q.trim() : '';
    const answer = typeof source.answer === 'string' ? source.answer.trim() : typeof source.a === 'string' ? source.a.trim() : '';
    if (!question && !answer) continue;
    output.push({ question, answer });
  }

  return output.slice(0, 50);
}

function parseOptionalBoolean(input: unknown): boolean | undefined {
  if (typeof input === 'boolean') {
    return input;
  }
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  return undefined;
}

function readBooleanFlag(map: Record<string, string>, key: string, fallback: boolean): boolean {
  const parsed = parseOptionalBoolean(map[key]);
  return parsed === undefined ? fallback : parsed;
}

const STAFF_COLOR_PALETTE = [
  '#B76E79',
  '#6C7BA1',
  '#8C6F56',
  '#5B8A72',
  '#7B6D8D',
  '#A86D5D',
  '#5E7F91',
  '#9A7A5C',
] as const;

function paletteColorBySeed(seed: number): string {
  const index = Math.abs(seed) % STAFF_COLOR_PALETTE.length;
  return STAFF_COLOR_PALETTE[index];
}

function randomStaffColor(): string {
  const seed = Date.now() + Math.floor(Math.random() * 1000);
  return paletteColorBySeed(seed);
}

function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return null;
}

function parseStaffServiceAssignments(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const rows: Array<{
    serviceId: number;
    customPrice: number | null;
    customDuration: number | null;
    gender: CustomerGender;
  }> = [];
  const seen = new Set<number>();

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const source = raw as Record<string, unknown>;
    const serviceId = Number(source.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0 || seen.has(serviceId)) {
      continue;
    }

    let customPrice: number | null = null;
    if (source.customPrice !== null && source.customPrice !== undefined && source.customPrice !== '') {
      const parsed = Number(source.customPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        continue;
      }
      customPrice = parsed;
    }

    let customDuration: number | null = null;
    if (source.customDuration !== null && source.customDuration !== undefined && source.customDuration !== '') {
      const parsed = Number(source.customDuration);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        continue;
      }
      customDuration = Math.round(parsed);
    }

    const gender = asCustomerGender(source.gender) ?? 'female';

    rows.push({ serviceId, customPrice, customDuration, gender });
    seen.add(serviceId);
  }

  return rows;
}

function parseServiceGenders(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  const genders: Array<'female' | 'male' | 'other'> = [];
  for (const raw of input) {
    const value = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
    if (value === 'female' || value === 'male' || value === 'other') {
      if (!genders.includes(value)) {
        genders.push(value);
      }
    }
  }

  return genders;
}

type ParsedPackageServiceQuota = {
  serviceId: number;
  initialQuota: number;
};

type CheckoutMode = 'GROUP' | 'SPLIT';
type CheckoutCloseType = 'SINGLE_PAYMENT' | 'USE_EXISTING_PACKAGE' | 'SELL_NEW_PACKAGE';

type ParsedCheckoutLine = {
  appointmentId: number;
  appointmentLineId: number | null;
  closeType: CheckoutCloseType;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER' | null;
  customerPackageId: number | null;
};

function parseCheckoutMode(value: unknown): CheckoutMode {
  if (typeof value !== 'string') return 'GROUP';
  const normalized = value.trim().toUpperCase();
  return normalized === 'SPLIT' ? 'SPLIT' : 'GROUP';
}

function parseCheckoutCloseType(value: unknown): CheckoutCloseType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'SINGLE_PAYMENT' || normalized === 'USE_EXISTING_PACKAGE' || normalized === 'SELL_NEW_PACKAGE') {
    return normalized;
  }
  return null;
}

function parseCheckoutLines(input: unknown): ParsedCheckoutLine[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const rows: ParsedCheckoutLine[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const appointmentId = Number((row as any).appointmentId);
    const appointmentLineIdRaw = (row as any).appointmentLineId;
    const appointmentLineId =
      appointmentLineIdRaw === null || appointmentLineIdRaw === undefined || appointmentLineIdRaw === ''
        ? null
        : Number(appointmentLineIdRaw);
    const normalizedLineId = Number.isInteger(appointmentLineId) && appointmentLineId > 0 ? appointmentLineId : null;
    const key = `${appointmentId}:${normalizedLineId || 0}`;
    if (!Number.isInteger(appointmentId) || appointmentId <= 0 || seen.has(key)) continue;
    const closeType = parseCheckoutCloseType((row as any).closeType);
    if (!closeType) continue;
    const paymentMethod = asPaymentMethod((row as any).paymentMethod);
    const customerPackageIdRaw = (row as any).customerPackageId;
    const customerPackageId =
      customerPackageIdRaw === null || customerPackageIdRaw === undefined || customerPackageIdRaw === ''
        ? null
        : Number(customerPackageIdRaw);
    rows.push({
      appointmentId,
      appointmentLineId: normalizedLineId,
      closeType,
      paymentMethod,
      customerPackageId: Number.isInteger(customerPackageId) && customerPackageId > 0 ? customerPackageId : null,
    });
    seen.add(key);
  }
  return rows;
}

function parseServiceIdsFromAppointmentPayload(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const serviceIds: number[] = [];
  const seen = new Set<number>();
  for (const item of input) {
    const candidate =
      typeof item === 'number'
        ? item
        : typeof item === 'string'
        ? Number(item)
        : item && typeof item === 'object'
        ? Number((item as any).serviceId)
        : NaN;
    if (!Number.isInteger(candidate) || candidate <= 0 || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    serviceIds.push(candidate);
  }
  return serviceIds;
}

function parsePackageScopeType(value: unknown): 'SINGLE_SERVICE' | 'POOL' {
  if (typeof value !== 'string') {
    return 'SINGLE_SERVICE';
  }
  const normalized = value.trim().toUpperCase();
  return normalized === 'POOL' ? 'POOL' : 'SINGLE_SERVICE';
}

function parsePackageServices(input: unknown): ParsedPackageServiceQuota[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const rows: ParsedPackageServiceQuota[] = [];
  const seen = new Set<number>();
  for (const row of input) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const serviceId = Number((row as any).serviceId);
    const initialQuota = Number((row as any).initialQuota);
    if (!Number.isInteger(serviceId) || serviceId <= 0 || seen.has(serviceId)) {
      continue;
    }
    if (!Number.isFinite(initialQuota) || initialQuota <= 0) {
      continue;
    }
    seen.add(serviceId);
    rows.push({
      serviceId,
      initialQuota: Math.floor(initialQuota),
    });
  }
  return rows;
}

function parseDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parsePriceOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function asAppointmentStatus(value: unknown): 'BOOKED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'BOOKED' || normalized === 'COMPLETED' || normalized === 'CANCELLED' || normalized === 'NO_SHOW') {
    return normalized;
  }
  return null;
}

async function refreshCustomerPackageStatus(tx: any, customerPackageId: number, now: Date) {
  const pkg = await (tx as any).customerPackage.findUnique({
    where: { id: customerPackageId },
    include: {
      serviceBalances: {
        select: { remainingQuota: true },
      },
    },
  });

  if (!pkg) {
    return null;
  }
  if (pkg.status === 'CANCELLED') {
    return pkg.status;
  }

  let nextStatus: 'ACTIVE' | 'DEPLETED' | 'EXPIRED' = 'ACTIVE';
  if (pkg.expiresAt && pkg.expiresAt < now) {
    nextStatus = 'EXPIRED';
  } else {
    const hasRemaining = (pkg.serviceBalances || []).some((item: any) => item.remainingQuota > 0);
    nextStatus = hasRemaining ? 'ACTIVE' : 'DEPLETED';
  }

  if (pkg.status !== nextStatus) {
    await (tx as any).customerPackage.update({
      where: { id: customerPackageId },
      data: { status: nextStatus },
    });
  }
  return nextStatus;
}

function sortByNearestExpiry(items: any[]) {
  return [...items].sort((a, b) => {
    const aExpiry = a.customerPackage?.expiresAt ? new Date(a.customerPackage.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bExpiry = b.customerPackage?.expiresAt ? new Date(b.customerPackage.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aExpiry !== bExpiry) {
      return aExpiry - bExpiry;
    }
    const aCreated = a.customerPackage?.createdAt ? new Date(a.customerPackage.createdAt).getTime() : 0;
    const bCreated = b.customerPackage?.createdAt ? new Date(b.customerPackage.createdAt).getTime() : 0;
    if (aCreated !== bCreated) {
      return aCreated - bCreated;
    }
    return (a.id || 0) - (b.id || 0);
  });
}

async function consumePackageForAppointmentService(tx: any, input: {
  salonId: number;
  customerId: number;
  appointmentId: number;
  appointmentLineId?: number | null;
  serviceId: number;
  now: Date;
}) {
  const { salonId, customerId, appointmentId, appointmentLineId, serviceId, now } = input;

  const existingConsumption = await tx.appointmentPackageConsumption.findFirst({
    where: {
      appointmentId,
      appointmentLineId: appointmentLineId ?? null,
      serviceId,
    },
  });
  if (existingConsumption && !existingConsumption.restoredAt) {
    return { type: 'IDEMPOTENT', serviceId };
  }

  await (tx as any).customerPackage.updateMany({
    where: {
      salonId,
      customerId,
      status: 'ACTIVE',
      expiresAt: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });

  const eligibleBalancesRaw = await (tx as any).customerPackageServiceBalance.findMany({
    where: {
      serviceId,
      remainingQuota: { gt: 0 },
      customerPackage: {
        salonId,
        customerId,
        status: 'ACTIVE',
        AND: [
          {
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          },
          {
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
        ],
      },
    },
    include: {
      customerPackage: {
        select: { id: true, expiresAt: true, createdAt: true },
      },
    },
  });
  const eligibleBalances = sortByNearestExpiry(eligibleBalancesRaw);
  const selectedBalance = eligibleBalances[0];

  if (!selectedBalance) {
    const expiredBalance = await (tx as any).customerPackageServiceBalance.findFirst({
      where: {
        serviceId,
        remainingQuota: { gt: 0 },
        customerPackage: {
          salonId,
          customerId,
          expiresAt: { lt: now },
        },
      },
      include: { customerPackage: { select: { id: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    const actionType = expiredBalance ? 'SKIPPED_EXPIRED' : 'SKIPPED_NO_ELIGIBLE_PACKAGE';
    await (tx as any).packageLedger.create({
      data: {
        salonId,
        customerId,
        customerPackageId: expiredBalance?.customerPackageId || null,
        serviceId,
        appointmentId,
        appointmentLineId: appointmentLineId ?? null,
        actionType,
        delta: 0,
        balanceAfter: null,
        reason: actionType,
        metadata: {
          source: 'appointment_status_completed',
        },
      },
    });

    return {
      type: actionType,
      serviceId,
    };
  }

  const updatedBalance = await (tx as any).customerPackageServiceBalance.update({
    where: { id: selectedBalance.id },
    data: {
      remainingQuota: { decrement: 1 },
    },
    select: {
      id: true,
      customerPackageId: true,
      remainingQuota: true,
    },
  });

  if (existingConsumption?.id) {
    await tx.appointmentPackageConsumption.update({
      where: { id: existingConsumption.id },
      data: {
        salonId,
        customerId,
        customerPackageId: selectedBalance.customerPackageId,
        consumed: 1,
        restoredAt: null,
      },
    });
  } else {
    await tx.appointmentPackageConsumption.create({
      data: {
        salonId,
        appointmentId,
        appointmentLineId: appointmentLineId ?? null,
        customerId,
        customerPackageId: selectedBalance.customerPackageId,
        serviceId,
        consumed: 1,
      },
    });
  }

  await (tx as any).packageLedger.create({
    data: {
      salonId,
      customerId,
      customerPackageId: selectedBalance.customerPackageId,
      serviceId,
      appointmentId,
      appointmentLineId: appointmentLineId ?? null,
      actionType: 'AUTO_CONSUME',
      delta: -1,
      balanceAfter: updatedBalance.remainingQuota,
      reason: 'appointment_completed',
      metadata: {
        source: 'appointment_status_completed',
      },
    },
  });

  await refreshCustomerPackageStatus(tx, updatedBalance.customerPackageId, now);

  return {
    type: 'AUTO_CONSUME',
    serviceId,
    customerPackageId: updatedBalance.customerPackageId,
    balanceAfter: updatedBalance.remainingQuota,
  };
}

async function consumeSpecificPackageForAppointmentService(tx: any, input: {
  salonId: number;
  customerId: number;
  appointmentId: number;
  appointmentLineId?: number | null;
  serviceId: number;
  customerPackageId: number;
  now: Date;
  source: 'checkout_existing' | 'checkout_new';
}) {
  const { salonId, customerId, appointmentId, appointmentLineId, serviceId, customerPackageId, now, source } = input;

  const existingConsumption = await tx.appointmentPackageConsumption.findFirst({
    where: {
      appointmentId,
      appointmentLineId: appointmentLineId ?? null,
      serviceId,
    },
  });
  if (existingConsumption && !existingConsumption.restoredAt) {
    return { type: 'IDEMPOTENT', serviceId, customerPackageId };
  }

  const targetPackage = await (tx as any).customerPackage.findFirst({
    where: {
      id: customerPackageId,
      salonId,
      customerId,
      status: 'ACTIVE',
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      ],
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });
  if (!targetPackage) {
    await (tx as any).packageLedger.create({
      data: {
        salonId,
        customerId,
        customerPackageId,
        serviceId,
        appointmentId,
        appointmentLineId: appointmentLineId ?? null,
        actionType: 'SKIPPED_NO_ELIGIBLE_PACKAGE',
        delta: 0,
        balanceAfter: null,
        reason: 'checkout_package_not_eligible',
        metadata: { source },
      },
    });
    return { type: 'SKIPPED_NO_ELIGIBLE_PACKAGE', serviceId, customerPackageId };
  }

  const targetBalance = await (tx as any).customerPackageServiceBalance.findFirst({
    where: {
      customerPackageId,
      serviceId,
      remainingQuota: { gt: 0 },
    },
    select: {
      id: true,
      remainingQuota: true,
    },
  });
  if (!targetBalance) {
    await (tx as any).packageLedger.create({
      data: {
        salonId,
        customerId,
        customerPackageId,
        serviceId,
        appointmentId,
        appointmentLineId: appointmentLineId ?? null,
        actionType: 'SKIPPED_NO_ELIGIBLE_PACKAGE',
        delta: 0,
        balanceAfter: null,
        reason: 'checkout_service_quota_not_available',
        metadata: { source },
      },
    });
    return { type: 'SKIPPED_NO_ELIGIBLE_PACKAGE', serviceId, customerPackageId };
  }

  const updatedBalance = await (tx as any).customerPackageServiceBalance.update({
    where: { id: targetBalance.id },
    data: {
      remainingQuota: { decrement: 1 },
    },
    select: {
      remainingQuota: true,
    },
  });

  if (existingConsumption?.id) {
    await tx.appointmentPackageConsumption.update({
      where: { id: existingConsumption.id },
      data: {
        salonId,
        customerId,
        customerPackageId,
        consumed: 1,
        restoredAt: null,
      },
    });
  } else {
    await tx.appointmentPackageConsumption.create({
      data: {
        salonId,
        appointmentId,
        appointmentLineId: appointmentLineId ?? null,
        customerId,
        customerPackageId,
        serviceId,
        consumed: 1,
      },
    });
  }

  await (tx as any).packageLedger.create({
    data: {
      salonId,
      customerId,
      customerPackageId,
      serviceId,
      appointmentId,
      appointmentLineId: appointmentLineId ?? null,
      actionType: 'AUTO_CONSUME',
      delta: -1,
      balanceAfter: updatedBalance.remainingQuota,
      reason: 'appointment_completed',
      metadata: {
        source,
      },
    },
  });

  await refreshCustomerPackageStatus(tx, customerPackageId, now);

  return {
    type: 'AUTO_CONSUME',
    serviceId,
    customerPackageId,
    balanceAfter: updatedBalance.remainingQuota,
  };
}

async function restorePackageForAppointmentService(tx: any, input: {
  salonId: number;
  customerId: number;
  appointmentId: number;
  appointmentLineId?: number | null;
  serviceId: number;
  now: Date;
  reason: string;
}) {
  const { salonId, customerId, appointmentId, appointmentLineId, serviceId, now, reason } = input;
  const consumption = await tx.appointmentPackageConsumption.findFirst({
    where: {
      appointmentId,
      appointmentLineId: appointmentLineId ?? null,
      serviceId,
    },
  });

  if (!consumption || consumption.restoredAt) {
    return { type: 'NO_CONSUMPTION', serviceId };
  }

  const balance = await (tx as any).customerPackageServiceBalance.findUnique({
    where: {
      customerPackageId_serviceId: {
        customerPackageId: consumption.customerPackageId,
        serviceId,
      },
    },
    select: {
      id: true,
      remainingQuota: true,
      customerPackageId: true,
    },
  });

  if (!balance) {
    return { type: 'BALANCE_NOT_FOUND', serviceId };
  }

  const restoredBalance = await (tx as any).customerPackageServiceBalance.update({
    where: { id: balance.id },
    data: {
      remainingQuota: { increment: consumption.consumed },
    },
    select: {
      customerPackageId: true,
      remainingQuota: true,
    },
  });

  await tx.appointmentPackageConsumption.update({
    where: { id: consumption.id },
    data: {
      restoredAt: now,
    },
  });

  await (tx as any).packageLedger.create({
    data: {
      salonId,
      customerId,
      customerPackageId: consumption.customerPackageId,
      serviceId,
      appointmentId,
      appointmentLineId: appointmentLineId ?? null,
      actionType: 'AUTO_RESTORE',
      delta: consumption.consumed,
      balanceAfter: restoredBalance.remainingQuota,
      reason,
      metadata: {
        source: 'appointment_status_rollback',
      },
    },
  });

  await refreshCustomerPackageStatus(tx, restoredBalance.customerPackageId, now);

  return {
    type: 'AUTO_RESTORE',
    serviceId,
    customerPackageId: restoredBalance.customerPackageId,
    balanceAfter: restoredBalance.remainingQuota,
  };
}

function mapAppointmentStatusToLineStatus(status: string | null | undefined): 'BOOKED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED' {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'COMPLETED') return 'COMPLETED';
  if (normalized === 'CANCELLED') return 'CANCELLED';
  if (normalized === 'NO_SHOW') return 'NO_SHOW';
  return 'BOOKED';
}

async function ensureDefaultAppointmentLine(tx: any, appointment: any) {
  const existing = await (tx as any).appointmentLine.findFirst({
    where: { appointmentId: Number(appointment.id) },
    orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
  });
  if (existing) return existing;

  const startTime = appointment.startTime ? new Date(appointment.startTime) : null;
  const endTime = appointment.endTime ? new Date(appointment.endTime) : null;
  const durationMinutes =
    startTime && endTime ? Math.max(1, Math.floor((endTime.getTime() - startTime.getTime()) / 60000)) : null;

  return (tx as any).appointmentLine.create({
    data: {
      appointmentId: Number(appointment.id),
      salonId: Number(appointment.salonId),
      customerId: Number.isInteger(appointment.customerId) && appointment.customerId > 0 ? Number(appointment.customerId) : null,
      serviceId: Number(appointment.serviceId),
      specialistId: Number.isInteger(appointment.staffId) && appointment.staffId > 0 ? Number(appointment.staffId) : null,
      startTime: startTime || null,
      endTime: endTime || null,
      durationMinutes,
      listPrice: appointment.listPrice ?? null,
      finalPrice: appointment.finalPrice ?? null,
      status: mapAppointmentStatusToLineStatus(appointment.status),
      paymentMethod: appointment.paymentMethod || null,
      paymentRecordedAt: appointment.paymentRecordedAt || null,
      notes: appointment.notes || null,
      orderIndex: 0,
    },
  });
}

async function recomputeAndPersistAppointmentStatusFromLines(tx: any, appointmentId: number) {
  const lines = await (tx as any).appointmentLine.findMany({
    where: { appointmentId },
    select: { status: true },
  });
  if (!lines.length) {
    return null;
  }
  const statuses = lines.map((line: any) => String(line.status || '').toUpperCase());
  let nextStatus: 'BOOKED' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED' = 'BOOKED';
  if (statuses.every((status) => status === 'COMPLETED')) {
    nextStatus = 'COMPLETED';
  } else if (statuses.every((status) => status === 'CANCELLED')) {
    nextStatus = 'CANCELLED';
  } else if (statuses.every((status) => status === 'NO_SHOW')) {
    nextStatus = 'NO_SHOW';
  } else {
    nextStatus = 'BOOKED';
  }

  await tx.appointment.update({
    where: { id: appointmentId },
    data: {
      status: nextStatus,
      ...(nextStatus === 'COMPLETED' ? {} : { paymentMethod: null, paymentRecordedAt: null }),
    },
  });

  return nextStatus;
}

function toPackageTemplateDto(item: any) {
  return {
    id: item.id,
    salonId: item.salonId,
    name: item.name,
    scopeType: item.scopeType,
    isActive: item.isActive,
    price: item.price,
    validityDays: item.validityDays,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    services: (item.services || []).map((row: any) => ({
      id: row.id,
      serviceId: row.serviceId,
      initialQuota: row.initialQuota,
      service: row.service
        ? {
            id: row.service.id,
            name: row.service.name,
          }
        : null,
    })),
  };
}

function toCustomerPackageDto(item: any) {
  return {
    id: item.id,
    customerId: item.customerId,
    packageTemplateId: item.packageTemplateId,
    sourceType: item.sourceType,
    scopeType: item.scopeType,
    status: item.status,
    name: item.name,
    startsAt: item.startsAt,
    expiresAt: item.expiresAt,
    price: item.price,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    template: item.template
      ? {
          id: item.template.id,
          name: item.template.name,
        }
      : null,
    serviceBalances: (item.serviceBalances || []).map((row: any) => ({
      id: row.id,
      serviceId: row.serviceId,
      initialQuota: row.initialQuota,
      remainingQuota: row.remainingQuota,
      service: row.service
        ? {
            id: row.service.id,
            name: row.service.name,
          }
        : null,
    })),
  };
}

function mapStaffForMobile(staff: any) {
  const serviceById = new Map<number, any>();

  for (const row of staff?.StaffService || []) {
    if (!row?.isactive || !row?.Service) {
      continue;
    }

    const existing = serviceById.get(row.serviceId);
    if (!existing || (existing.gender !== 'female' && row.gender === 'female')) {
      const service = row.Service;
      serviceById.set(row.serviceId, {
        serviceId: service.id,
        name: service.name,
        categoryKey: service.ServiceCategory?.categoryRef?.key || service.category || 'OTHER',
        categoryName:
          service.ServiceCategory?.name || service.ServiceCategory?.categoryRef?.defaultName || service.category || 'Diğer',
        defaultPrice: service.price,
        defaultDuration: service.duration,
        customPrice: row.price !== service.price ? row.price : null,
        customDuration: row.duration !== service.duration ? row.duration : null,
        effectivePrice: row.price,
        effectiveDuration: row.duration,
        gender: row.gender,
      });
    }
  }

  const services = Array.from(serviceById.values()).sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  return {
    id: staff.id,
    name: staff.name,
    title: staff.title,
    bio: staff.bio,
    phone: staff.phone,
    profileImageUrl: staff.profileImageUrl,
    themeColor: normalizeThemeColor(staff.themeColor) || paletteColorBySeed(staff.id),
    services,
    serviceCount: services.length,
  };
}

function isPackageSchemaNotReadyError(error: any): boolean {
  if (!error) return false;
  if (error.code === 'P2021') return true;
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return (
    message.includes('packagetemplate') ||
    message.includes('customerpackage') ||
    message.includes('packag ledger') ||
    message.includes('relation') && message.includes('does not exist')
  );
}

router.get('/appointments', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const from = parseIsoDate(req.query.from);
  const to = parseIsoDate(req.query.to);

  if (!from || !to) {
    return res.status(400).json({ message: 'from and to query params are required ISO dates.' });
  }

  if (from >= to) {
    return res.status(400).json({ message: 'from must be earlier than to.' });
  }

  const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
  const staffId = typeof req.query.staffId === 'string' ? Number(req.query.staffId) : null;
  const limit = asPositiveInt(req.query.limit, 250, 1, 500);

  try {
    const where: any = {
      salonId,
      startTime: { lt: to },
      endTime: { gt: from },
    };

    if (statusFilter) {
      where.status = statusFilter;
    }
    if (staffId && staffId > 0) {
      where.staffId = staffId;
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        service: {
          select: {
            id: true,
            name: true,
            duration: true,
            price: true,
            requiresSpecialist: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        appointmentLines: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                duration: true,
                price: true,
                requiresSpecialist: true,
              },
            },
            specialist: {
              select: {
                id: true,
                name: true,
                title: true,
              },
            },
          },
          orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return res.status(200).json({
      from: from.toISOString(),
      to: to.toISOString(),
      items: appointments,
      count: appointments.length,
    });
  } catch (error) {
    console.error('Admin appointments window query error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/appointments', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const startTime = parseIsoDate(req.body?.startTime);
  const customerIdRaw = req.body?.customerId;
  const customerId =
    customerIdRaw === null || customerIdRaw === undefined || customerIdRaw === ''
      ? null
      : Number(customerIdRaw);
  const explicitCustomerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
  const explicitCustomerPhone = typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim() : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
  const gender =
    typeof req.body?.gender === 'string' && ['male', 'female', 'other'].includes(req.body.gender)
      ? req.body.gender
      : 'female';

  const normalizedServices = Array.isArray(req.body?.services) && req.body.services.length > 0
    ? req.body.services
        .map((item: any) => ({
          serviceId: Number(item?.serviceId),
          staffId: item?.staffId === null || item?.staffId === undefined || item?.staffId === '' ? null : Number(item.staffId),
          duration: item?.duration === null || item?.duration === undefined || item?.duration === '' ? null : Number(item.duration),
        }))
        .filter((item: any) => Number.isInteger(item.serviceId) && item.serviceId > 0)
    : null;

  const fallbackServiceId = Number(req.body?.serviceId);
  const fallbackStaffId = Number(req.body?.staffId);
  const servicesToCreate =
    normalizedServices && normalizedServices.length > 0
      ? normalizedServices
      : Number.isInteger(fallbackServiceId) && fallbackServiceId > 0
      ? [{ serviceId: fallbackServiceId, staffId: Number.isInteger(fallbackStaffId) && fallbackStaffId > 0 ? fallbackStaffId : null, duration: null }]
      : [];

  if (!startTime) {
    return res.status(400).json({ message: 'startTime is required as ISO date.' });
  }
  if (!servicesToCreate.length) {
    return res.status(400).json({ message: 'At least one service is required.' });
  }
  if (customerId !== null && (!Number.isInteger(customerId) || customerId <= 0)) {
    return res.status(400).json({ message: 'customerId must be a positive integer.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [existingCustomerById, existingCustomerByPhone] = await Promise.all([
        customerId
          ? tx.customer.findFirst({
              where: { id: customerId, salonId },
              select: { id: true, name: true, phone: true, gender: true },
            })
          : Promise.resolve(null),
        !customerId && explicitCustomerPhone
          ? tx.customer.findFirst({
              where: { salonId, phone: explicitCustomerPhone },
              select: { id: true, name: true, phone: true, gender: true },
            })
          : Promise.resolve(null),
      ]);

      if (customerId && !existingCustomerById) {
        return { error: { code: 404, message: 'Customer not found.' } };
      }

      let customer = existingCustomerById || existingCustomerByPhone || null;
      if (!customer) {
        if (!explicitCustomerPhone) {
          return { error: { code: 400, message: 'customerPhone is required when customer is not selected.' } };
        }
        customer = await tx.customer.create({
          data: {
            salonId,
            name: explicitCustomerName || null,
            phone: explicitCustomerPhone,
            gender,
          },
          select: { id: true, name: true, phone: true, gender: true },
        });
      }

      const customerName = (explicitCustomerName || customer.name || '').trim() || 'Misafir Müşteri';
      const customerPhone = (explicitCustomerPhone || customer.phone || '').trim();
      if (!customerPhone) {
        return { error: { code: 400, message: 'customerPhone is required.' } };
      }

      const serviceIds: number[] = Array.from(
        new Set<number>(servicesToCreate.map((item: any) => Number(item.serviceId)).filter((id: number) => Number.isInteger(id) && id > 0)),
      );
      const services = await tx.service.findMany({
        where: { salonId, id: { in: serviceIds } },
        select: { id: true, name: true, duration: true, requiresSpecialist: true },
      });
      const serviceMap = new Map(services.map((service) => [service.id, service]));
      if (services.length !== serviceIds.length) {
        return { error: { code: 404, message: 'One or more services were not found.' } };
      }

      const allStaffServiceRows = await tx.staffService.findMany({
        where: {
          serviceId: { in: serviceIds },
          isactive: true,
          Staff: { salonId },
        },
        select: {
          staffId: true,
          serviceId: true,
          duration: true,
        },
      });
      const staffServiceMap = new Map<string, { duration: number }>();
      const availableStaffByService = new Map<number, number[]>();
      for (const row of allStaffServiceRows) {
        staffServiceMap.set(`${row.serviceId}:${row.staffId}`, { duration: row.duration });
        const list = availableStaffByService.get(row.serviceId) || [];
        if (!list.includes(row.staffId)) {
          list.push(row.staffId);
        }
        availableStaffByService.set(row.serviceId, list);
      }

      const plannedBlocks: Array<{
        serviceId: number;
        staffId: number;
        startTime: Date;
        endTime: Date;
      }> = [];

      let cursor = new Date(startTime);
      for (const block of servicesToCreate) {
        const service = serviceMap.get(block.serviceId)!;
        const candidates = availableStaffByService.get(block.serviceId) || [];

        let selectedStaffId = block.staffId;
        if (selectedStaffId && !candidates.includes(selectedStaffId)) {
          return { error: { code: 400, message: `${service.name} için seçilen uzman uygun değil.` } };
        }

        if (!selectedStaffId) {
          if (service.requiresSpecialist && candidates.length > 1) {
            return { error: { code: 400, message: `${service.name} için uzman seçimi zorunlu.` } };
          }
          if (candidates.length === 0) {
            return { error: { code: 400, message: `${service.name} için uygun aktif uzman bulunamadı.` } };
          }
          selectedStaffId = candidates[0];
        }

        const staffService = staffServiceMap.get(`${block.serviceId}:${selectedStaffId}`);
        const duration = Math.max(1, block.duration || staffService?.duration || service.duration || 30);
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

        const overlap = await tx.appointment.findFirst({
          where: {
            salonId,
            staffId: selectedStaffId,
            status: { in: ['BOOKED'] },
            startTime: { lt: slotEnd },
            endTime: { gt: slotStart },
          },
          select: { id: true, startTime: true, endTime: true },
        });

        if (overlap) {
          return {
            error: {
              code: 409,
              message: `${service.name} için ${slotStart.toISOString()} saatinde uzman müsait değil.`,
              conflict: overlap,
            },
          };
        }

        plannedBlocks.push({
          serviceId: block.serviceId,
          staffId: selectedStaffId,
          startTime: slotStart,
          endTime: slotEnd,
        });
        cursor = new Date(slotEnd);
      }

      const createdAppointments = [];
      for (const block of plannedBlocks) {
        const appointment = await tx.appointment.create({
          data: {
            salonId,
            customerId: customer.id,
            customerName,
            customerPhone,
            serviceId: block.serviceId,
            staffId: block.staffId,
            startTime: block.startTime,
            endTime: block.endTime,
            status: 'BOOKED',
            source: 'ADMIN',
            notes,
            gender: (customer.gender || gender) as any,
          },
          include: {
            service: {
              select: {
                id: true,
                name: true,
                duration: true,
                price: true,
                requiresSpecialist: true,
              },
            },
            staff: {
              select: {
                id: true,
                name: true,
                title: true,
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },
          },
        });
        await ensureDefaultAppointmentLine(tx, appointment);
        createdAppointments.push(appointment);
      }

      return { appointments: createdAppointments };
    });

    if ('error' in result) {
      return res.status(result.error.code).json({
        message: result.error.message,
        ...(result.error.conflict ? { conflict: result.error.conflict } : {}),
      });
    }

    try {
      const timezone = await getSalonTimezone(salonId);
      const first = result.appointments[0];
      if (first) {
        await notifySameDayAppointmentChange({
          salonId,
          event: 'CREATED',
          appointmentId: first.id,
          customerName: first.customerName,
          serviceName: first.service?.name || null,
          startTime: new Date(first.startTime),
          timezone,
        });
      }
    } catch (notifyError) {
      console.error('Appointment create notification error:', notifyError);
    }

    return res.status(201).json({
      item: result.appointments[0],
      items: result.appointments,
      count: result.appointments.length,
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Aynı telefon numarasıyla kayıtlı müşteri zaten var.' });
    }
    console.error('Admin create appointment error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const cursorRaw = typeof req.query.cursor === 'string' ? Number(req.query.cursor) : null;
  const limit = asPositiveInt(req.query.limit, 20, 1, 100);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  if (cursorRaw !== null && (!Number.isInteger(cursorRaw) || cursorRaw <= 0)) {
    return res.status(400).json({ message: 'cursor must be a positive integer.' });
  }

  try {
    const where: any = { salonId };

    if (cursorRaw) {
      where.id = { lt: cursorRaw };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { instagram: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.customer.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        name: true,
        phone: true,
        instagram: true,
        gender: true,
        birthDate: true,
        acceptMarketing: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1]?.id || '') : null;

    return res.status(200).json({
      items: items.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        instagram: row.instagram,
        gender: row.gender,
        birthDate: row.birthDate,
        acceptMarketing: row.acceptMarketing,
        appointmentCount: row._count.appointments,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error('Admin customers cursor query error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/customers', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const instagram = typeof req.body?.instagram === 'string' ? req.body.instagram.trim() : '';
  const gender = typeof req.body?.gender === 'string' ? req.body.gender : null;
  const acceptMarketing = Boolean(req.body?.acceptMarketing);
  const birthDateInput = req.body?.birthDate;

  if (!phone) {
    return res.status(400).json({ message: 'phone is required.' });
  }

  let birthDate: Date | null = null;
  if (birthDateInput !== null && birthDateInput !== undefined && birthDateInput !== '') {
    const parsed = new Date(String(birthDateInput));
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ message: 'birthDate is invalid.' });
    }
    birthDate = parsed;
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        salonId,
        name: name || null,
        phone,
        instagram: instagram || null,
        gender: gender && ['male', 'female', 'other'].includes(gender) ? (gender as any) : null,
        birthDate,
        acceptMarketing,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        instagram: true,
        gender: true,
        birthDate: true,
        acceptMarketing: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({ customer });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu telefon salon icin zaten kayitli.' });
    }
    console.error('Admin create customer error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  try {
    const [customer, appointments, riskProfile, latestDiscount] = await prisma.$transaction([
      prisma.customer.findFirst({
        where: { id: customerId, salonId },
        select: {
          id: true,
          name: true,
          phone: true,
          instagram: true,
          gender: true,
          birthDate: true,
          acceptMarketing: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.appointment.findMany({
        where: { salonId, customerId },
        include: {
          service: { select: { id: true, name: true, duration: true, price: true } },
          staff: { select: { id: true, name: true } },
        },
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
      prisma.customerRiskProfile.findUnique({
        where: { customerId_salonId: { customerId, salonId } },
        select: {
          riskScore: true,
          noShowCount: true,
          noShows: true,
          totalBookings: true,
          lastCalculatedAt: true,
        },
      }),
      prisma.customerBehaviorLog.findFirst({
        where: { salonId, customerId, action: 'CUSTOMER_DISCOUNT_SET' },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        select: { metadata: true, occurredAt: true, createdAt: true },
      }),
    ]);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const nonCancelled = appointments.filter((item) => item.status !== 'CANCELLED');
    const uniqueDayCount = new Set(nonCancelled.map((item) => getAppointmentDayKey(item.startTime))).size;
    const completedAppointments = appointments.filter((item) => item.status === 'COMPLETED');
    const totalRevenue = completedAppointments.reduce((sum, item) => sum + (item.service?.price || 0), 0);

    const favoriteStaffCounter = new Map<number, { id: number; name: string; count: number }>();
    for (const appointment of nonCancelled) {
      const existing = favoriteStaffCounter.get(appointment.staffId);
      if (existing) {
        existing.count += 1;
      } else {
        favoriteStaffCounter.set(appointment.staffId, {
          id: appointment.staff.id,
          name: appointment.staff.name,
          count: 1,
        });
      }
    }
    const favoriteStaff =
      Array.from(favoriteStaffCounter.values()).sort((a, b) => b.count - a.count || a.id - b.id)[0] || null;

    const noShowCountFromData = appointments.filter((item) => item.status === 'NO_SHOW').length;
    const totalBookingsFromData = nonCancelled.length;
    const noShowRatio = totalBookingsFromData > 0 ? noShowCountFromData / totalBookingsFromData : 0;
    const riskScoreRaw =
      typeof riskProfile?.riskScore === 'number' ? riskProfile.riskScore : Math.min(100, noShowRatio * 100);
    const riskScore = Number(Math.max(0, Math.min(100, riskScoreRaw)).toFixed(1));

    let discount: any = null;
    if (latestDiscount?.metadata && typeof latestDiscount.metadata === 'object' && !Array.isArray(latestDiscount.metadata)) {
      const raw = latestDiscount.metadata as Record<string, any>;
      const kind = asDiscountKind(raw.kind);
      const value = typeof raw.value === 'number' ? raw.value : Number(raw.value);
      if (kind && Number.isFinite(value) && value > 0) {
        discount = {
          kind,
          value,
          note: typeof raw.note === 'string' ? raw.note : null,
          notifyCustomer: Boolean(raw.notifyCustomer),
          messageTemplate: typeof raw.messageTemplate === 'string' ? raw.messageTemplate : null,
          lastNotificationStatus:
            typeof raw.lastNotificationStatus === 'string' ? raw.lastNotificationStatus : null,
          updatedAt: (latestDiscount.occurredAt || latestDiscount.createdAt || new Date()).toISOString(),
        };
      }
    }

    return res.status(200).json({
      customer,
      summary: {
        totalAppointmentDays: uniqueDayCount,
        totalRevenue,
        favoriteStaff,
        noShowRiskScore: riskScore,
        noShowRiskLevel: toRiskLevel(riskScore),
        noShowCount: typeof riskProfile?.noShows === 'number' ? riskProfile.noShows : noShowCountFromData,
        totalBookings:
          typeof riskProfile?.totalBookings === 'number' ? riskProfile.totalBookings : totalBookingsFromData,
      },
      discount,
      appointments: appointments.slice(0, 30),
      appointmentsWithFeedback: appointments
        .filter((item) => item.customerRating !== null || item.customerReview !== null)
        .slice(0, 30)
        .map((item) => ({
          id: item.id,
          startTime: item.startTime,
          endTime: item.endTime,
          status: item.status,
          service: item.service,
          staff: item.staff,
          customerRating: item.customerRating,
          customerReview: item.customerReview,
          customerReviewedAt: item.customerReviewedAt,
        })),
    });
  } catch (error) {
    console.error('Admin customer detail error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/customers/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const nameInput = req.body?.name;
  const phoneInput = req.body?.phone;
  const instagramInput = req.body?.instagram;
  const birthDateInput = req.body?.birthDate;
  const acceptMarketingInput = req.body?.acceptMarketing;
  const genderInput = req.body?.gender;

  if (nameInput !== undefined && nameInput !== null && typeof nameInput !== 'string') {
    return res.status(400).json({ message: 'name must be a string or null.' });
  }
  if (phoneInput !== undefined && typeof phoneInput !== 'string') {
    return res.status(400).json({ message: 'phone must be a string.' });
  }
  if (instagramInput !== undefined && instagramInput !== null && typeof instagramInput !== 'string') {
    return res.status(400).json({ message: 'instagram must be a string or null.' });
  }
  if (acceptMarketingInput !== undefined && typeof acceptMarketingInput !== 'boolean') {
    return res.status(400).json({ message: 'acceptMarketing must be a boolean.' });
  }

  let parsedBirthDate: Date | null | undefined = undefined;
  if (birthDateInput !== undefined) {
    if (birthDateInput === null || birthDateInput === '') {
      parsedBirthDate = null;
    } else if (typeof birthDateInput === 'string') {
      const parsed = new Date(birthDateInput);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'birthDate is invalid.' });
      }
      parsedBirthDate = parsed;
    } else {
      return res.status(400).json({ message: 'birthDate must be a string, empty string, or null.' });
    }
  }

  let parsedGender: 'male' | 'female' | 'other' | null | undefined = undefined;
  if (genderInput !== undefined) {
    if (genderInput === null || genderInput === '') {
      parsedGender = null;
    } else {
      parsedGender = asCustomerGender(genderInput);
      if (!parsedGender) {
        return res.status(400).json({ message: 'gender must be male, female, other, or null.' });
      }
    }
  }

  const normalizedPhone = typeof phoneInput === 'string' ? phoneInput.trim() : undefined;
  if (phoneInput !== undefined && !normalizedPhone) {
    return res.status(400).json({ message: 'phone cannot be empty.' });
  }

  let normalizedInstagram: string | null | undefined = undefined;
  if (instagramInput !== undefined) {
    if (instagramInput === null) {
      normalizedInstagram = null;
    } else {
      const trimmed = instagramInput.trim().replace(/^@/, '');
      normalizedInstagram = trimmed || null;
    }
  }

  const updateData: any = {};
  if (nameInput !== undefined) {
    if (nameInput === null) {
      updateData.name = null;
    } else {
      const trimmed = nameInput.trim();
      updateData.name = trimmed || null;
    }
  }
  if (normalizedPhone !== undefined) {
    updateData.phone = normalizedPhone;
  }
  if (normalizedInstagram !== undefined) {
    updateData.instagram = normalizedInstagram;
  }
  if (parsedBirthDate !== undefined) {
    updateData.birthDate = parsedBirthDate;
  }
  if (acceptMarketingInput !== undefined) {
    updateData.acceptMarketing = acceptMarketingInput;
  }
  if (parsedGender !== undefined) {
    updateData.gender = parsedGender;
  }

  if (!Object.keys(updateData).length) {
    return res.status(400).json({ message: 'No valid fields provided for update.' });
  }

  try {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, salonId },
      select: { id: true, phone: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    if (updateData.phone && updateData.phone !== existing.phone) {
      const conflict = await prisma.customer.findFirst({
        where: {
          salonId,
          phone: updateData.phone,
          id: { not: customerId },
        },
        select: { id: true },
      });
      if (conflict) {
        return res.status(409).json({ message: 'Bu telefon salon için zaten kayıtlı.' });
      }
    }

    const customer = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
      select: {
        id: true,
        name: true,
        phone: true,
        instagram: true,
        gender: true,
        birthDate: true,
        acceptMarketing: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({ customer });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu telefon salon için zaten kayıtlı.' });
    }
    console.error('Admin customer update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/customers/:id/no-show-risk', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const deltaRaw = typeof req.body?.delta === 'number' ? req.body.delta : Number(req.body?.delta);
  if (!Number.isFinite(deltaRaw) || (deltaRaw !== 1 && deltaRaw !== -1)) {
    return res.status(400).json({ message: 'delta must be +1 or -1.' });
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const [customer, profile, noShowCountFromData, totalBookingsFromData] = await Promise.all([
        tx.customer.findFirst({
          where: { id: customerId, salonId },
          select: { id: true },
        }),
        tx.customerRiskProfile.findUnique({
          where: { customerId_salonId: { customerId, salonId } },
          select: {
            riskScore: true,
            riskLevel: true,
            noShowCount: true,
            noShows: true,
            totalBookings: true,
          },
        }),
        tx.appointment.count({
          where: { salonId, customerId, status: 'NO_SHOW' },
        }),
        tx.appointment.count({
          where: { salonId, customerId, status: { not: 'CANCELLED' } },
        }),
      ]);

      if (!customer) {
        return null;
      }

      const inferredScore = totalBookingsFromData > 0 ? (noShowCountFromData / totalBookingsFromData) * 100 : 0;
      const currentScore = Number.isFinite(profile?.riskScore as number) ? Number(profile?.riskScore || 0) : inferredScore;
      const nextScore = Number(Math.max(0, Math.min(100, currentScore + deltaRaw)).toFixed(1));
      const nextLevel = toRiskLevel(nextScore);
      const noShowCount =
        typeof profile?.noShows === 'number'
          ? profile.noShows
          : typeof profile?.noShowCount === 'number'
          ? profile.noShowCount
          : noShowCountFromData;
      const totalBookings = typeof profile?.totalBookings === 'number' ? profile.totalBookings : totalBookingsFromData;

      const updated = await tx.customerRiskProfile.upsert({
        where: { customerId_salonId: { customerId, salonId } },
        create: {
          customerId,
          salonId,
          riskScore: nextScore,
          riskLevel: nextLevel,
          noShowCount,
          noShows: noShowCount,
          totalBookings,
          lastCalculatedAt: now,
        },
        update: {
          riskScore: nextScore,
          riskLevel: nextLevel,
          noShowCount,
          noShows: noShowCount,
          totalBookings,
          lastCalculatedAt: now,
        },
        select: {
          riskScore: true,
          riskLevel: true,
          noShows: true,
          totalBookings: true,
        },
      });

      await tx.customerBehaviorLog.create({
        data: {
          salonId,
          customerId,
          action: 'CUSTOMER_RISK_SCORE_ADJUSTED',
          behaviorType: 'RISK',
          metadata: {
            delta: deltaRaw,
            previousScore: currentScore,
            nextScore: updated.riskScore,
            source: 'mobile_manual_adjustment',
          },
          occurredAt: now,
        },
      });

      return {
        noShowRiskScore: Number(updated.riskScore || 0),
        noShowRiskLevel: (updated.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH') || nextLevel,
        noShowCount: typeof updated.noShows === 'number' ? updated.noShows : noShowCount,
        totalBookings: typeof updated.totalBookings === 'number' ? updated.totalBookings : totalBookings,
      };
    });

    if (!result) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    return res.status(200).json({ summary: result });
  } catch (error) {
    console.error('Admin customer no-show risk update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/customers/:id/discount', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const kind = asDiscountKind(req.body?.kind);
  const value = typeof req.body?.value === 'number' ? req.body.value : Number(req.body?.value);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const notifyCustomer = Boolean(req.body?.notifyCustomer);
  const messageTemplate = typeof req.body?.messageTemplate === 'string' ? req.body.messageTemplate.trim() : '';

  if (!kind) {
    return res.status(400).json({ message: 'kind must be PERCENT or FIXED.' });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ message: 'value must be a positive number.' });
  }
  if (kind === 'PERCENT' && value > 100) {
    return res.status(400).json({ message: 'PERCENT discount cannot exceed 100.' });
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, salonId },
      select: { id: true, name: true, phone: true },
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const now = new Date();
    const normalizedMessageTemplate =
      messageTemplate ||
      (kind === 'PERCENT'
        ? `${value}% indirim hakkınız tanımlandı.`
        : `${value} TL indirim hakkınız tanımlandı.`);
    const lastNotificationStatus = notifyCustomer
      ? customer.phone
        ? 'queued'
        : 'skipped_no_phone'
      : 'not_requested';

    await prisma.customerBehaviorLog.create({
      data: {
        salonId,
        customerId,
        action: 'CUSTOMER_DISCOUNT_SET',
        behaviorType: 'DISCOUNT',
        metadata: {
          kind,
          value,
          note: note || null,
          notifyCustomer,
          messageTemplate: normalizedMessageTemplate,
          lastNotificationStatus,
          updatedAt: now.toISOString(),
        },
        occurredAt: now,
      },
    });

    if (notifyCustomer) {
      await prisma.customerBehaviorLog.create({
        data: {
          salonId,
          customerId,
          action: 'CUSTOMER_DISCOUNT_NOTIFICATION',
          behaviorType: 'NOTIFICATION',
          metadata: {
            channel: 'WHATSAPP',
            status: lastNotificationStatus,
            messageTemplate: normalizedMessageTemplate,
          },
          occurredAt: now,
        },
      });
    }

    return res.status(200).json({
      discount: {
        kind,
        value,
        note: note || null,
        notifyCustomer,
        messageTemplate: normalizedMessageTemplate,
        lastNotificationStatus,
        updatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Admin customer discount update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/package-templates', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await (prisma as any).packageTemplate.findMany({
      where: { salonId },
      include: {
        services: {
          include: {
            service: {
              select: { id: true, name: true },
            },
          },
          orderBy: [{ serviceId: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return res.status(200).json({ items: items.map(toPackageTemplateDto) });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(200).json({
        items: [],
        warning: 'Package schema is not ready. Run database migrations to enable package management.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin package templates list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/package-templates', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const services = parsePackageServices(req.body?.services);
  const scopeType = parsePackageScopeType(req.body?.scopeType);
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
  const price = parsePriceOrNull(req.body?.price);
  const validityDaysRaw = req.body?.validityDays;
  const validityDays =
    validityDaysRaw === null || validityDaysRaw === undefined || validityDaysRaw === ''
      ? null
      : Number(validityDaysRaw);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  if (!services.length) {
    return res.status(400).json({ message: 'At least one service with initialQuota is required.' });
  }
  if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays <= 0)) {
    return res.status(400).json({ message: 'validityDays must be a positive integer.' });
  }

  try {
    const serviceIds = services.map((row) => row.serviceId);
    const foundServices = await prisma.service.findMany({
      where: {
        salonId,
        id: { in: serviceIds },
      },
      select: { id: true },
    });
    if (foundServices.length !== serviceIds.length) {
      return res.status(404).json({ message: 'One or more services were not found.' });
    }

    const created = await (prisma as any).packageTemplate.create({
      data: {
        salonId,
        name,
        scopeType,
        isActive,
        price,
        validityDays,
        notes: notes || null,
        services: {
          create: services.map((row) => ({
            serviceId: row.serviceId,
            initialQuota: row.initialQuota,
          })),
        },
      },
      include: {
        services: {
          include: {
            service: { select: { id: true, name: true } },
          },
          orderBy: [{ serviceId: 'asc' }],
        },
      },
    });

    return res.status(201).json({ item: toPackageTemplateDto(created) });
  } catch (error: any) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'A template with this name already exists.' });
    }
    console.error('Admin package template create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/package-templates/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const templateId = Number(req.params.id);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ message: 'Invalid template id.' });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const services = parsePackageServices(req.body?.services);
  const scopeType = parsePackageScopeType(req.body?.scopeType);
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
  const price = parsePriceOrNull(req.body?.price);
  const validityDaysRaw = req.body?.validityDays;
  const validityDays =
    validityDaysRaw === null || validityDaysRaw === undefined || validityDaysRaw === ''
      ? null
      : Number(validityDaysRaw);
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  if (!services.length) {
    return res.status(400).json({ message: 'At least one service with initialQuota is required.' });
  }
  if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays <= 0)) {
    return res.status(400).json({ message: 'validityDays must be a positive integer.' });
  }

  try {
    const existing = await (prisma as any).packageTemplate.findFirst({
      where: { id: templateId, salonId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Template not found.' });
    }

    const serviceIds = services.map((row) => row.serviceId);
    const foundServices = await prisma.service.findMany({
      where: { salonId, id: { in: serviceIds } },
      select: { id: true },
    });
    if (foundServices.length !== serviceIds.length) {
      return res.status(404).json({ message: 'One or more services were not found.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await (tx as any).packageTemplate.update({
        where: { id: templateId },
        data: {
          name,
          scopeType,
          isActive,
          price,
          validityDays,
          notes: notes || null,
        },
      });

      await (tx as any).packageTemplateService.deleteMany({
        where: { packageTemplateId: templateId },
      });

      await (tx as any).packageTemplateService.createMany({
        data: services.map((row) => ({
          packageTemplateId: templateId,
          serviceId: row.serviceId,
          initialQuota: row.initialQuota,
        })),
      });

      return (tx as any).packageTemplate.findUnique({
        where: { id: templateId },
        include: {
          services: {
            include: {
              service: {
                select: { id: true, name: true },
              },
            },
            orderBy: [{ serviceId: 'asc' }],
          },
        },
      });
    });

    return res.status(200).json({ item: toPackageTemplateDto(updated) });
  } catch (error: any) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'A template with this name already exists.' });
    }
    console.error('Admin package template update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers/:id/packages', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  try {
    const now = new Date();
    await (prisma as any).customerPackage.updateMany({
      where: {
        salonId,
        customerId,
        status: 'ACTIVE',
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });

    const items = await (prisma as any).customerPackage.findMany({
      where: { salonId, customerId },
      include: {
        template: {
          select: { id: true, name: true },
        },
        serviceBalances: {
          include: {
            service: {
              select: { id: true, name: true },
            },
          },
          orderBy: [{ serviceId: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return res.status(200).json({ items: items.map(toCustomerPackageDto) });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(200).json({
        items: [],
        warning: 'Package schema is not ready. Run database migrations to enable package management.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin customer packages list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/customers/:id/packages', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const templateIdRaw = req.body?.templateId;
  const templateId =
    templateIdRaw === null || templateIdRaw === undefined || templateIdRaw === ''
      ? null
      : Number(templateIdRaw);

  const now = new Date();

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, salonId },
      select: { id: true },
    });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    const created = await prisma.$transaction(async (tx) => {
      let name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      let services: ParsedPackageServiceQuota[] = [];
      let sourceType: 'TEMPLATE' | 'CUSTOM' = 'CUSTOM';
      let scopeType = parsePackageScopeType(req.body?.scopeType);
      let price = parsePriceOrNull(req.body?.price);
      let validityDays = req.body?.validityDays === undefined || req.body?.validityDays === null || req.body?.validityDays === ''
        ? null
        : Number(req.body.validityDays);
      const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
      const startsAt = parseDateOrNull(req.body?.startsAt) || now;
      let expiresAt = parseDateOrNull(req.body?.expiresAt);
      let packageTemplateId: number | null = null;

      if (templateId !== null) {
        if (!Number.isInteger(templateId) || templateId <= 0) {
          return { error: { code: 400, message: 'templateId must be a positive integer.' } };
        }
        const template = await (tx as any).packageTemplate.findFirst({
          where: { id: templateId, salonId },
          include: { services: true },
        });
        if (!template) {
          return { error: { code: 404, message: 'Template not found.' } };
        }
        if (!template.services.length) {
          return { error: { code: 400, message: 'Template has no services.' } };
        }

        packageTemplateId = template.id;
        sourceType = 'TEMPLATE';
        scopeType = template.scopeType as any;
        name = name || template.name;
        services = template.services.map((row) => ({
          serviceId: row.serviceId,
          initialQuota: row.initialQuota,
        }));
        if (price === null && typeof template.price === 'number') {
          price = template.price;
        }
        if (validityDays === null && typeof template.validityDays === 'number') {
          validityDays = template.validityDays;
        }
      } else {
        services = parsePackageServices(req.body?.services);
        sourceType = 'CUSTOM';
      }

      if (!name) {
        return { error: { code: 400, message: 'name is required.' } };
      }
      if (!services.length) {
        return { error: { code: 400, message: 'At least one service with initialQuota is required.' } };
      }
      if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays <= 0)) {
        return { error: { code: 400, message: 'validityDays must be a positive integer.' } };
      }
      if (!expiresAt && validityDays) {
        expiresAt = new Date(startsAt.getTime() + validityDays * 24 * 60 * 60 * 1000);
      }
      if (expiresAt && startsAt && expiresAt <= startsAt) {
        return { error: { code: 400, message: 'expiresAt must be later than startsAt.' } };
      }

      const serviceIds = services.map((row) => row.serviceId);
      const foundServices = await tx.service.findMany({
        where: { salonId, id: { in: serviceIds } },
        select: { id: true },
      });
      if (foundServices.length !== serviceIds.length) {
        return { error: { code: 404, message: 'One or more services were not found.' } };
      }

      const pkg = await (tx as any).customerPackage.create({
        data: {
          salonId,
          customerId,
          packageTemplateId,
          sourceType,
          scopeType,
          status: 'ACTIVE',
          name,
          startsAt,
          expiresAt,
          price,
          notes: notes || null,
          serviceBalances: {
            create: services.map((row) => ({
              serviceId: row.serviceId,
              initialQuota: row.initialQuota,
              remainingQuota: row.initialQuota,
            })),
          },
        },
        include: {
          template: { select: { id: true, name: true } },
          serviceBalances: {
            include: { service: { select: { id: true, name: true } } },
          },
        },
      });

      for (const balance of pkg.serviceBalances) {
        await (tx as any).packageLedger.create({
          data: {
            salonId,
            customerId,
            customerPackageId: pkg.id,
            serviceId: balance.serviceId,
            actionType: 'ASSIGNED',
            delta: balance.initialQuota,
            balanceAfter: balance.remainingQuota,
            reason: sourceType === 'TEMPLATE' ? 'template_assignment' : 'custom_assignment',
            metadata: {
              sourceType,
            },
          },
        });
      }

      return { item: pkg };
    });

    if ('error' in created) {
      return res.status(created.error.code).json({ message: created.error.message });
    }

    return res.status(201).json({ item: toCustomerPackageDto(created.item) });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin customer package create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/customers/:id/packages/:packageId/adjust', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  const packageId = Number(req.params.packageId);
  const serviceId = Number(req.body?.serviceId);
  const delta = Number(req.body?.delta);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }
  if (!Number.isInteger(packageId) || packageId <= 0) {
    return res.status(400).json({ message: 'Invalid package id.' });
  }
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'serviceId must be a positive integer.' });
  }
  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ message: 'delta must be a non-zero integer.' });
  }
  if (!reason) {
    return res.status(400).json({ message: 'reason is required.' });
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const pkg = await (tx as any).customerPackage.findFirst({
        where: {
          id: packageId,
          salonId,
          customerId,
        },
        select: { id: true },
      });
      if (!pkg) {
        return { error: { code: 404, message: 'Customer package not found.' } };
      }

      const balance = await (tx as any).customerPackageServiceBalance.findUnique({
        where: {
          customerPackageId_serviceId: {
            customerPackageId: packageId,
            serviceId,
          },
        },
        select: {
          id: true,
          remainingQuota: true,
          customerPackageId: true,
        },
      });
      if (!balance) {
        return { error: { code: 404, message: 'Service not found in package.' } };
      }

      const nextRemaining = balance.remainingQuota + delta;
      if (nextRemaining < 0) {
        return { error: { code: 409, message: 'Adjustment cannot make balance negative.' } };
      }

      const updatedBalance = await (tx as any).customerPackageServiceBalance.update({
        where: { id: balance.id },
        data: { remainingQuota: nextRemaining },
        select: {
          serviceId: true,
          remainingQuota: true,
        },
      });

      await (tx as any).packageLedger.create({
        data: {
          salonId,
          customerId,
          customerPackageId: packageId,
          serviceId,
          actionType: 'MANUAL_ADJUST',
          delta,
          balanceAfter: updatedBalance.remainingQuota,
          reason,
          metadata: {
            adjustedAt: now.toISOString(),
          },
        },
      });

      await refreshCustomerPackageStatus(tx, packageId, now);

      const item = await (tx as any).customerPackage.findUnique({
        where: { id: packageId },
        include: {
          template: { select: { id: true, name: true } },
          serviceBalances: {
            include: { service: { select: { id: true, name: true } } },
            orderBy: [{ serviceId: 'asc' }],
          },
        },
      });

      return { item };
    });

    if ('error' in result) {
      return res.status(result.error.code).json({ message: result.error.message });
    }

    return res.status(200).json({ item: toCustomerPackageDto(result.item) });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin customer package adjust error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/customers/:id/package-ledger', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const limit = asPositiveInt(req.query.limit, 200, 1, 500);

  try {
    const items = await (prisma as any).packageLedger.findMany({
      where: { salonId, customerId },
      include: {
        service: {
          select: { id: true, name: true },
        },
        customerPackage: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return res.status(200).json({
      items: items.map((item) => ({
        id: item.id,
        customerPackageId: item.customerPackageId,
        packageName: item.customerPackage?.name || null,
        serviceId: item.serviceId,
        serviceName: item.service?.name || null,
        appointmentId: item.appointmentId,
        actionType: item.actionType,
        delta: item.delta,
        balanceAfter: item.balanceAfter,
        reason: item.reason,
        metadata: item.metadata,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(200).json({
        items: [],
        warning: 'Package schema is not ready. Run database migrations to enable package management.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin customer package ledger error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/appointments/:id/status', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const appointmentId = Number(req.params.id);
  const nextStatus = asAppointmentStatus(req.body?.status);
  const paymentMethod = asPaymentMethod(req.body?.paymentMethod);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment id.' });
  }
  if (!nextStatus) {
    return res.status(400).json({ message: 'status must be BOOKED, COMPLETED, CANCELLED, or NO_SHOW.' });
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: appointmentId, salonId },
        select: {
          id: true,
          salonId: true,
          customerId: true,
          serviceId: true,
          status: true,
          startTime: true,
          customerName: true,
        },
      });
      if (!appointment) {
        return { error: { code: 404, message: 'Appointment not found.' } };
      }

      const previousStatus = appointment.status || 'BOOKED';
      const serviceIdsFromPayload = parseServiceIdsFromAppointmentPayload(req.body?.services);
      const lineIdsFromPayload = Array.isArray(req.body?.appointmentLineIds)
        ? req.body.appointmentLineIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value > 0)
        : [];

      let appointmentLines = await (tx as any).appointmentLine.findMany({
        where: { appointmentId },
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      });
      if (!appointmentLines.length) {
        const createdLine = await ensureDefaultAppointmentLine(tx, appointment);
        appointmentLines = [createdLine];
      }

      let targetLines = appointmentLines;
      if (lineIdsFromPayload.length) {
        targetLines = appointmentLines.filter((line: any) => lineIdsFromPayload.includes(Number(line.id)));
      } else if (serviceIdsFromPayload.length) {
        targetLines = appointmentLines.filter((line: any) => serviceIdsFromPayload.includes(Number(line.serviceId)));
      } else {
        const firstActive =
          appointmentLines.find((line: any) => String(line.status || '').toUpperCase() === 'BOOKED') ||
          appointmentLines[0];
        targetLines = firstActive ? [firstActive] : [];
      }
      if (!targetLines.length) {
        return { error: { code: 404, message: 'No matching appointment line was found for the update request.' } };
      }

      const events: any[] = [];
      for (const line of targetLines) {
        const previousLineStatus = String(line.status || 'BOOKED').toUpperCase();
        await (tx as any).appointmentLine.update({
          where: { id: Number(line.id) },
          data: {
            status: nextStatus,
            ...(nextStatus === 'COMPLETED'
              ? {
                  paymentMethod: paymentMethod || undefined,
                  paymentRecordedAt: paymentMethod ? now : undefined,
                }
              : {
                  paymentMethod: null,
                  paymentRecordedAt: null,
                }),
          },
        });

        if (appointment.customerId) {
          if (previousLineStatus !== 'COMPLETED' && nextStatus === 'COMPLETED') {
            const consumeResult = await consumePackageForAppointmentService(tx, {
              salonId,
              customerId: appointment.customerId,
              appointmentId,
              appointmentLineId: Number(line.id),
              serviceId: Number(line.serviceId),
              now,
            });
            events.push(consumeResult);
          } else if (previousLineStatus === 'COMPLETED' && nextStatus !== 'COMPLETED') {
            const restoreResult = await restorePackageForAppointmentService(tx, {
              salonId,
              customerId: appointment.customerId,
              appointmentId,
              appointmentLineId: Number(line.id),
              serviceId: Number(line.serviceId),
              now,
              reason: `status_${previousLineStatus}_to_${nextStatus}`,
            });
            events.push(restoreResult);
          }
        }
      }

      const computedStatus = await recomputeAndPersistAppointmentStatusFromLines(tx, appointmentId);
      const updated = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              duration: true,
              price: true,
              requiresSpecialist: true,
            },
          },
          staff: {
            select: {
              id: true,
              name: true,
              title: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          appointmentLines: {
            include: {
              service: { select: { id: true, name: true, duration: true, price: true, requiresSpecialist: true } },
              specialist: { select: { id: true, name: true, title: true } },
            },
            orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
          },
        },
      });
      if (!updated) {
        return { error: { code: 404, message: 'Appointment not found after update.' } };
      }

      return {
        item: updated,
        customerId: updated.customerId || null,
        _notify: {
          appointmentId: updated.id,
          customerName: updated.customerName,
          serviceName: updated.service?.name || null,
          startTime: updated.startTime,
          previousStatus,
          nextStatus: computedStatus || previousStatus,
        },
        packageAutomation: {
          previousStatus,
          nextStatus: computedStatus || previousStatus,
          events,
        },
      };
    });

    if ('error' in result) {
      return res.status(result.error.code).json({ message: result.error.message });
    }

    if (result._notify.previousStatus !== 'COMPLETED' && result._notify.nextStatus === 'COMPLETED') {
      await processCompletionCampaignRewards({
        salonId,
        appointmentId: result._notify.appointmentId,
        customerId: result.customerId || null,
      });
    } else if (result._notify.nextStatus === 'CANCELLED' || result._notify.nextStatus === 'NO_SHOW') {
      await releaseAppointmentCampaignApplications({
        salonId,
        appointmentId: result._notify.appointmentId,
      });
    } else if (result._notify.previousStatus === 'COMPLETED' && result._notify.nextStatus !== 'COMPLETED') {
      await releaseAppointmentCampaignApplications({
        salonId,
        appointmentId: result._notify.appointmentId,
      });
    }

    try {
      const timezone = await getSalonTimezone(salonId);
      const eventType =
        result._notify.nextStatus === 'CANCELLED'
          ? 'CANCELLED'
          : result._notify.previousStatus === result._notify.nextStatus
            ? 'UPDATED'
            : 'UPDATED';
      await notifySameDayAppointmentChange({
        salonId,
        event: eventType,
        appointmentId: result._notify.appointmentId,
        customerName: result._notify.customerName,
        serviceName: result._notify.serviceName,
        startTime: new Date(result._notify.startTime),
        timezone,
      });
    } catch (notifyError) {
      console.error('Appointment status notification error:', notifyError);
    }

    if (result._notify.nextStatus === 'CANCELLED') {
      await matchWaitlistForDate(salonId, getAppointmentDayKey(new Date(result._notify.startTime))).catch((waitlistError) => {
        console.error('Admin appointment status waitlist match error:', waitlistError);
      });
    }

    return res.status(200).json({
      item: result.item,
      packageAutomation: result.packageAutomation,
    });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin appointment status update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/appointment-lines/:id/status', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const appointmentLineId = Number(req.params.id);
  const nextStatus = asAppointmentStatus(req.body?.status);
  const paymentMethod = asPaymentMethod(req.body?.paymentMethod);
  if (!Number.isInteger(appointmentLineId) || appointmentLineId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment line id.' });
  }
  if (!nextStatus) {
    return res.status(400).json({ message: 'status must be BOOKED, COMPLETED, CANCELLED, or NO_SHOW.' });
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const line = await (tx as any).appointmentLine.findFirst({
        where: { id: appointmentLineId, salonId },
        select: {
          id: true,
          appointmentId: true,
          serviceId: true,
          customerId: true,
          status: true,
        },
      });
      if (!line) return { error: { code: 404, message: 'Appointment line not found.' } };

      const previousStatus = String(line.status || 'BOOKED').toUpperCase();
      await (tx as any).appointmentLine.update({
        where: { id: appointmentLineId },
        data: {
          status: nextStatus,
          ...(nextStatus === 'COMPLETED'
            ? {
                paymentMethod: paymentMethod || undefined,
                paymentRecordedAt: paymentMethod ? now : undefined,
              }
            : {
                paymentMethod: null,
                paymentRecordedAt: null,
              }),
        },
      });

      const events: any[] = [];
      if (line.customerId) {
        if (previousStatus !== 'COMPLETED' && nextStatus === 'COMPLETED') {
          events.push(
            await consumePackageForAppointmentService(tx, {
              salonId,
              customerId: Number(line.customerId),
              appointmentId: Number(line.appointmentId),
              appointmentLineId,
              serviceId: Number(line.serviceId),
              now,
            }),
          );
        } else if (previousStatus === 'COMPLETED' && nextStatus !== 'COMPLETED') {
          events.push(
            await restorePackageForAppointmentService(tx, {
              salonId,
              customerId: Number(line.customerId),
              appointmentId: Number(line.appointmentId),
              appointmentLineId,
              serviceId: Number(line.serviceId),
              now,
              reason: `line_status_${previousStatus}_to_${nextStatus}`,
            }),
          );
        }
      }

      const appointmentStatus = await recomputeAndPersistAppointmentStatusFromLines(tx, Number(line.appointmentId));
      const appointment = await tx.appointment.findFirst({
        where: { id: Number(line.appointmentId), salonId },
        include: {
          service: { select: { id: true, name: true, duration: true, price: true, requiresSpecialist: true } },
          staff: { select: { id: true, name: true, title: true } },
          customer: { select: { id: true, name: true, phone: true } },
          appointmentLines: {
            include: {
              service: { select: { id: true, name: true, duration: true, price: true, requiresSpecialist: true } },
              specialist: { select: { id: true, name: true, title: true } },
            },
            orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
          },
        },
      });
      if (!appointment) return { error: { code: 404, message: 'Appointment not found.' } };

      return {
        item: appointment,
        lineId: appointmentLineId,
        appointmentId: Number(line.appointmentId),
        previousStatus,
        nextStatus,
        appointmentStatus: appointmentStatus || appointment.status || 'BOOKED',
        packageAutomation: {
          previousStatus,
          nextStatus,
          events,
        },
      };
    });

    if ('error' in result) {
      return res.status(result.error.code).json({ message: result.error.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin appointment line status update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/appointments/checkout', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const mode = parseCheckoutMode(req.body?.mode);
  const lines = parseCheckoutLines(req.body?.lines);
  const now = new Date();

  if (!lines.length) {
    return res.status(400).json({ message: 'lines must be a non-empty array.' });
  }

  const sellNewCount = lines.filter((line) => line.closeType === 'SELL_NEW_PACKAGE').length;
  const useExistingCount = lines.filter((line) => line.closeType === 'USE_EXISTING_PACKAGE').length;
  const singlePaymentCount = lines.filter((line) => line.closeType === 'SINGLE_PAYMENT').length;

  if (mode === 'GROUP') {
    const firstType = lines[0]?.closeType;
    const mixedCloseType = lines.some((line) => line.closeType !== firstType);
    if (mixedCloseType) {
      return res.status(400).json({ message: 'GROUP mode requires the same closeType for all lines.' });
    }
    if (firstType === 'SINGLE_PAYMENT') {
      const firstPayment = lines[0]?.paymentMethod || null;
      const mixedPayment = lines.some((line) => (line.paymentMethod || null) !== firstPayment);
      if (mixedPayment) {
        return res.status(400).json({ message: 'GROUP mode SINGLE_PAYMENT requires the same paymentMethod for all lines.' });
      }
    }
    if (firstType === 'USE_EXISTING_PACKAGE') {
      const firstPackageId = lines[0]?.customerPackageId || null;
      const mixedPackage = lines.some((line) => (line.customerPackageId || null) !== firstPackageId);
      if (mixedPackage) {
        return res.status(400).json({ message: 'GROUP mode USE_EXISTING_PACKAGE requires the same customerPackageId for all lines.' });
      }
    }
  }

  if (singlePaymentCount && lines.some((line) => line.closeType === 'SINGLE_PAYMENT' && !line.paymentMethod)) {
    return res.status(400).json({ message: 'paymentMethod is required for SINGLE_PAYMENT lines.' });
  }
  if (useExistingCount && lines.some((line) => line.closeType === 'USE_EXISTING_PACKAGE' && !line.customerPackageId)) {
    return res.status(400).json({ message: 'customerPackageId is required for USE_EXISTING_PACKAGE lines.' });
  }
  if (sellNewCount > 0 && lines.some((line) => line.closeType === 'SELL_NEW_PACKAGE' && line.customerPackageId)) {
    return res.status(400).json({ message: 'SELL_NEW_PACKAGE lines must not include customerPackageId.' });
  }

  const parsedNewPackageServices = parsePackageServices(req.body?.newPackage?.services);
  const parsedNewPackageScopeType = parsePackageScopeType(req.body?.newPackage?.scopeType);
  const parsedNewPackagePrice = parsePriceOrNull(req.body?.newPackage?.price);
  const parsedNewPackageStartsAt = parseDateOrNull(req.body?.newPackage?.startsAt) || now;
  const parsedNewPackageExpiresAt = parseDateOrNull(req.body?.newPackage?.expiresAt);
  const parsedNewPackageNotes = typeof req.body?.newPackage?.notes === 'string' ? req.body.newPackage.notes.trim() : null;
  const parsedNewPackagePaymentMethod = asPaymentMethod(req.body?.newPackage?.paymentMethod);
  const parsedNewPackageName = typeof req.body?.newPackage?.name === 'string' ? req.body.newPackage.name.trim() : '';

  if (sellNewCount > 0) {
    if (!parsedNewPackageName) {
      return res.status(400).json({ message: 'newPackage.name is required when SELL_NEW_PACKAGE is used.' });
    }
    if (!parsedNewPackageServices.length) {
      return res.status(400).json({ message: 'newPackage.services is required when SELL_NEW_PACKAGE is used.' });
    }
    if (parsedNewPackageExpiresAt && parsedNewPackageExpiresAt <= parsedNewPackageStartsAt) {
      return res.status(400).json({ message: 'newPackage.expiresAt must be later than newPackage.startsAt.' });
    }
    if (!parsedNewPackagePaymentMethod) {
      return res.status(400).json({ message: 'newPackage.paymentMethod must be CASH, CARD, TRANSFER or OTHER.' });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const appointmentIds = lines.map((line) => line.appointmentId);
      const appointments = await tx.appointment.findMany({
        where: {
          salonId,
          id: { in: appointmentIds },
        },
        select: {
          id: true,
          customerId: true,
          serviceId: true,
          status: true,
          paymentMethod: true,
        },
      });

      if (appointments.length !== appointmentIds.length) {
        return { error: { code: 404, message: 'One or more appointments were not found.' } };
      }

      const appointmentById = new Map<number, any>();
      for (const item of appointments) {
        appointmentById.set(item.id, item);
      }

      const appointmentLinesRaw = await (tx as any).appointmentLine.findMany({
        where: { appointmentId: { in: appointmentIds } },
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      });
      const linesByAppointment = new Map<number, any[]>();
      for (const line of appointmentLinesRaw) {
        const list = linesByAppointment.get(Number(line.appointmentId)) || [];
        list.push(line);
        linesByAppointment.set(Number(line.appointmentId), list);
      }
      for (const appointment of appointments) {
        if (!linesByAppointment.has(Number(appointment.id)) || !(linesByAppointment.get(Number(appointment.id)) || []).length) {
          const createdLine = await ensureDefaultAppointmentLine(tx, appointment);
          linesByAppointment.set(Number(appointment.id), [createdLine]);
        }
      }

      const requiresCustomerPackage = lines.some((line) => line.closeType !== 'SINGLE_PAYMENT');
      const customerIds = Array.from(
        new Set(
          appointments
            .map((item) => (Number.isInteger(item.customerId) && item.customerId > 0 ? Number(item.customerId) : null))
            .filter((id): id is number => id !== null),
        ),
      );
      if (requiresCustomerPackage && customerIds.length !== 1) {
        return { error: { code: 400, message: 'Package actions require checkout lines to belong to one registered customer.' } };
      }
      if (requiresCustomerPackage && appointments.some((item) => !Number.isInteger(item.customerId) || Number(item.customerId) <= 0)) {
        return { error: { code: 400, message: 'Package actions require a registered customer on every selected line.' } };
      }
      const customerId = customerIds.length === 1 ? customerIds[0] : null;

      if (lines.some((line) => {
        const appointment = appointmentById.get(line.appointmentId);
        return !appointment || appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW';
      })) {
        return { error: { code: 400, message: 'Cancelled or no-show appointments cannot be processed in checkout.' } };
      }

      let createdPackage: any = null;
      let newCustomerPackageId: number | null = null;
      if (sellNewCount > 0) {
        if (!customerId) {
          return { error: { code: 400, message: 'newPackage sale requires a registered customer.' } };
        }
        const newServiceIds = parsedNewPackageServices.map((row) => row.serviceId);
        const foundServices = await tx.service.findMany({
          where: { salonId, id: { in: newServiceIds } },
          select: { id: true },
        });
        if (foundServices.length !== newServiceIds.length) {
          return { error: { code: 404, message: 'One or more newPackage.services were not found.' } };
        }

        createdPackage = await (tx as any).customerPackage.create({
          data: {
            salonId,
            customerId,
            packageTemplateId: null,
            sourceType: 'CUSTOM',
            scopeType: parsedNewPackageScopeType,
            status: 'ACTIVE',
            name: parsedNewPackageName,
            startsAt: parsedNewPackageStartsAt,
            expiresAt: parsedNewPackageExpiresAt,
            price: parsedNewPackagePrice,
            notes: parsedNewPackageNotes || null,
            serviceBalances: {
              create: parsedNewPackageServices.map((row) => ({
                serviceId: row.serviceId,
                initialQuota: row.initialQuota,
                remainingQuota: row.initialQuota,
              })),
            },
          },
          include: {
            serviceBalances: {
              include: { service: { select: { id: true, name: true } } },
            },
          },
        });
        newCustomerPackageId = createdPackage.id;

        for (const balance of createdPackage.serviceBalances || []) {
          await (tx as any).packageLedger.create({
            data: {
              salonId,
              customerId,
              customerPackageId: createdPackage.id,
              serviceId: balance.serviceId,
              actionType: 'ASSIGNED',
              delta: balance.initialQuota,
              balanceAfter: balance.remainingQuota,
              reason: 'checkout_custom_sale',
              metadata: {
                sourceType: 'CUSTOM',
                source: 'checkout_new_package',
                checkoutMode: mode,
                paymentMethod: parsedNewPackagePaymentMethod,
              },
            },
          });
        }
      }

      const existingPackageIds = Array.from(
        new Set(
          lines
            .filter((line) => line.closeType === 'USE_EXISTING_PACKAGE' && line.customerPackageId)
            .map((line) => Number(line.customerPackageId)),
        ),
      );
      if (existingPackageIds.length) {
        if (!customerId) {
          return { error: { code: 400, message: 'Existing package usage requires a registered customer.' } };
        }
        const foundPackages = await (tx as any).customerPackage.findMany({
          where: {
            id: { in: existingPackageIds },
            salonId,
            customerId,
          },
          select: { id: true },
        });
        if (foundPackages.length !== existingPackageIds.length) {
          return { error: { code: 404, message: 'One or more selected customer packages were not found.' } };
        }
      }

      const lineResults: Array<{
        appointmentId: number;
        appointmentLineId: number;
        previousStatus: string;
        nextStatus: string;
        closeType: CheckoutCloseType;
        paymentMethod: string | null;
        packageAction: any;
      }> = [];
      const ledgerEvents: any[] = [];
      const justCompletedAppointmentIds: number[] = [];
      const touchedAppointmentIds = new Set<number>();

      for (const line of lines) {
        const appointment = appointmentById.get(line.appointmentId);
        if (!appointment) {
          return { error: { code: 404, message: 'Appointment not found in checkout lines.' } };
        }
        const appointmentLineCandidates = linesByAppointment.get(Number(line.appointmentId)) || [];
        const targetLine = line.appointmentLineId
          ? appointmentLineCandidates.find((item) => Number(item.id) === Number(line.appointmentLineId))
          : appointmentLineCandidates[0];
        if (!targetLine) {
          return { error: { code: 404, message: `Appointment line not found for appointment #${line.appointmentId}.` } };
        }
        if (targetLine.status === 'CANCELLED' || targetLine.status === 'NO_SHOW') {
          return { error: { code: 400, message: `Cancelled or no-show lines cannot be processed in checkout (#${targetLine.id}).` } };
        }
        if (
          (line.closeType === 'USE_EXISTING_PACKAGE' || line.closeType === 'SELL_NEW_PACKAGE') &&
          String(targetLine.status || '').toUpperCase() === 'COMPLETED'
        ) {
          return { error: { code: 400, message: `Package actions can only be applied while completing lines in same checkout (#${targetLine.id}).` } };
        }

        let packageAction: any = null;

        if (line.closeType === 'USE_EXISTING_PACKAGE') {
          if (!customerId) {
            return { error: { code: 400, message: `Existing package usage requires a registered customer for appointment #${line.appointmentId}.` } };
          }
          packageAction = await consumeSpecificPackageForAppointmentService(tx, {
            salonId,
            customerId,
            appointmentId: line.appointmentId,
            appointmentLineId: Number(targetLine.id),
            serviceId: Number(targetLine.serviceId || appointment.serviceId),
            customerPackageId: Number(line.customerPackageId),
            now,
            source: 'checkout_existing',
          });
          ledgerEvents.push(packageAction);
          if (packageAction.type !== 'AUTO_CONSUME' && packageAction.type !== 'IDEMPOTENT') {
            return { error: { code: 400, message: `Package usage failed for appointment #${line.appointmentId}.` } };
          }
        } else if (line.closeType === 'SELL_NEW_PACKAGE') {
          if (!newCustomerPackageId) {
            return { error: { code: 400, message: 'newPackage is required for SELL_NEW_PACKAGE lines.' } };
          }
          if (!customerId) {
            return { error: { code: 400, message: `New package usage requires a registered customer for appointment #${line.appointmentId}.` } };
          }
          packageAction = await consumeSpecificPackageForAppointmentService(tx, {
            salonId,
            customerId,
            appointmentId: line.appointmentId,
            appointmentLineId: Number(targetLine.id),
            serviceId: Number(targetLine.serviceId || appointment.serviceId),
            customerPackageId: newCustomerPackageId,
            now,
            source: 'checkout_new',
          });
          ledgerEvents.push(packageAction);
          if (packageAction.type !== 'AUTO_CONSUME' && packageAction.type !== 'IDEMPOTENT') {
            return { error: { code: 400, message: `New package usage failed for appointment #${line.appointmentId}.` } };
          }
        }

        const nextStatus = 'COMPLETED';
        const previousStatus = String(targetLine.status || 'BOOKED');
        const shouldSetPayment = line.closeType === 'SINGLE_PAYMENT' ? line.paymentMethod : null;
        await (tx as any).appointmentLine.update({
          where: { id: Number(targetLine.id) },
          data: {
            status: nextStatus,
            paymentMethod: shouldSetPayment || null,
            paymentRecordedAt: shouldSetPayment ? now : null,
          },
        });
        touchedAppointmentIds.add(Number(line.appointmentId));

        if (previousStatus !== 'COMPLETED' && nextStatus === 'COMPLETED') {
          justCompletedAppointmentIds.push(line.appointmentId);
        }

        lineResults.push({
          appointmentId: line.appointmentId,
          appointmentLineId: Number(targetLine.id),
          previousStatus,
          nextStatus,
          closeType: line.closeType,
          paymentMethod: shouldSetPayment || null,
          packageAction,
        });
      }

      for (const appointmentId of touchedAppointmentIds) {
        await recomputeAndPersistAppointmentStatusFromLines(tx, appointmentId);
      }

      return {
        mode,
        customerId,
        lineResults,
        ledgerEvents,
        packageCreated: createdPackage ? toCustomerPackageDto(createdPackage) : null,
        justCompletedAppointmentIds,
        summary: {
          totalLines: lines.length,
          singlePaymentCount,
          existingPackageUsageCount: useExistingCount,
          newPackageUsageCount: sellNewCount,
          packageCreated: Boolean(createdPackage),
        },
      };
    });

    if ('error' in result) {
      return res.status(result.error.code).json({ message: result.error.message });
    }

    const uniqueCompletedIds = Array.from(new Set(result.justCompletedAppointmentIds || []));
    for (const appointmentId of uniqueCompletedIds) {
      await processCompletionCampaignRewards({
        salonId,
        appointmentId,
        customerId: result.customerId || null,
      }).catch((rewardError) => {
        console.error('Checkout completion campaign reward error:', rewardError);
      });
    }

    return res.status(200).json({
      mode: result.mode,
      lineResults: result.lineResults,
      packageCreated: result.packageCreated,
      ledgerEvents: result.ledgerEvents,
      summary: {
        ...result.summary,
        message: `Checkout completed for ${result.summary.totalLines} appointment(s).`,
      },
    });
  } catch (error) {
    if (isPackageSchemaNotReadyError(error)) {
      return res.status(503).json({
        message: 'Package schema is not ready. Run database migrations.',
        code: 'PACKAGE_SCHEMA_NOT_READY',
      });
    }
    console.error('Admin appointment checkout error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/appointments/reschedule-preview', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  const newStartTime = parseIsoDate(req.body?.newStartTime);
  const assignments = parseRescheduleAssignments(req.body?.assignments);

  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }
  if (!newStartTime) {
    return res.status(400).json({ message: 'newStartTime is required as ISO date.' });
  }

  try {
    const preview = await buildAppointmentReschedulePreview({
      salonId,
      appointmentIds,
      newStartTime,
      assignments,
    });
    return res.status(200).json(preview);
  } catch (error) {
    console.error('Admin appointment reschedule preview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/appointments/reschedule-options', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
  const assignments = parseRescheduleAssignments(req.body?.assignments);

  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }
  if (!date) {
    return res.status(400).json({ message: 'date is required as YYYY-MM-DD.' });
  }

  try {
    const options = await buildRescheduleOptions({
      salonId,
      appointmentIds,
      date,
      assignments,
    });
    return res.status(200).json(options);
  } catch (error) {
    console.error('Admin appointment reschedule options error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/appointments/reschedule-commit', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const appointmentIds = parseAppointmentIds(req.body?.appointmentIds);
  const newStartTime = parseIsoDate(req.body?.newStartTime);
  const assignments = parseRescheduleAssignments(req.body?.assignments);
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : null;

  if (!appointmentIds.length) {
    return res.status(400).json({ message: 'appointmentIds must be a non-empty array.' });
  }
  if (!newStartTime) {
    return res.status(400).json({ message: 'newStartTime is required as ISO date.' });
  }

  try {
    const previousAppointments = await prisma.appointment.findMany({
      where: {
        salonId,
        id: { in: appointmentIds },
      },
      select: {
        id: true,
        startTime: true,
      },
    });

    const committed = await commitAppointmentReschedule({
      salonId,
      appointmentIds,
      newStartTime,
      assignments,
      idempotencyKey,
    });

    await Promise.all(
      committed.previousAppointmentIds.map((id) =>
        releaseAppointmentCampaignApplications({
          salonId,
          appointmentId: Number(id),
        }),
      ),
    );

    try {
      const timezone = await getSalonTimezone(salonId);
      for (const appointment of committed.createdAppointments) {
        await notifySameDayAppointmentChange({
          salonId,
          event: 'UPDATED',
          appointmentId: appointment.id,
          customerName: appointment.customerName,
          serviceName: appointment.service?.name || null,
          startTime: new Date(appointment.startTime),
          timezone,
        });
      }
    } catch (notifyError) {
      console.error('Appointment reschedule commit notification error:', notifyError);
    }

    const previousDays = Array.from(
      new Set(
        committed.previousAppointmentIds
          .map((id) => Number(id))
          .map((id) => previousAppointments.find((appointment) => appointment.id === id))
          .filter(Boolean)
          .map((appointment) => getAppointmentDayKey(new Date((appointment as any).startTime))),
      ),
    );
    await Promise.all(
      previousDays.map((day) =>
        matchWaitlistForDate(salonId, day).catch((waitlistError) => {
          console.error('Admin appointment reschedule waitlist match error:', waitlistError);
        }),
      ),
    );

    return res.status(200).json({
      batchId: committed.batchId,
      previousAppointmentIds: committed.previousAppointmentIds,
      items: committed.createdAppointments,
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /manual specialist selection|no eligible|only booked|not found/i.test(message) ? 409 : 500;
    if (status === 500) {
      console.error('Admin appointment reschedule commit error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.patch('/appointments/:id/reschedule', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const appointmentId = Number(req.params.id);
  const newStartTime = parseIsoDate(req.body?.startTime);
  const explicitStaffId = Number(req.body?.staffId);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment id.' });
  }
  if (!newStartTime) {
    return res.status(400).json({ message: 'startTime is required as ISO date.' });
  }

  const assignments =
    Number.isInteger(explicitStaffId) && explicitStaffId > 0
      ? { [appointmentId]: explicitStaffId }
      : {};

  try {
    const committed = await commitAppointmentReschedule({
      salonId,
      appointmentIds: [appointmentId],
      newStartTime,
      assignments,
      idempotencyKey: null,
    });
    await Promise.all(
      committed.previousAppointmentIds.map((id) =>
        releaseAppointmentCampaignApplications({
          salonId,
          appointmentId: Number(id),
        }),
      ),
    );
    const item = committed.createdAppointments[0] || null;
    return res.status(200).json({
      item,
      previousAppointmentId: committed.previousAppointmentIds[0] || appointmentId,
      batchId: committed.batchId,
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /manual specialist selection|no eligible|only booked|not found/i.test(message) ? 409 : 500;
    if (status === 500) {
      console.error('Admin appointment reschedule legacy endpoint error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.get('/waitlist', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const date = typeof req.query?.date === 'string' ? req.query.date.trim() : '';
  if (!date) {
    return res.status(400).json({ message: 'date is required as YYYY-MM-DD.' });
  }

  try {
    const items = await listWaitlistEntries({ salonId, date });
    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin waitlist list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/waitlist', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
  const timeWindowStart = typeof req.body?.timeWindowStart === 'string' ? req.body.timeWindowStart.trim() : '';
  const timeWindowEnd = typeof req.body?.timeWindowEnd === 'string' ? req.body.timeWindowEnd.trim() : '';
  const groups = parseWaitlistGroups(req.body?.groups);
  const customerId = Number(req.body?.customerId);
  const customerName = typeof req.body?.customerName === 'string' ? req.body.customerName.trim() : '';
  const customerPhone = typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim() : '';
  const customerCountryIso = typeof req.body?.customerCountryIso === 'string' ? req.body.customerCountryIso.trim() : '';
  const customerRawPhone = typeof req.body?.customerRawPhone === 'string' ? req.body.customerRawPhone.trim() : customerPhone;
  const customerNormalizedPhone = typeof req.body?.customerNormalizedPhone === 'string' ? req.body.customerNormalizedPhone.trim() : customerPhone;
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;
  const allowNearbyMatches = Boolean(req.body?.allowNearbyMatches);
  const nearbyToleranceMinutes = Number(req.body?.nearbyToleranceMinutes);

  if (!date || !timeWindowStart || !timeWindowEnd || !groups.length || !customerName || !customerPhone) {
    return res.status(400).json({ message: 'date, time window, groups, customerName and customerPhone are required.' });
  }

  try {
    const validatedPhone = validateMobilePhone({
      rawPhone: customerRawPhone,
      countryIso: customerCountryIso,
      normalizedPhone: customerNormalizedPhone,
    });
    const item = await createWaitlistEntry({
      salonId,
      date,
      timeWindowStart,
      timeWindowEnd,
      allowNearbyMatches,
      nearbyToleranceMinutes: Number.isFinite(nearbyToleranceMinutes) ? nearbyToleranceMinutes : 60,
      groups: groups as any,
      source: 'ADMIN',
      customer: {
        customerId: Number.isInteger(customerId) && customerId > 0 ? customerId : null,
        customerName,
        customerPhone: validatedPhone.digits,
      },
      notes,
    });
    return res.status(201).json({ item });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /required|invalid/i.test(message) ? 400 : 500;
    if (status === 500) {
      console.error('Admin waitlist create error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.post('/waitlist/match', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;
  const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
  if (!date) {
    return res.status(400).json({ message: 'date is required as YYYY-MM-DD.' });
  }

  try {
    await matchWaitlistForDate(salonId, date);
    const items = await listWaitlistEntries({ salonId, date });
    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin waitlist match error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/waitlist/:id/offer', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;
  const entryId = Number(req.params.id);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return res.status(400).json({ message: 'Invalid waitlist id.' });
  }

  try {
    const item = await createManualWaitlistOffer({ salonId, entryId });
    return res.status(200).json({ item });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /not_found/.test(message) ? 404 : 500;
    if (status === 500) {
      console.error('Admin waitlist manual offer error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.post('/waitlist/:id/cancel', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;
  const entryId = Number(req.params.id);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return res.status(400).json({ message: 'Invalid waitlist id.' });
  }

  try {
    await cancelWaitlistEntry({ salonId, entryId });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    const message = error?.message || 'Internal server error.';
    const status = /not_found/.test(message) ? 404 : 500;
    if (status === 500) {
      console.error('Admin waitlist cancel error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.patch('/appointments/:id/payment', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const appointmentId = Number(req.params.id);
  const appointmentLineIdRaw = req.body?.appointmentLineId;
  const appointmentLineId =
    appointmentLineIdRaw === null || appointmentLineIdRaw === undefined || appointmentLineIdRaw === ''
      ? null
      : Number(appointmentLineIdRaw);
  const paymentMethod = asPaymentMethod(req.body?.paymentMethod);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ message: 'Invalid appointment id.' });
  }
  if (!paymentMethod) {
    return res.status(400).json({ message: 'paymentMethod must be CASH, CARD, TRANSFER or OTHER.' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.findFirst({
        where: { id: appointmentId, salonId },
        select: {
          id: true,
          salonId: true,
          customerId: true,
          serviceId: true,
          staffId: true,
          startTime: true,
          endTime: true,
          status: true,
          listPrice: true,
          finalPrice: true,
          paymentMethod: true,
          paymentRecordedAt: true,
          notes: true,
        },
      });
      if (!appointment) {
        throw new Error('APPOINTMENT_NOT_FOUND');
      }

      let lines = await (tx as any).appointmentLine.findMany({
        where: { appointmentId },
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
      });
      if (!lines.length) {
        const createdLine = await ensureDefaultAppointmentLine(tx, appointment);
        lines = [createdLine];
      }

      const targetLine = Number.isInteger(appointmentLineId) && appointmentLineId && appointmentLineId > 0
        ? lines.find((line: any) => Number(line.id) === Number(appointmentLineId))
        : lines.find((line: any) => String(line.status || '').toUpperCase() === 'BOOKED') || lines[0];

      if (!targetLine) {
        throw new Error('APPOINTMENT_LINE_NOT_FOUND');
      }

      await (tx as any).appointmentLine.update({
        where: { id: Number(targetLine.id) },
        data: {
          paymentMethod,
          paymentRecordedAt: new Date(),
        },
      });

      if (String(appointment.status || '').toUpperCase() === 'COMPLETED') {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            paymentMethod,
            paymentRecordedAt: new Date(),
          },
        });
      }
    });

    const updated = await prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            duration: true,
            price: true,
            requiresSpecialist: true,
          },
        },
        staff: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        appointmentLines: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                duration: true,
                price: true,
                requiresSpecialist: true,
              },
            },
            specialist: {
              select: {
                id: true,
                name: true,
                title: true,
              },
            },
          },
          orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        },
      },
    });

    return res.status(200).json({ item: updated });
  } catch (error) {
    if ((error as any)?.message === 'APPOINTMENT_NOT_FOUND') {
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    if ((error as any)?.message === 'APPOINTMENT_LINE_NOT_FOUND') {
      return res.status(404).json({ message: 'Appointment line not found.' });
    }
    console.error('Admin appointment payment update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/setup', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const [salon, settings, serviceCount, staffCount] = await prisma.$transaction([
      prisma.salon.findUnique({
        where: { id: salonId },
        select: {
          id: true,
          name: true,
          address: true,
          whatsappPhone: true,
          city: true,
          countryCode: true,
          tagline: true,
          about: true,
          heroImageUrl: true,
          instagramUrl: true,
        },
      }),
      prisma.salonSettings.findUnique({
        where: { salonId },
        select: {
          workStartHour: true,
          workEndHour: true,
          slotInterval: true,
          workingDays: true,
          commonQuestions: true,
        },
      }),
      prisma.service.count({ where: { salonId } }),
      prisma.staff.count({ where: { salonId } }),
    ]);

    if (!salon) {
      return res.status(404).json({ message: 'Salon not found.' });
    }

    const hasPhone = Boolean((salon.whatsappPhone || '').trim());
    const hasAddress = Boolean((salon.address || '').trim());
    const hasWorkingHours =
      typeof settings?.workStartHour === 'number' && typeof settings?.workEndHour === 'number';
    const hasServices = serviceCount > 0;
    const hasStaff = staffCount > 0;

    return res.status(200).json({
      salon,
      settings: settings
        ? {
            ...settings,
            commonQuestions: normalizeCommonQuestions(settings.commonQuestions),
          }
        : settings,
      checklist: {
        workingHours: hasWorkingHours,
        address: hasAddress,
        phone: hasPhone,
        service: hasServices,
        staff: hasStaff,
        completed: hasWorkingHours && hasAddress && hasPhone && hasServices && hasStaff,
      },
      counts: {
        services: serviceCount,
        staff: staffCount,
      },
    });
  } catch (error) {
    console.error('Admin setup read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/setup', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const payload = req.body || {};

  try {
    const salon = await prisma.salon.update({
      where: { id: salonId },
      data: {
        ...(typeof payload.name === 'string' ? { name: payload.name.trim() } : {}),
        ...(typeof payload.address === 'string' ? { address: payload.address.trim() } : {}),
        ...(typeof payload.whatsappPhone === 'string' ? { whatsappPhone: payload.whatsappPhone.trim() } : {}),
        ...(typeof payload.city === 'string' ? { city: payload.city.trim() } : {}),
        ...(typeof payload.countryCode === 'string' ? { countryCode: payload.countryCode.trim().toUpperCase() } : {}),
        ...(typeof payload.tagline === 'string' ? { tagline: payload.tagline.trim() } : {}),
        ...(typeof payload.heroText === 'string' ? { heroText: payload.heroText.trim() } : {}),
        ...(typeof payload.about === 'string' ? { about: payload.about.trim() } : {}),
        ...(typeof payload.heroImageUrl === 'string' ? { heroImageUrl: payload.heroImageUrl.trim() } : {}),
        ...(typeof payload.instagramUrl === 'string' ? { instagramUrl: payload.instagramUrl.trim() } : {}),
      },
    });

  const hasSettingsUpdate =
    payload.workStartHour !== undefined ||
    payload.workEndHour !== undefined ||
    payload.slotInterval !== undefined ||
    payload.workingDays !== undefined ||
    payload.commonQuestions !== undefined;

    let settings: any = null;

    if (hasSettingsUpdate) {
      const commonQuestions =
        payload.commonQuestions !== undefined ? normalizeCommonQuestions(payload.commonQuestions) : undefined;
      settings = await prisma.salonSettings.upsert({
        where: { salonId },
        update: {
          ...(payload.workStartHour !== undefined ? { workStartHour: Number(payload.workStartHour) } : {}),
          ...(payload.workEndHour !== undefined ? { workEndHour: Number(payload.workEndHour) } : {}),
          ...(payload.slotInterval !== undefined ? { slotInterval: Number(payload.slotInterval) } : {}),
          ...(payload.workingDays !== undefined ? { workingDays: payload.workingDays } : {}),
          ...(commonQuestions !== undefined ? { commonQuestions } : {}),
        },
        create: {
          salonId,
          ...(payload.workStartHour !== undefined ? { workStartHour: Number(payload.workStartHour) } : {}),
          ...(payload.workEndHour !== undefined ? { workEndHour: Number(payload.workEndHour) } : {}),
          ...(payload.slotInterval !== undefined ? { slotInterval: Number(payload.slotInterval) } : {}),
          ...(payload.workingDays !== undefined ? { workingDays: payload.workingDays } : {}),
          ...(commonQuestions !== undefined ? { commonQuestions } : {}),
        },
      });
    }

    return res.status(200).json({
      salon,
      settings: settings
        ? {
            ...settings,
            commonQuestions: normalizeCommonQuestions(settings.commonQuestions),
          }
        : settings,
    });
  } catch (error) {
    console.error('Admin setup update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/whatsapp-agent/settings', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const settings = await prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: {
        tone: true,
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
        aiDisclosure: true,
        faqAnswers: true,
      },
    });

    const faqAnswers = asStringMap(settings?.faqAnswers);
    const isEnabled = readBooleanFlag(faqAnswers, 'aiAgentEnabled', false);

    if (!settings) {
      return res.status(200).json({
        settings: {
          tone: 'balanced',
          answerLength: 'medium',
          emojiUsage: 'low',
          bookingGuidance: 'medium',
          handoverThreshold: 'balanced',
          aiDisclosure: 'onQuestion',
          faqAnswers: {},
          isEnabled: false,
        },
      });
    }

    return res.status(200).json({
      settings: {
        ...settings,
        faqAnswers,
        isEnabled,
      },
    });
  } catch (error) {
    console.error('Admin WhatsApp agent settings read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/whatsapp-agent/settings', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const payload = req.body || {};
    const existing = await prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: {
        tone: true,
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
        aiDisclosure: true,
        faqAnswers: true,
      },
    });

    const currentFaqAnswers = asStringMap(existing?.faqAnswers);
    const providedFaqAnswers = payload.faqAnswers === undefined ? undefined : asStringMap(payload.faqAnswers);
    const faqAnswers = {
      ...currentFaqAnswers,
      ...(providedFaqAnswers || {}),
    };

    const currentIsEnabled = readBooleanFlag(currentFaqAnswers, 'aiAgentEnabled', false);
    const payloadIsEnabled = parseOptionalBoolean(payload.isEnabled);
    const isEnabled = payloadIsEnabled === undefined ? currentIsEnabled : payloadIsEnabled;
    faqAnswers.aiAgentEnabled = isEnabled ? '1' : '0';

    const tone =
      typeof payload.tone === 'string' && TONE_VALUES.has(payload.tone)
        ? payload.tone
        : existing?.tone || 'balanced';
    const answerLength =
      typeof payload.answerLength === 'string' && ANSWER_LENGTH_VALUES.has(payload.answerLength)
        ? payload.answerLength
        : existing?.answerLength || 'medium';
    const emojiUsage =
      typeof payload.emojiUsage === 'string' && EMOJI_USAGE_VALUES.has(payload.emojiUsage)
        ? payload.emojiUsage
        : existing?.emojiUsage || 'low';
    const bookingGuidance =
      typeof payload.bookingGuidance === 'string' && BOOKING_GUIDANCE_VALUES.has(payload.bookingGuidance)
        ? payload.bookingGuidance
        : existing?.bookingGuidance || 'medium';
    const handoverThreshold =
      typeof payload.handoverThreshold === 'string' && HANDOVER_THRESHOLD_VALUES.has(payload.handoverThreshold)
        ? payload.handoverThreshold
        : existing?.handoverThreshold || 'balanced';
    const aiDisclosure =
      typeof payload.aiDisclosure === 'string' && AI_DISCLOSURE_VALUES.has(payload.aiDisclosure)
        ? payload.aiDisclosure
        : existing?.aiDisclosure || 'onQuestion';

    const settings = await prisma.salonAiAgentSettings.upsert({
      where: { salonId },
      update: {
        tone,
        answerLength,
        emojiUsage,
        bookingGuidance,
        handoverThreshold,
        aiDisclosure,
        faqAnswers,
      },
      create: {
        salonId,
        tone,
        answerLength,
        emojiUsage,
        bookingGuidance,
        handoverThreshold,
        aiDisclosure,
        faqAnswers,
      },
      select: {
        tone: true,
        answerLength: true,
        emojiUsage: true,
        bookingGuidance: true,
        handoverThreshold: true,
        aiDisclosure: true,
        faqAnswers: true,
      },
    });

    return res.status(200).json({
      settings: {
        ...settings,
        faqAnswers: asStringMap(settings.faqAnswers),
        isEnabled,
      },
    });
  } catch (error) {
    console.error('Admin WhatsApp agent settings update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});







router.get('/service-categories', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    await ensureSalonServiceCategories(salonId);

    const categories = await prisma.serviceCategory.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        bufferMinutes: true,
        marketingDescription: true,
        commonQuestions: true,
        categoryId: true,
        categoryRef: {
          select: {
            key: true,
            defaultName: true,
            displayOrder: true,
          },
        },
        _count: {
          select: {
            Service: true,
          },
        },
      },
    });

    const items = categories
      .map((item) => ({
        id: item.id,
        name: item.name,
        key: item.categoryRef?.key || 'OTHER',
        defaultName: item.categoryRef?.defaultName || item.name,
        isActive: item.isActive ?? true,
        displayOrder: item.displayOrder,
        effectiveOrder: item.displayOrder ?? item.categoryRef?.displayOrder ?? 999,
        capacity: item.capacity,
        sequentialRequired: item.sequentialRequired,
        bufferMinutes: item.bufferMinutes,
        marketingDescription: item.marketingDescription,
        commonQuestions: normalizeCommonQuestions(item.commonQuestions),
        serviceCount: item._count.Service,
      }))
      .sort((a, b) => a.effectiveOrder - b.effectiveOrder || a.id - b.id);

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin service categories list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/service-categories/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return res.status(400).json({ message: 'Invalid category id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (req.body?.displayOrder !== undefined) {
    const displayOrder = Number(req.body.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      return res.status(400).json({ message: 'displayOrder must be >= 0.' });
    }
    updates.displayOrder = displayOrder;
  }
  if (req.body?.capacity !== undefined) {
    const capacity = Number(req.body.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return res.status(400).json({ message: 'capacity must be a positive integer.' });
    }
    updates.capacity = capacity;
  }
  if (req.body?.isActive !== undefined) {
    updates.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.sequentialRequired !== undefined) {
    updates.sequentialRequired = Boolean(req.body.sequentialRequired);
  }
  if (req.body?.bufferMinutes !== undefined) {
    const buffer = Number(req.body.bufferMinutes);
    if (!Number.isInteger(buffer) || buffer < 0) {
      return res.status(400).json({ message: 'bufferMinutes must be >= 0.' });
    }
    updates.bufferMinutes = buffer;
  }
  if (req.body?.marketingDescription !== undefined) {
    updates.marketingDescription =
      typeof req.body.marketingDescription === 'string' ? req.body.marketingDescription.trim() || null : null;
  }
  if (req.body?.commonQuestions !== undefined) {
    updates.commonQuestions = normalizeCommonQuestions(req.body.commonQuestions);
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.serviceCategory.findFirst({
      where: { id: categoryId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const item = await prisma.serviceCategory.update({
      where: { id: categoryId },
      data: updates,
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        bufferMinutes: true,
        marketingDescription: true,
        commonQuestions: true,
        categoryRef: {
          select: {
            key: true,
            defaultName: true,
          },
        },
      },
    });

    return res.status(200).json({
      item: {
        id: item.id,
        name: item.name,
        displayOrder: item.displayOrder,
        capacity: item.capacity,
        sequentialRequired: item.sequentialRequired,
        bufferMinutes: item.bufferMinutes,
        marketingDescription: item.marketingDescription,
        commonQuestions: normalizeCommonQuestions(item.commonQuestions),
        key: item.categoryRef?.key || 'OTHER',
        defaultName: item.categoryRef?.defaultName || item.name,
      },
    });
  } catch (error) {
    console.error('Admin service category update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-categories/reorder', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map((value: any) => Number(value)) : [];
  if (!orderedIds.length || orderedIds.some((id: number) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ message: 'orderedIds must be a non-empty number array.' });
  }

  try {
    const rows = await prisma.serviceCategory.findMany({
      where: { salonId, id: { in: orderedIds } },
      select: { id: true },
    });
    if (rows.length !== orderedIds.length) {
      return res.status(400).json({ message: 'orderedIds contains invalid categories.' });
    }

    await prisma.$transaction(
      orderedIds.map((id: number, index: number) =>
        prisma.serviceCategory.update({
          where: { id },
          data: { displayOrder: index },
          select: { id: true },
        }),
      ),
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin service category reorder error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/service-regions', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    await ensureSalonServiceRegions(salonId);

    const regions = await prisma.serviceRegion.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        categoryId: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        _count: {
          select: {
            Service: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return res.status(200).json({
      items: regions.map((item) => ({
        id: item.id,
        name: item.name,
        isActive: item.isActive ?? true,
        displayOrder: item.displayOrder,
        categoryId: item.categoryId,
        categoryKey: item.ServiceCategory?.categoryRef?.key || null,
        categoryName: item.ServiceCategory?.name || item.ServiceCategory?.categoryRef?.defaultName || null,
        serviceCount: item._count.Service,
      })),
    });
  } catch (error) {
    console.error('Admin service regions list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-regions', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const displayOrder = req.body?.displayOrder === undefined ? null : Number(req.body.displayOrder);
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive);
  const categoryId =
    req.body?.categoryId === null || req.body?.categoryId === undefined || req.body?.categoryId === ''
      ? null
      : Number(req.body.categoryId);

  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 0)) {
    return res.status(400).json({ message: 'displayOrder must be >= 0.' });
  }
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return res.status(400).json({ message: 'categoryId must be a positive integer.' });
  }

  try {
    if (categoryId !== null) {
      const categoryExists = await prisma.serviceCategory.findFirst({
        where: { id: categoryId, salonId },
        select: { id: true },
      });
      if (!categoryExists) {
        return res.status(400).json({ message: 'categoryId is not valid for this salon.' });
      }
    }

    const item = await prisma.serviceRegion.create({
      data: {
        salonId,
        name,
        isActive,
        displayOrder,
        categoryId,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        categoryId: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        _count: {
          select: {
            Service: true,
          },
        },
      },
    });

    return res.status(201).json({
      item: {
        id: item.id,
        name: item.name,
        isActive: item.isActive ?? true,
        displayOrder: item.displayOrder,
        categoryId: item.categoryId,
        categoryKey: item.ServiceCategory?.categoryRef?.key || null,
        categoryName: item.ServiceCategory?.name || item.ServiceCategory?.categoryRef?.defaultName || null,
        serviceCount: item._count.Service,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu bölge adı zaten kullanılıyor.' });
    }
    console.error('Admin service region create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/service-regions/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const regionId = Number(req.params.id);
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return res.status(400).json({ message: 'Invalid region id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (req.body?.displayOrder !== undefined) {
    const displayOrder = Number(req.body.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      return res.status(400).json({ message: 'displayOrder must be >= 0.' });
    }
    updates.displayOrder = displayOrder;
  }
  if (req.body?.isActive !== undefined) {
    updates.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.categoryId !== undefined) {
    if (req.body.categoryId === null || req.body.categoryId === '') {
      updates.categoryId = null;
    } else {
      const categoryId = Number(req.body.categoryId);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ message: 'categoryId must be a positive integer.' });
      }
      updates.categoryId = categoryId;
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.serviceRegion.findFirst({
      where: { id: regionId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Region not found.' });
    }

    if (updates.categoryId !== undefined && updates.categoryId !== null) {
      const categoryExists = await prisma.serviceCategory.findFirst({
        where: { id: updates.categoryId, salonId },
        select: { id: true },
      });
      if (!categoryExists) {
        return res.status(400).json({ message: 'categoryId is not valid for this salon.' });
      }
    }

    const item = await prisma.serviceRegion.update({
      where: { id: regionId },
      data: updates,
      select: {
        id: true,
        name: true,
        isActive: true,
        displayOrder: true,
        categoryId: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        _count: {
          select: {
            Service: true,
          },
        },
      },
    });

    return res.status(200).json({
      item: {
        id: item.id,
        name: item.name,
        isActive: item.isActive ?? true,
        displayOrder: item.displayOrder,
        categoryId: item.categoryId,
        categoryKey: item.ServiceCategory?.categoryRef?.key || null,
        categoryName: item.ServiceCategory?.name || item.ServiceCategory?.categoryRef?.defaultName || null,
        serviceCount: item._count.Service,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu bölge adı zaten kullanılıyor.' });
    }
    console.error('Admin service region update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/service-groups', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.serviceGroup.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        preparationMinutes: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });

    return res.status(200).json({
      items: items.map((item) => ({
        ...item,
        serviceCount: item._count.services,
      })),
    });
  } catch (error) {
    console.error('Admin service groups list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-groups', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() || null : null;
  const displayOrder = req.body?.displayOrder === undefined ? null : Number(req.body.displayOrder);
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive);
  const capacity = req.body?.capacity === undefined ? 1 : Number(req.body.capacity);
  const sequentialRequired = req.body?.sequentialRequired === undefined ? false : Boolean(req.body.sequentialRequired);
  const preparationMinutes = req.body?.preparationMinutes === undefined ? 0 : Number(req.body.preparationMinutes);

  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 0)) {
    return res.status(400).json({ message: 'displayOrder must be >= 0.' });
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return res.status(400).json({ message: 'capacity must be a positive integer.' });
  }
  if (!Number.isInteger(preparationMinutes) || preparationMinutes < 0) {
    return res.status(400).json({ message: 'preparationMinutes must be >= 0.' });
  }

  try {
    const item = await prisma.serviceGroup.create({
      data: {
        salonId,
        name,
        description,
        isActive,
        displayOrder,
        capacity,
        sequentialRequired,
        preparationMinutes,
      },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        preparationMinutes: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    return res.status(201).json({
      item: {
        ...item,
        serviceCount: item._count.services,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu grup adı zaten kullanılıyor.' });
    }
    console.error('Admin service group create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/service-groups/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return res.status(400).json({ message: 'Invalid group id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (req.body?.description !== undefined) {
    updates.description =
      typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
  }
  if (req.body?.displayOrder !== undefined) {
    const displayOrder = Number(req.body.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      return res.status(400).json({ message: 'displayOrder must be >= 0.' });
    }
    updates.displayOrder = displayOrder;
  }
  if (req.body?.isActive !== undefined) {
    updates.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.capacity !== undefined) {
    const capacity = Number(req.body.capacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return res.status(400).json({ message: 'capacity must be a positive integer.' });
    }
    updates.capacity = capacity;
  }
  if (req.body?.sequentialRequired !== undefined) {
    updates.sequentialRequired = Boolean(req.body.sequentialRequired);
  }
  if (req.body?.preparationMinutes !== undefined) {
    const minutes = Number(req.body.preparationMinutes);
    if (!Number.isInteger(minutes) || minutes < 0) {
      return res.status(400).json({ message: 'preparationMinutes must be >= 0.' });
    }
    updates.preparationMinutes = minutes;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.serviceGroup.findFirst({
      where: { id: groupId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Group not found.' });
    }

    const item = await prisma.serviceGroup.update({
      where: { id: groupId },
      data: updates,
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        displayOrder: true,
        capacity: true,
        sequentialRequired: true,
        preparationMinutes: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    return res.status(200).json({
      item: {
        ...item,
        serviceCount: item._count.services,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu grup adı zaten kullanılıyor.' });
    }
    console.error('Admin service group update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/service-groups/reorder', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map((value: any) => Number(value)) : [];
  if (!orderedIds.length || orderedIds.some((id: number) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ message: 'orderedIds must be a non-empty number array.' });
  }

  try {
    const rows = await prisma.serviceGroup.findMany({
      where: { salonId, id: { in: orderedIds } },
      select: { id: true },
    });
    if (rows.length !== orderedIds.length) {
      return res.status(400).json({ message: 'orderedIds contains invalid groups.' });
    }

    await prisma.$transaction(
      orderedIds.map((id: number, index: number) =>
        prisma.serviceGroup.update({
          where: { id },
          data: { displayOrder: index },
          select: { id: true },
        }),
      ),
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Admin service group reorder error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

function mapServiceForAdmin(item: any) {
  return {
    ...item,
    genders: (item?.ServiceGender || []).map((row: any) => row.gender),
    categoryKey: item?.ServiceCategory?.categoryRef?.key || item?.category || 'OTHER',
    categoryName:
      item?.ServiceCategory?.name || item?.ServiceCategory?.categoryRef?.defaultName || item?.category || 'Diğer',
    regionId: item?.regionId ?? null,
    regionName: item?.ServiceRegion?.name || null,
    regionCategoryId: item?.ServiceRegion?.categoryId || null,
    serviceGroupId: item?.serviceGroup?.id || null,
    serviceGroupName: item?.serviceGroup?.name || null,
  };
}

router.get('/services', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const services = await prisma.service.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        categoryId: true,
        regionId: true,
        capacityOverride: true,
        sequentialOverride: true,
        bufferOverride: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        ServiceRegion: {
          select: {
            id: true,
            name: true,
            categoryId: true,
          },
        },
        ServiceGender: {
          select: {
            gender: true,
          },
        },
        serviceGroup: {
          select: {
            id: true,
            name: true,
            capacity: true,
            sequentialRequired: true,
            preparationMinutes: true,
          },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return res.status(200).json({
      items: services.map(mapServiceForAdmin),
    });
  } catch (error) {
    console.error('Admin services list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/services/:id/staff', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'Invalid service id.' });
  }

  try {
    const staff = await prisma.staffService.findMany({
      where: {
        serviceId,
        isactive: true,
        Staff: { salonId },
      },
      select: {
        staffId: true,
        duration: true,
        price: true,
        Staff: {
          select: {
            id: true,
            name: true,
            title: true,
          },
        },
      },
      orderBy: {
        Staff: {
          name: 'asc',
        },
      },
    });

    return res.status(200).json({
      items: staff.map((row) => ({
        id: row.Staff.id,
        name: row.Staff.name,
        title: row.Staff.title,
        overrideDuration: row.duration,
        overridePrice: row.price,
      })),
    });
  } catch (error) {
    console.error('Admin service staff list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/services', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const duration = Number(req.body?.duration);
  const price = Number(req.body?.price);
  const category = typeof req.body?.category === 'string' && req.body.category.trim() ? req.body.category.trim() : 'OTHER';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
  const requiresSpecialist = Boolean(req.body?.requiresSpecialist);
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body?.isActive);
  const categoryId =
    req.body?.categoryId === null || req.body?.categoryId === undefined || req.body?.categoryId === ''
      ? null
      : Number(req.body.categoryId);
  const regionId =
    req.body?.regionId === null || req.body?.regionId === undefined || req.body?.regionId === ''
      ? null
      : Number(req.body.regionId);
  const genders = parseServiceGenders(req.body?.genders);
  const serviceGroupId =
    req.body?.serviceGroupId === null || req.body?.serviceGroupId === undefined || req.body?.serviceGroupId === ''
      ? null
      : Number(req.body.serviceGroupId);
  const capacityOverride =
    req.body?.capacityOverride === null || req.body?.capacityOverride === undefined || req.body?.capacityOverride === ''
      ? null
      : Number(req.body.capacityOverride);
  const sequentialOverride =
    req.body?.sequentialOverride === null || req.body?.sequentialOverride === undefined || req.body?.sequentialOverride === ''
      ? null
      : Boolean(req.body.sequentialOverride);
  const bufferOverride =
    req.body?.bufferOverride === null || req.body?.bufferOverride === undefined || req.body?.bufferOverride === ''
      ? null
      : Number(req.body.bufferOverride);

  if (!name || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ message: 'name, duration and price are required.' });
  }
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
    return res.status(400).json({ message: 'categoryId must be a positive integer.' });
  }
  if (regionId !== null && (!Number.isInteger(regionId) || regionId <= 0)) {
    return res.status(400).json({ message: 'regionId must be a positive integer.' });
  }
  if (serviceGroupId !== null && (!Number.isInteger(serviceGroupId) || serviceGroupId <= 0)) {
    return res.status(400).json({ message: 'serviceGroupId must be a positive integer.' });
  }
  if (capacityOverride !== null && (!Number.isInteger(capacityOverride) || capacityOverride <= 0)) {
    return res.status(400).json({ message: 'capacityOverride must be a positive integer.' });
  }
  if (bufferOverride !== null && (!Number.isFinite(bufferOverride) || bufferOverride < 0)) {
    return res.status(400).json({ message: 'bufferOverride must be >= 0.' });
  }

  try {
    if (serviceGroupId !== null) {
      const groupExists = await prisma.serviceGroup.findFirst({
        where: { id: serviceGroupId, salonId },
        select: { id: true },
      });
      if (!groupExists) {
        return res.status(400).json({ message: 'serviceGroupId is not valid for this salon.' });
      }
    }
    if (regionId !== null) {
      const regionExists = await prisma.serviceRegion.findFirst({
        where: { id: regionId, salonId },
        select: { id: true },
      });
      if (!regionExists) {
        return res.status(400).json({ message: 'regionId is not valid for this salon.' });
      }
    }

    const serviceId = await prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: {
          salonId,
          name,
          duration: Math.round(duration),
          price,
          category,
          description,
          isActive,
          requiresSpecialist,
          categoryId,
          regionId,
          serviceGroupId,
          capacityOverride,
          sequentialOverride,
          bufferOverride,
        },
        select: { id: true },
      });

      if (genders.length > 0) {
        await tx.serviceGender.createMany({
          data: genders.map((gender) => ({ serviceId: created.id, gender })),
        });
      }

      return created.id;
    });

    const service = await prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        categoryId: true,
        regionId: true,
        serviceGroupId: true,
        capacityOverride: true,
        sequentialOverride: true,
        bufferOverride: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        ServiceRegion: {
          select: {
            id: true,
            name: true,
            categoryId: true,
          },
        },
        ServiceGender: {
          select: {
            gender: true,
          },
        },
        serviceGroup: {
          select: {
            id: true,
            name: true,
            capacity: true,
            sequentialRequired: true,
            preparationMinutes: true,
          },
        },
      },
    });

    return res.status(201).json({ item: mapServiceForAdmin(service) });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu isimde hizmet zaten mevcut.' });
    }
    console.error('Admin service create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/services/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'Invalid service id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    updates.name = req.body.name.trim();
  }
  if (typeof req.body?.description === 'string') {
    updates.description = req.body.description.trim() || null;
  }
  if (typeof req.body?.category === 'string') {
    updates.category = req.body.category.trim() || 'OTHER';
  }
  if (req.body?.duration !== undefined) {
    const duration = Number(req.body.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ message: 'duration must be a positive number.' });
    }
    updates.duration = Math.round(duration);
  }
  if (req.body?.price !== undefined) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: 'price must be a non-negative number.' });
    }
    updates.price = price;
  }
  if (req.body?.requiresSpecialist !== undefined) {
    updates.requiresSpecialist = Boolean(req.body.requiresSpecialist);
  }
  if (req.body?.isActive !== undefined) {
    updates.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.categoryId !== undefined) {
    if (req.body.categoryId === null || req.body.categoryId === '') {
      updates.categoryId = null;
    } else {
      const categoryId = Number(req.body.categoryId);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return res.status(400).json({ message: 'categoryId must be a positive integer.' });
      }
      updates.categoryId = categoryId;
    }
  }
  if (req.body?.regionId !== undefined) {
    if (req.body.regionId === null || req.body.regionId === '') {
      updates.regionId = null;
    } else {
      const regionId = Number(req.body.regionId);
      if (!Number.isInteger(regionId) || regionId <= 0) {
        return res.status(400).json({ message: 'regionId must be a positive integer.' });
      }
      updates.regionId = regionId;
    }
  }
  if (req.body?.serviceGroupId !== undefined) {
    if (req.body.serviceGroupId === null || req.body.serviceGroupId === '') {
      updates.serviceGroupId = null;
    } else {
      const serviceGroupId = Number(req.body.serviceGroupId);
      if (!Number.isInteger(serviceGroupId) || serviceGroupId <= 0) {
        return res.status(400).json({ message: 'serviceGroupId must be a positive integer.' });
      }
      updates.serviceGroupId = serviceGroupId;
    }
  }
  if (req.body?.capacityOverride !== undefined) {
    if (req.body.capacityOverride === null || req.body.capacityOverride === '') {
      updates.capacityOverride = null;
    } else {
      const capacity = Number(req.body.capacityOverride);
      if (!Number.isInteger(capacity) || capacity <= 0) {
        return res.status(400).json({ message: 'capacityOverride must be a positive integer.' });
      }
      updates.capacityOverride = capacity;
    }
  }
  if (req.body?.sequentialOverride !== undefined) {
    if (req.body.sequentialOverride === null || req.body.sequentialOverride === '') {
      updates.sequentialOverride = null;
    } else {
      updates.sequentialOverride = Boolean(req.body.sequentialOverride);
    }
  }
  if (req.body?.bufferOverride !== undefined) {
    if (req.body.bufferOverride === null || req.body.bufferOverride === '') {
      updates.bufferOverride = null;
    } else {
      const buffer = Number(req.body.bufferOverride);
      if (!Number.isFinite(buffer) || buffer < 0) {
        return res.status(400).json({ message: 'bufferOverride must be >= 0.' });
      }
      updates.bufferOverride = Math.round(buffer);
    }
  }

  const hasGenderUpdate = req.body?.genders !== undefined;
  const genders = hasGenderUpdate ? parseServiceGenders(req.body?.genders) : [];

  if (!Object.keys(updates).length && !hasGenderUpdate) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    const exists = await prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    if (updates.serviceGroupId !== undefined && updates.serviceGroupId !== null) {
      const groupExists = await prisma.serviceGroup.findFirst({
        where: { id: updates.serviceGroupId, salonId },
        select: { id: true },
      });
      if (!groupExists) {
        return res.status(400).json({ message: 'serviceGroupId is not valid for this salon.' });
      }
    }
    if (updates.regionId !== undefined && updates.regionId !== null) {
      const regionExists = await prisma.serviceRegion.findFirst({
        where: { id: updates.regionId, salonId },
        select: { id: true },
      });
      if (!regionExists) {
        return res.status(400).json({ message: 'regionId is not valid for this salon.' });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx.service.update({
          where: { id: serviceId },
          data: updates,
        });
      }

      if (hasGenderUpdate) {
        await tx.serviceGender.deleteMany({ where: { serviceId } });
        if (genders.length > 0) {
          await tx.serviceGender.createMany({
            data: genders.map((gender) => ({ serviceId, gender })),
          });
        }
      }
    });

    const service = await prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        duration: true,
        price: true,
        category: true,
        requiresSpecialist: true,
        categoryId: true,
        regionId: true,
        serviceGroupId: true,
        capacityOverride: true,
        sequentialOverride: true,
        bufferOverride: true,
        ServiceCategory: {
          select: {
            id: true,
            name: true,
            categoryRef: {
              select: {
                key: true,
                defaultName: true,
              },
            },
          },
        },
        ServiceRegion: {
          select: {
            id: true,
            name: true,
            categoryId: true,
          },
        },
        ServiceGender: {
          select: {
            gender: true,
          },
        },
        serviceGroup: {
          select: {
            id: true,
            name: true,
            capacity: true,
            sequentialRequired: true,
            preparationMinutes: true,
          },
        },
      },
    });

    return res.status(200).json({ item: mapServiceForAdmin(service) });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu isimde hizmet zaten mevcut.' });
    }
    console.error('Admin service update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.delete('/services/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return res.status(400).json({ message: 'Invalid service id.' });
  }

  try {
    const exists = await prisma.service.findFirst({
      where: { id: serviceId, salonId },
      select: { id: true },
    });
    if (!exists) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    await prisma.service.delete({ where: { id: serviceId } });
    return res.status(204).send();
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Bu hizmet randevularda kullanıldığı için silinemez.' });
    }
    console.error('Admin service delete error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/staff', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const staff = await prisma.staff.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        themeColor: true,
        profileImageUrl: true,
        StaffService: {
          where: {
            Service: { salonId },
          },
          select: {
            id: true,
            serviceId: true,
            price: true,
            duration: true,
            isactive: true,
            gender: true,
            Service: {
              select: {
                id: true,
                name: true,
                category: true,
                price: true,
                duration: true,
                ServiceCategory: {
                  select: {
                    id: true,
                    name: true,
                    categoryRef: {
                      select: {
                        key: true,
                        defaultName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return res.status(200).json({ items: staff.map(mapStaffForMobile) });
  } catch (error) {
    console.error('Admin staff list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/staff', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }
  const themeColor =
    req.body?.themeColor === null || req.body?.themeColor === undefined || req.body?.themeColor === ''
      ? null
      : normalizeThemeColor(req.body.themeColor);

  if (req.body?.themeColor !== undefined && req.body?.themeColor !== null && req.body?.themeColor !== '' && !themeColor) {
    return res.status(400).json({ message: 'themeColor must be in #RRGGBB format.' });
  }

  const assignments = parseStaffServiceAssignments(req.body?.serviceAssignments);

  try {
    const createdStaffId = await prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          salonId,
          name,
          title: typeof req.body?.title === 'string' ? req.body.title.trim() : null,
          bio: typeof req.body?.bio === 'string' ? req.body.bio.trim() : null,
          phone: typeof req.body?.phone === 'string' ? req.body.phone.trim() : null,
          themeColor: themeColor || randomStaffColor(),
          profileImageUrl: typeof req.body?.profileImageUrl === 'string' ? req.body.profileImageUrl.trim() : null,
        },
        select: { id: true },
      });

      if (assignments.length > 0) {
        const serviceIds = assignments.map((item) => item.serviceId);
        const services = await tx.service.findMany({
          where: {
            salonId,
            id: { in: serviceIds },
          },
          select: { id: true, price: true, duration: true },
        });

        if (services.length !== serviceIds.length) {
          throw new Error('INVALID_SERVICE_ASSIGNMENT');
        }

        const serviceMap = new Map(services.map((service) => [service.id, service]));
        await tx.staffService.createMany({
          data: assignments.map((item) => {
            const service = serviceMap.get(item.serviceId)!;
            return {
              staffId: staff.id,
              serviceId: item.serviceId,
              price: item.customPrice ?? service.price,
              duration: item.customDuration ?? service.duration,
              isactive: true,
              gender: item.gender,
            };
          }),
        });
      }

      return staff.id;
    });

    const staff = await prisma.staff.findFirst({
      where: { id: createdStaffId, salonId },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        themeColor: true,
        profileImageUrl: true,
        StaffService: {
          where: {
            Service: { salonId },
          },
          select: {
            id: true,
            serviceId: true,
            price: true,
            duration: true,
            isactive: true,
            gender: true,
            Service: {
              select: {
                id: true,
                name: true,
                category: true,
                price: true,
                duration: true,
                ServiceCategory: {
                  select: {
                    id: true,
                    name: true,
                    categoryRef: {
                      select: {
                        key: true,
                        defaultName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return res.status(201).json({ item: mapStaffForMobile(staff) });
  } catch (error) {
    if ((error as Error)?.message === 'INVALID_SERVICE_ASSIGNMENT') {
      return res.status(400).json({ message: 'serviceAssignments içinde geçersiz hizmet var.' });
    }
    console.error('Admin staff create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/staff/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const staffId = Number(req.params.id);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return res.status(400).json({ message: 'Invalid staff id.' });
  }

  const updates: any = {};
  if (typeof req.body?.name === 'string') {
    const name = req.body.name.trim();
    if (!name) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }
    updates.name = name;
  }
  if (req.body?.title !== undefined) {
    updates.title = typeof req.body.title === 'string' ? req.body.title.trim() || null : null;
  }
  if (req.body?.bio !== undefined) {
    updates.bio = typeof req.body.bio === 'string' ? req.body.bio.trim() || null : null;
  }
  if (req.body?.phone !== undefined) {
    updates.phone = typeof req.body.phone === 'string' ? req.body.phone.trim() || null : null;
  }
  if (req.body?.profileImageUrl !== undefined) {
    updates.profileImageUrl = typeof req.body.profileImageUrl === 'string' ? req.body.profileImageUrl.trim() || null : null;
  }
  if (req.body?.themeColor !== undefined) {
    if (req.body.themeColor === null || req.body.themeColor === '') {
      updates.themeColor = null;
    } else {
      const themeColor = normalizeThemeColor(req.body.themeColor);
      if (!themeColor) {
        return res.status(400).json({ message: 'themeColor must be in #RRGGBB format.' });
      }
      updates.themeColor = themeColor;
    }
  }

  const hasAssignments = req.body?.serviceAssignments !== undefined;
  const assignments = hasAssignments ? parseStaffServiceAssignments(req.body?.serviceAssignments) : [];

  if (!Object.keys(updates).length && !hasAssignments) {
    return res.status(400).json({ message: 'No valid update field provided.' });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.staff.findFirst({
        where: { id: staffId, salonId },
        select: { id: true },
      });
      if (!existing) {
        throw new Error('STAFF_NOT_FOUND');
      }

      if (Object.keys(updates).length > 0) {
        await tx.staff.update({
          where: { id: staffId },
          data: updates,
        });
      }

      if (hasAssignments) {
        const serviceIds = assignments.map((item) => item.serviceId);
        if (serviceIds.length > 0) {
          const services = await tx.service.findMany({
            where: {
              salonId,
              id: { in: serviceIds },
            },
            select: { id: true, price: true, duration: true },
          });
          if (services.length !== serviceIds.length) {
            throw new Error('INVALID_SERVICE_ASSIGNMENT');
          }

          const serviceMap = new Map(services.map((service) => [service.id, service]));
          await tx.staffService.deleteMany({
            where: { staffId },
          });

          await tx.staffService.createMany({
            data: assignments.map((item) => {
              const service = serviceMap.get(item.serviceId)!;
              return {
                staffId,
                serviceId: item.serviceId,
                price: item.customPrice ?? service.price,
                duration: item.customDuration ?? service.duration,
                isactive: true,
                gender: item.gender,
              };
            }),
          });
        } else {
          await tx.staffService.deleteMany({
            where: { staffId },
          });
        }
      }
    });

    const staff = await prisma.staff.findFirst({
      where: { id: staffId, salonId },
      select: {
        id: true,
        name: true,
        title: true,
        bio: true,
        phone: true,
        themeColor: true,
        profileImageUrl: true,
        StaffService: {
          where: {
            Service: { salonId },
          },
          select: {
            id: true,
            serviceId: true,
            price: true,
            duration: true,
            isactive: true,
            gender: true,
            Service: {
              select: {
                id: true,
                name: true,
                category: true,
                price: true,
                duration: true,
                ServiceCategory: {
                  select: {
                    id: true,
                    name: true,
                    categoryRef: {
                      select: {
                        key: true,
                        defaultName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return res.status(200).json({ item: mapStaffForMobile(staff) });
  } catch (error) {
    if ((error as Error)?.message === 'STAFF_NOT_FOUND') {
      return res.status(404).json({ message: 'Staff not found.' });
    }
    if ((error as Error)?.message === 'INVALID_SERVICE_ASSIGNMENT') {
      return res.status(400).json({ message: 'serviceAssignments içinde geçersiz hizmet var.' });
    }
    console.error('Admin staff update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.delete('/staff/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const staffId = Number(req.params.id);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return res.status(400).json({ message: 'Invalid staff id.' });
  }

  try {
    const existing = await prisma.staff.findFirst({
      where: { id: staffId, salonId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Staff not found.' });
    }

    await prisma.staff.delete({
      where: { id: staffId },
    });

    return res.status(204).send();
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Bu çalışan randevularda kullanıldığı için silinemez.' });
    }
    console.error('Admin staff delete error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/inventory/items', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.inventoryItem.findMany({
      where: { salonId, isActive: true },
      orderBy: [{ currentStock: 'asc' }, { id: 'desc' }],
    });

    return res.status(200).json({
      items: items.map((item) => ({
        ...item,
        lowStock: item.currentStock <= item.minStock,
      })),
    });
  } catch (error) {
    console.error('Admin inventory list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/inventory/items', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        salonId,
        name,
        category: typeof req.body?.category === 'string' ? req.body.category.trim() : null,
        unit: typeof req.body?.unit === 'string' && req.body.unit.trim() ? req.body.unit.trim() : 'adet',
        currentStock: Math.max(0, Number(req.body?.currentStock) || 0),
        minStock: Math.max(0, Number(req.body?.minStock) || 0),
        price: req.body?.price !== undefined ? Number(req.body.price) : null,
        supplier: typeof req.body?.supplier === 'string' ? req.body.supplier.trim() : null,
      },
    });

    return res.status(201).json({ item });
  } catch (error) {
    console.error('Admin inventory create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/inventory/items/:id/adjust', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const itemId = Number(req.params.id);
  const quantity = Math.abs(Number(req.body?.quantity));
  const type = String(req.body?.type || 'IN').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;

  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return res.status(400).json({ message: 'Invalid item id or quantity.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, salonId, isActive: true } });
      if (!item) {
        throw new Error('ITEM_NOT_FOUND');
      }

      const nextStock = type === 'OUT' ? item.currentStock - quantity : item.currentStock + quantity;
      if (nextStock < 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      const updatedItem = await tx.inventoryItem.update({
        where: { id: item.id },
        data: { currentStock: nextStock },
      });

      await tx.inventoryMovement.create({
        data: {
          salonId,
          inventoryItemId: item.id,
          type,
          quantity,
          reason,
          createdByUserId: req.user.userId,
        },
      });

      return updatedItem;
    });

    return res.status(200).json({ item: result });
  } catch (error: any) {
    if (error?.message === 'ITEM_NOT_FOUND') {
      return res.status(404).json({ message: 'Inventory item not found.' });
    }
    if (error?.message === 'INSUFFICIENT_STOCK') {
      return res.status(400).json({ message: 'Insufficient stock.' });
    }
    console.error('Admin inventory adjust error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/inventory/movements', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const itemId = typeof req.query.itemId === 'string' ? Number(req.query.itemId) : null;
  const limit = asPositiveInt(req.query.limit, 50, 1, 200);

  try {
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        salonId,
        ...(itemId && itemId > 0 ? { inventoryItemId: itemId } : {}),
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return res.status(200).json({ items: movements });
  } catch (error) {
    console.error('Admin inventory movements error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/campaigns', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { salonId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return res.status(200).json({ items: campaigns });
  } catch (error) {
    console.error('Admin campaigns list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/campaigns', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';

  if (!name || !type) {
    return res.status(400).json({ message: 'name and type are required.' });
  }

  try {
    const startsAt = parseCampaignDateInput(req.body?.startsAt);
    const endsAt = parseCampaignDateInput(req.body?.endsAt);
    if (startsAt === undefined || endsAt === undefined) {
      return res.status(400).json({ message: 'Invalid startsAt or endsAt date.' });
    }

    const campaign = await prisma.campaign.create({
      data: {
        salonId,
        name,
        type,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : null,
        config: req.body?.config ?? null,
        isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
        priority: Number.isFinite(Number(req.body?.priority)) ? Number(req.body.priority) : 100,
        deliveryMode: asCampaignDeliveryMode(req.body?.deliveryMode) || (shouldAutoSendCampaignType(type) ? 'AUTO' : 'MANUAL'),
        maxGlobalUsage: Number.isFinite(Number(req.body?.maxGlobalUsage)) ? Number(req.body.maxGlobalUsage) : null,
        maxPerCustomer: Number.isFinite(Number(req.body?.maxPerCustomer)) ? Number(req.body.maxPerCustomer) : null,
        startsAt,
        endsAt,
      },
    });

    return res.status(201).json({ item: campaign });
  } catch (error) {
    console.error('Admin campaign create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/campaigns/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  try {
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        salonId,
      },
    });

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const metrics = await buildCampaignMetrics(campaign);

    return res.status(200).json({
      item: campaign,
      metrics,
    });
  } catch (error) {
    console.error('Admin campaign detail error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/campaigns/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  const data: any = {};
  if (typeof req.body?.name === 'string') {
    const trimmed = req.body.name.trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }
    data.name = trimmed;
  }
  if (typeof req.body?.type === 'string') {
    const trimmed = req.body.type.trim();
    if (!trimmed) {
      return res.status(400).json({ message: 'type cannot be empty.' });
    }
    data.type = trimmed;
  }
  if (req.body?.description !== undefined) {
    data.description =
      typeof req.body.description === 'string' && req.body.description.trim()
        ? req.body.description.trim()
        : null;
  }
  if (req.body?.config !== undefined) {
    data.config = req.body.config ?? null;
  }
  if (req.body?.priority !== undefined) {
    const priority = Number(req.body.priority);
    if (!Number.isFinite(priority)) {
      return res.status(400).json({ message: 'Invalid priority.' });
    }
    data.priority = priority;
  }
  if (req.body?.deliveryMode !== undefined) {
    const deliveryMode = asCampaignDeliveryMode(req.body.deliveryMode);
    if (!deliveryMode) {
      return res.status(400).json({ message: 'deliveryMode must be AUTO or MANUAL.' });
    }
    data.deliveryMode = deliveryMode;
  }
  if (req.body?.maxGlobalUsage !== undefined) {
    const maxGlobalUsage = Number(req.body.maxGlobalUsage);
    data.maxGlobalUsage = Number.isFinite(maxGlobalUsage) && maxGlobalUsage > 0 ? Math.floor(maxGlobalUsage) : null;
  }
  if (req.body?.maxPerCustomer !== undefined) {
    const maxPerCustomer = Number(req.body.maxPerCustomer);
    data.maxPerCustomer = Number.isFinite(maxPerCustomer) && maxPerCustomer > 0 ? Math.floor(maxPerCustomer) : null;
  }
  if (req.body?.isActive !== undefined) {
    data.isActive = Boolean(req.body.isActive);
  }
  if (req.body?.startsAt !== undefined) {
    const startsAt = parseCampaignDateInput(req.body.startsAt);
    if (startsAt === undefined) {
      return res.status(400).json({ message: 'Invalid startsAt date.' });
    }
    data.startsAt = startsAt;
  }
  if (req.body?.endsAt !== undefined) {
    const endsAt = parseCampaignDateInput(req.body.endsAt);
    if (endsAt === undefined) {
      return res.status(400).json({ message: 'Invalid endsAt date.' });
    }
    data.endsAt = endsAt;
  }

  try {
    const existing = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        salonId,
      },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data,
    });

    return res.status(200).json({ item: campaign });
  } catch (error) {
    console.error('Admin campaign update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.delete('/campaigns/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  try {
    const existing = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        salonId,
      },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    await prisma.campaign.delete({
      where: { id: campaignId },
    });

    return res.status(204).send();
  } catch (error) {
    console.error('Admin campaign delete error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/campaigns/pricing-preview', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const startTime = parseIsoDate(req.body?.startTime || new Date().toISOString());
  if (!startTime) {
    return res.status(400).json({ message: 'startTime is required.' });
  }

  const customerIdRaw = Number(req.body?.customerId);
  const customerId = Number.isInteger(customerIdRaw) && customerIdRaw > 0 ? customerIdRaw : null;
  const linesRaw = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!linesRaw.length) {
    return res.status(400).json({ message: 'lines[] is required.' });
  }

  try {
    const lines = linesRaw.map((line: any) => ({
      serviceId: Number(line?.serviceId),
      listPrice: Number(line?.listPrice || 0),
      isPackageCovered: Boolean(line?.isPackageCovered),
    }));
    const result = await previewCampaignPricing({
      salonId,
      customerId,
      startTime,
      lines,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Admin campaign pricing-preview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/campaigns/:id/publish', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, salonId },
    });
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        isActive: true,
        publishedAt: new Date(),
      },
    });

    return res.status(200).json({ item: updated });
  } catch (error) {
    console.error('Admin campaign publish error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/campaigns/:id/send', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ message: 'Invalid campaign id.' });
  }

  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, salonId },
      select: { id: true, name: true, type: true },
    });
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const recipients = await listCampaignsForSend(salonId, campaignId);
    const recipientUserIds = recipients.map((row) => row.customerId).filter((id) => Number.isInteger(id) && id > 0);

    await createNotification({
      salonId,
      eventType: 'CAMPAIGN_MANUAL_SEND',
      title: `Campaign sent: ${campaign.name}`,
      body: `${campaign.type} campaign target list prepared (${recipientUserIds.length} customers).`,
      payload: {
        campaignId: campaign.id,
        campaignType: campaign.type,
        audienceSize: recipientUserIds.length,
      },
      recipientUserIds: [req.user?.userId].filter((id: any) => Number.isInteger(id) && id > 0),
    });

    return res.status(200).json({
      sent: true,
      campaignId: campaign.id,
      audienceSize: recipientUserIds.length,
    });
  } catch (error) {
    console.error('Admin campaign send error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/automations', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.automationRule.findMany({
      where: { salonId },
      orderBy: [{ isEnabled: 'desc' }, { updatedAt: 'desc' }],
    });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin automations list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/automations', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

  if (!key || !name) {
    return res.status(400).json({ message: 'key and name are required.' });
  }

  try {
    const item = await prisma.automationRule.create({
      data: {
        salonId,
        key,
        name,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : null,
        config: req.body?.config ?? null,
        isEnabled: Boolean(req.body?.isEnabled),
      },
    });

    return res.status(201).json({ item });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Bu otomasyon anahtari zaten tanimli.' });
    }
    console.error('Admin automation create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/automations/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id.' });
  }

  try {
    const current = await prisma.automationRule.findFirst({ where: { id, salonId } });
    if (!current) {
      return res.status(404).json({ message: 'Automation not found.' });
    }

    const item = await prisma.automationRule.update({
      where: { id },
      data: {
        ...(req.body?.name !== undefined ? { name: String(req.body.name).trim() } : {}),
        ...(req.body?.description !== undefined ? { description: req.body.description ? String(req.body.description).trim() : null } : {}),
        ...(req.body?.config !== undefined ? { config: req.body.config } : {}),
        ...(req.body?.isEnabled !== undefined ? { isEnabled: Boolean(req.body.isEnabled) } : {}),
      },
    });

    return res.status(200).json({ item });
  } catch (error) {
    console.error('Admin automation update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/notification-settings', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  try {
    const policy = await getSalonNotificationPolicy(salonId);
    return res.status(200).json({ policy });
  } catch (error) {
    console.error('Admin notification settings get error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/notification-settings', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) return;

  try {
    const incoming = req.body || {};
    const nextPolicy = {
      ...getDefaultNotificationPolicy(),
      ...(typeof incoming === 'object' ? incoming : {}),
    };
    await upsertSalonNotificationPolicy(salonId, nextPolicy as any);
    const saved = await getSalonNotificationPolicy(salonId);
    return res.status(200).json({ policy: saved });
  } catch (error) {
    console.error('Admin notification settings update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/analytics/overview', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const now = new Date();
  const defaultFrom = startOfCurrentWeekMonday(now);

  const from = parseIsoDate(req.query.from) || defaultFrom;
  const to = parseIsoDate(req.query.to) || now;

  if (from >= to) {
    return res.status(400).json({ message: 'from must be earlier than to.' });
  }

  const rawDaySpan = Math.ceil((to.getTime() - from.getTime()) / ONE_DAY_MS) + 1;
  if (rawDaySpan > 180) {
    return res.status(400).json({ message: 'Date range is too large. Maximum 180 days.' });
  }

  try {
    const [appointmentsRaw, totalCustomers, newCustomerRows, settings] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          salonId,
          startTime: { gte: from, lte: to },
        },
        select: {
          id: true,
          status: true,
          startTime: true,
          serviceId: true,
          staffId: true,
          customerRating: true,
          service: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
          staff: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.customer.count({ where: { salonId } }),
      prisma.customer.findMany({
        where: { salonId, createdAt: { gte: from, lte: to } },
        select: { createdAt: true },
      }),
      prisma.salonSettings.findUnique({
        where: { salonId },
        select: { workingDays: true },
      }),
    ]);

    const workingDays = normalizeWorkingDays(settings?.workingDays);
    const appointments = appointmentsRaw.filter((appointment) => isWorkingDay(appointment.startTime, workingDays));
    const newCustomers = newCustomerRows.reduce((count, row) => {
      if (row.createdAt && isWorkingDay(row.createdAt, workingDays)) {
        return count + 1;
      }
      return count;
    }, 0);

    let revenue = 0;
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;

    const serviceStats = new Map<number, { id: number; name: string; appointments: number; revenue: number }>();
    const staffStats = new Map<
      number,
      { id: number; name: string; appointments: number; revenue: number; ratingSum: number; ratingCount: number }
    >();

    for (const apt of appointments) {
      if (apt.status === 'COMPLETED') {
        completed += 1;
        revenue += apt.service.price;
      } else if (apt.status === 'CANCELLED') {
        cancelled += 1;
      } else if (apt.status === 'NO_SHOW') {
        noShow += 1;
      }

      const existing = serviceStats.get(apt.service.id) || {
        id: apt.service.id,
        name: apt.service.name,
        appointments: 0,
        revenue: 0,
      };
      existing.appointments += 1;
      if (apt.status === 'COMPLETED') {
        existing.revenue += apt.service.price;
      }
      serviceStats.set(apt.service.id, existing);

      if (apt.staff) {
        const staffExisting = staffStats.get(apt.staffId) || {
          id: apt.staff.id,
          name: apt.staff.name,
          appointments: 0,
          revenue: 0,
          ratingSum: 0,
          ratingCount: 0,
        };
        staffExisting.appointments += 1;
        if (apt.status === 'COMPLETED') {
          staffExisting.revenue += apt.service.price;
        }
        if (typeof apt.customerRating === 'number' && apt.customerRating > 0) {
          staffExisting.ratingSum += apt.customerRating;
          staffExisting.ratingCount += 1;
        }
        staffStats.set(apt.staffId, staffExisting);
      }
    }

    const topServices = Array.from(serviceStats.values())
      .sort((a, b) => b.revenue - a.revenue || b.appointments - a.appointments)
      .slice(0, 6);

    const staffPerformance = Array.from(staffStats.values())
      .sort((a, b) => b.revenue - a.revenue || b.appointments - a.appointments)
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        name: item.name,
        appointments: item.appointments,
        revenue: item.revenue,
        avgRating: Number(
          (item.ratingCount > 0 ? item.ratingSum / item.ratingCount : 4.7 + Math.min(item.appointments, 6) * 0.03).toFixed(2),
        ),
      }));

    const trendStartKey = toTimezoneDateKey(from);
    const trendEndKey = toTimezoneDateKey(to);
    const trendStart = parseDateKeyToUtcStart(trendStartKey);
    const trendEnd = parseDateKeyToUtcStart(trendEndKey);
    const trendDayCount = Math.max(1, Math.floor((trendEnd.getTime() - trendStart.getTime()) / ONE_DAY_MS) + 1);
    const useWeekdayLabel = trendDayCount <= 7;

    const trendRevenueMap = new Map<
      string,
      { date: string; label: string; revenue: number; appointments: number; sortKey: number }
    >();

    for (let i = 0; i < trendDayCount; i += 1) {
      const day = new Date(trendStart);
      day.setUTCDate(trendStart.getUTCDate() + i);
      if (!isWorkingDay(day, workingDays)) {
        continue;
      }
      const dateKey = toTimezoneDateKey(day);
      trendRevenueMap.set(dateKey, {
        date: dateKey,
        label: useWeekdayLabel ? toTurkishWeekdayLabel(day) : toTurkishDateLabel(day),
        revenue: 0,
        appointments: 0,
        sortKey: day.getTime(),
      });
    }

    for (const item of appointments) {
      if (item.status !== 'COMPLETED') {
        continue;
      }
      if (!isWorkingDay(item.startTime, workingDays)) {
        continue;
      }
      const dateKey = toTimezoneDateKey(item.startTime);
      const existing = trendRevenueMap.get(dateKey);
      if (!existing) continue;
      existing.revenue += item.service?.price || 0;
      existing.appointments += 1;
    }

    const trendRevenue = Array.from(trendRevenueMap.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey, ...rest }) => rest);

    return res.status(200).json({
      from: from.toISOString(),
      to: to.toISOString(),
      metrics: {
        totalAppointments: appointments.length,
        completedAppointments: completed,
        cancelledAppointments: cancelled,
        noShowAppointments: noShow,
        totalCustomers,
        newCustomers,
        revenue,
      },
      topServices,
      staffPerformance,
      trendRevenue,
      weeklyRevenue: trendRevenue,
    });
  } catch (error) {
    console.error('Admin analytics overview error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/analytics/presets', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  try {
    const items = await prisma.analyticsPreset.findMany({
      where: { salonId },
      orderBy: { updatedAt: 'desc' },
    });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin analytics preset list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/analytics/presets', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ message: 'name is required.' });
  }

  try {
    const item = await prisma.analyticsPreset.create({
      data: {
        salonId,
        name,
        filters: req.body?.filters ?? null,
      },
    });

    return res.status(201).json({ item });
  } catch (error) {
    console.error('Admin analytics preset create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

function asInboundChannel(value: unknown): 'INSTAGRAM' | 'WHATSAPP' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') {
    return normalized;
  }
  return null;
}

function extractRawConversationKey(channel: 'INSTAGRAM' | 'WHATSAPP', value: string): string {
  const trimmed = value.trim();
  const prefix = `${channel}:`;
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}

function conversationKeyCandidates(channel: 'INSTAGRAM' | 'WHATSAPP', value: string): string[] {
  const raw = extractRawConversationKey(channel, value);
  return Array.from(new Set([value.trim(), raw, `${channel}:${raw}`].filter(Boolean)));
}

function resolveMessageDirection(messageType: string): 'inbound' | 'outbound' | 'system' {
  const normalized = (messageType || '').trim().toLowerCase();
  if (normalized === 'handover_request') return 'system';
  if (normalized.includes('outbound') || normalized.startsWith('echo_')) return 'outbound';
  return 'inbound';
}

function resolveStoredEventDirection(value: unknown, messageType: string): 'inbound' | 'outbound' | 'system' {
  if (value === 'INBOUND') return 'inbound';
  if (value === 'OUTBOUND') return 'outbound';
  if (value === 'SYSTEM') return 'system';
  return resolveMessageDirection(messageType);
}

type MessageOutboundSource = 'AI_AGENT' | 'HUMAN_APP' | 'HUMAN_EXTERNAL' | null;

function asMessageOutboundSource(value: unknown): MessageOutboundSource {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'AI_AGENT' || normalized === 'HUMAN_APP') {
    return normalized as MessageOutboundSource;
  }
  return null;
}

function resolveOutboundMessageMeta(input: {
  direction: 'inbound' | 'outbound' | 'system';
  channel: 'INSTAGRAM' | 'WHATSAPP';
  messageType: string;
  rawPayload: unknown;
  traceSource: unknown;
  traceUserId: number | null;
  traceUserEmail: string | null;
}): {
  outboundSource: MessageOutboundSource;
  outboundSourceLabel: string | null;
  outboundSenderUserId: number | null;
  outboundSenderEmail: string | null;
} {
  if (input.direction !== 'outbound') {
    return {
      outboundSource: null,
      outboundSourceLabel: null,
      outboundSenderUserId: null,
      outboundSenderEmail: null,
    };
  }

  const raw = asObject(input.rawPayload);
  const sentBy = asObject(raw.sentBy);
  const rawSource = asMessageOutboundSource(raw.source);
  const traceSource = asMessageOutboundSource(input.traceSource);
  const outboundSource: MessageOutboundSource = traceSource || rawSource || 'HUMAN_EXTERNAL';

  const senderUserId =
    outboundSource === 'HUMAN_APP'
      ? Number.isInteger(input.traceUserId)
        ? input.traceUserId
        : Number.isInteger(Number(sentBy.userId))
          ? Number(sentBy.userId)
          : null
      : null;
  const senderEmailRaw =
    outboundSource === 'HUMAN_APP'
      ? input.traceUserEmail || (typeof sentBy.email === 'string' ? sentBy.email.trim() : null)
      : null;
  const senderEmail = senderEmailRaw && senderEmailRaw.trim() ? senderEmailRaw.trim() : null;

  const outboundSourceLabel =
    outboundSource === 'AI_AGENT'
      ? 'AI Agent'
      : outboundSource === 'HUMAN_APP'
        ? senderEmail
          ? `App (${senderEmail})`
          : senderUserId
            ? `App (User #${senderUserId})`
            : 'App User'
        : input.channel === 'INSTAGRAM'
          ? 'Instagram Direct'
          : 'External';

  return {
    outboundSource,
    outboundSourceLabel,
    outboundSenderUserId: senderUserId,
    outboundSenderEmail: senderEmail,
  };
}

function extractInstagramActors(rawPayload: unknown): { senderId: string | null; recipientId: string | null; isEcho: boolean } {
  const raw = asObject(rawPayload);
  const entry = Array.isArray(raw.entry) ? asObject(raw.entry[0]) : {};
  const messaging = Array.isArray(entry.messaging) ? asObject(entry.messaging[0]) : {};
  const message = asObject(messaging.message);
  const sender = asObject(messaging.sender);
  const recipient = asObject(messaging.recipient);

  return {
    senderId: typeof sender.id === 'string' ? sender.id.trim() : null,
    recipientId: typeof recipient.id === 'string' ? recipient.id.trim() : null,
    isEcho: message.is_echo === true,
  };
}

function extractInstagramProfile(rawPayload: unknown): {
  name: string | null;
  username: string | null;
  profilePicUrl: string | null;
} {
  const raw = asObject(rawPayload);
  const profile = asObject(raw.instagramProfile);
  const fallback = asObject(raw.channelProfile);
  const source = Object.keys(profile).length ? profile : fallback;

  const asString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  return {
    name:
      asString(source.name) ||
      asString(raw.profileName) ||
      asString(raw.profile_name) ||
      asString(raw.customerName),
    username:
      asString(source.username) ||
      asString(raw.profileUsername) ||
      asString(raw.profile_username),
    profilePicUrl:
      asString(source.profile_pic) ||
      asString(source.profilePic) ||
      asString(source.profilePictureUrl) ||
      asString(raw.profilePictureUrl) ||
      asString(raw.profile_picture_url) ||
      asString(raw.profilePicUrl),
  };
}

function isEchoMessageType(messageType: string): boolean {
  return (messageType || '').trim().toLowerCase().startsWith('echo_');
}

function resolveInstagramConversationKeyFromRow(input: {
  conversationKey: string;
  messageType: string;
  externalAccountId?: string | null;
  rawPayload?: unknown;
  connectedAccountId?: string | null;
}): string {
  const normalizeId = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return normalizeInstagramIdentity(trimmed) || trimmed;
  };

  const fromKey = extractRawConversationKey('INSTAGRAM', input.conversationKey);
  const actors = extractInstagramActors(input.rawPayload);
  const echoByType = isEchoMessageType(input.messageType);
  const connected = normalizeId(input.connectedAccountId);
  const primaryActor = normalizeId(echoByType ? actors.recipientId : actors.senderId);
  const secondaryActor = normalizeId(echoByType ? actors.senderId : actors.recipientId);

  if (primaryActor && (!connected || primaryActor !== connected)) {
    return primaryActor;
  }
  if (secondaryActor && (!connected || secondaryActor !== connected)) {
    return secondaryActor;
  }

  // Legacy tolerance: old echo rows persisted with business key + customer in externalAccountId.
  if (echoByType) {
    const normalizedExt = normalizeId(input.externalAccountId);
    if (normalizedExt && (!connected || normalizedExt !== connected)) {
      return normalizedExt;
    }
  }

  const normalizedKey = normalizeId(fromKey);
  if (normalizedKey && (!connected || normalizedKey !== connected)) {
    return normalizedKey;
  }
  return primaryActor || secondaryActor || normalizedKey || fromKey;
}

async function resolveConnectedInstagramAccountIdForSalon(salonId: number): Promise<string | null> {
  const [settings, binding] = await Promise.all([
    prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: { faqAnswers: true },
    }),
    prisma.salonChannelBinding.findFirst({
      where: {
        salonId,
        channel: 'INSTAGRAM',
        isActive: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        externalAccountId: true,
      },
    }),
  ]);

  const fromSettings = (() => {
    const faq = asObject(settings?.faqAnswers);
    const meta = asObject(faq.metaDirect);
    const ig = asObject(meta.instagram);
    return typeof ig.externalAccountId === 'string' ? ig.externalAccountId.trim() : null;
  })();
  const fromBinding = typeof binding?.externalAccountId === 'string' ? binding.externalAccountId.trim() : null;
  return fromSettings || fromBinding || null;
}

type ConversationChannelHealth = {
  instagram: {
    connected: boolean;
    status: string;
    message: string;
    bindingReady: boolean;
    missingRequirements: string[];
  };
  whatsapp: {
    connected: boolean;
    isActive: boolean;
    hasPlugin: boolean;
    whatsappPhoneNumberId: string | null;
    message: string;
    missingRequirements: string[];
  };
};

async function buildConversationChannelHealth(salonId: number): Promise<ConversationChannelHealth> {
  const [settings, salon, bindings] = await Promise.all([
    prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: { faqAnswers: true },
    }),
    prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        chakraPluginId: true,
        chakraPhoneNumberId: true,
      },
    }),
    prisma.salonChannelBinding.findMany({
      where: {
        salonId,
        channel: {
          in: ['INSTAGRAM', 'WHATSAPP'],
        },
        isActive: true,
      },
      select: {
        channel: true,
        externalAccountId: true,
      },
    }),
  ]);

  const faq = asObject(settings?.faqAnswers);
  const meta = asObject(faq.metaDirect);
  const instagramMeta = asObject(meta.instagram);

  const instagramStatusRaw = typeof instagramMeta.status === 'string' ? instagramMeta.status.trim().toUpperCase() : 'NOT_CONNECTED';
  const instagramStatus = instagramStatusRaw || 'NOT_CONNECTED';
  const instagramConnected = instagramStatus === 'CONNECTED';
  const instagramMessage =
    typeof instagramMeta.message === 'string' && instagramMeta.message.trim()
      ? instagramMeta.message.trim()
      : instagramConnected
        ? 'Instagram connected.'
        : 'Instagram not connected.';
  const instagramBindings = bindings
    .filter((item) => item.channel === 'INSTAGRAM')
    .map((item) => (typeof item.externalAccountId === 'string' ? item.externalAccountId.trim() : ''))
    .filter(Boolean);
  const instagramHasToken =
    typeof instagramMeta.accessToken === 'string' && instagramMeta.accessToken.trim().length > 0;
  const instagramBindingReady = instagramBindings.length > 0 && instagramHasToken;
  const instagramMissingRequirements = [
    ...(instagramConnected ? [] : ['not_connected']),
    ...(instagramHasToken ? [] : ['missing_access_token']),
    ...(instagramBindings.length > 0 ? [] : ['missing_binding']),
  ];

  const hasPlugin = typeof salon?.chakraPluginId === 'string' && salon.chakraPluginId.trim().length > 0;
  const isActive = faq.whatsappPluginActive === true;
  const whatsappBindings = bindings
    .filter((item) => item.channel === 'WHATSAPP')
    .map((item) => (typeof item.externalAccountId === 'string' ? item.externalAccountId.trim() : ''))
    .filter(Boolean);
  const whatsappPhoneNumberId =
    (typeof salon?.chakraPhoneNumberId === 'string' && salon.chakraPhoneNumberId.trim()) ||
    (typeof faq.whatsappPhoneNumberId === 'string' && faq.whatsappPhoneNumberId.trim()) ||
    whatsappBindings[0] ||
    null;
  const whatsappConnected = Boolean(hasPlugin && (isActive || whatsappBindings.length > 0 || whatsappPhoneNumberId));
  const whatsappMessage = whatsappConnected
    ? 'WhatsApp connected.'
    : hasPlugin
      ? 'WhatsApp plugin exists but channel is not fully linked.'
      : 'WhatsApp not connected.';
  const whatsappMissingRequirements = [
    ...(hasPlugin ? [] : ['missing_plugin']),
    ...(isActive ? [] : ['plugin_inactive']),
    ...(whatsappPhoneNumberId || whatsappBindings.length > 0 ? [] : ['missing_phone_binding']),
  ];

  return {
    instagram: {
      connected: instagramConnected,
      status: instagramStatus,
      message: instagramMessage,
      bindingReady: instagramBindingReady,
      missingRequirements: instagramMissingRequirements,
    },
    whatsapp: {
      connected: whatsappConnected,
      isActive,
      hasPlugin,
      whatsappPhoneNumberId,
      message: whatsappMessage,
      missingRequirements: whatsappMissingRequirements,
    },
  };
}

router.get('/conversations', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const limit = asPositiveInt(req.query.limit, 40, 1, 100);
  const channelFilter = asInboundChannel(req.query.channel);
  const scanLimit = Math.max(limit * 60, 300);

  try {
    const [rows, channelHealth, connectedInstagramId] = await Promise.all([
      prisma.conversationMessageEvent.findMany({
        where: {
          salonId,
          channel: channelFilter || undefined,
        },
        orderBy: {
          eventTimestamp: 'desc',
        },
        take: scanLimit,
        select: {
          conversationKey: true,
          channel: true,
          externalAccountId: true,
          customerName: true,
          messageType: true,
          text: true,
          processingStatus: true,
          eventTimestamp: true,
          rawPayload: true,
        },
      }),
      buildConversationChannelHealth(salonId),
      resolveConnectedInstagramAccountIdForSalon(salonId),
    ]);

    const byConversation = new Map<
      string,
      {
        channel: 'INSTAGRAM' | 'WHATSAPP';
        conversationKey: string;
        customerName: string | null;
        profileUsername: string | null;
        profilePicUrl: string | null;
        lastMessageType: string;
        lastMessageText: string | null;
        lastEventTimestamp: Date;
        unreadCount: number;
        messageCount: number;
        hasHandoverRequest: boolean;
      }
    >();

    for (const row of rows) {
      const canonicalConversationKey =
        row.channel === 'INSTAGRAM'
          ? resolveInstagramConversationKeyFromRow({
              conversationKey: row.conversationKey,
              messageType: row.messageType,
              externalAccountId: row.externalAccountId,
              rawPayload: row.rawPayload,
              connectedAccountId: connectedInstagramId,
            })
          : extractRawConversationKey('WHATSAPP', row.conversationKey);
      const key = `${row.channel}:${canonicalConversationKey}`;
      const existing = byConversation.get(key);
      const unread = row.processingStatus !== 'DONE' ? 1 : 0;
      const isHandover = row.messageType === 'handover_request';
      const profile = row.channel === 'INSTAGRAM' ? extractInstagramProfile(row.rawPayload) : null;
      const profileName = row.customerName || profile?.name || null;

      if (!existing) {
        byConversation.set(key, {
          channel: row.channel as 'INSTAGRAM' | 'WHATSAPP',
          conversationKey: canonicalConversationKey,
          customerName: profileName,
          profileUsername: profile?.username || null,
          profilePicUrl: profile?.profilePicUrl || null,
          lastMessageType: row.messageType,
          lastMessageText: row.text || null,
          lastEventTimestamp: row.eventTimestamp,
          unreadCount: unread,
          messageCount: 1,
          hasHandoverRequest: isHandover,
        });
        continue;
      }

      existing.unreadCount += unread;
      existing.messageCount += 1;
      if (!existing.hasHandoverRequest && isHandover) {
        existing.hasHandoverRequest = true;
      }
      if (!existing.customerName && profileName) {
        existing.customerName = profileName;
      }
      if (!existing.profileUsername && profile?.username) {
        existing.profileUsername = profile.username;
      }
      if (!existing.profilePicUrl && profile?.profilePicUrl) {
        existing.profilePicUrl = profile.profilePicUrl;
      }
    }

    const baseItems = Array.from(byConversation.values())
      .sort((a, b) => b.lastEventTimestamp.getTime() - a.lastEventTimestamp.getTime())
      .slice(0, limit);

    const conversationStateRows = baseItems.length
      ? await prisma.conversationState.findMany({
          where: {
            salonId,
            OR: baseItems.map((item) => {
              const raw = extractRawConversationKey(item.channel, item.conversationKey);
              return {
                channel: item.channel,
                conversationKey: {
                  in: Array.from(new Set([item.conversationKey, raw, `${item.channel}:${raw}`])).filter(Boolean),
                },
              };
            }),
          },
          select: {
            channel: true,
            conversationKey: true,
            customerId: true,
            mode: true,
            manualAlways: true,
            humanPendingSince: true,
            humanActiveUntil: true,
            lastHumanMessageAt: true,
            lastCustomerMessageAt: true,
            updatedAt: true,
          },
        })
      : [];

    const stateByConversation = new Map<string, ConversationStateSnapshot>();
    for (const row of conversationStateRows) {
      stateByConversation.set(`${row.channel}:${row.conversationKey}`, {
        channel: row.channel as 'INSTAGRAM' | 'WHATSAPP',
        conversationKey: row.conversationKey,
        customerId: row.customerId || null,
        mode: row.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(row.manualAlways),
        humanPendingSince: row.humanPendingSince || null,
        humanActiveUntil: row.humanActiveUntil || null,
        lastHumanMessageAt: row.lastHumanMessageAt || null,
        lastCustomerMessageAt: row.lastCustomerMessageAt || null,
        updatedAt: row.updatedAt || null,
      });
    }

    const instagramSubjects = Array.from(
      new Set(
        baseItems
          .filter((item) => item.channel === 'INSTAGRAM')
          .map((item) => normalizeInstagramIdentity(extractRawConversationKey('INSTAGRAM', item.conversationKey)))
          .filter((value) => value.length > 0),
      ),
    );

    const instagramProfileCacheRows = instagramSubjects.length
      ? await prisma.channelProfileCache.findMany({
          where: {
            salonId,
            channel: 'INSTAGRAM',
            subjectNormalized: {
              in: instagramSubjects,
            },
          },
          select: {
            subjectNormalized: true,
            profileName: true,
            profileUsername: true,
            profilePicUrl: true,
          },
        })
      : [];

    const instagramProfileBySubject = new Map<
      string,
      {
        profileName: string | null;
        profileUsername: string | null;
        profilePicUrl: string | null;
      }
    >();
    for (const row of instagramProfileCacheRows) {
      instagramProfileBySubject.set(row.subjectNormalized, {
        profileName: row.profileName || null,
        profileUsername: row.profileUsername || null,
        profilePicUrl: row.profilePicUrl || null,
      });
    }

    const identityNeedles = baseItems
      .map((item) => {
        const raw = extractRawConversationKey(item.channel, item.conversationKey);
        const normalized = item.channel === 'WHATSAPP'
          ? normalizePhoneDigits(raw)
          : normalizeInstagramIdentity(raw);
        return {
          channel: item.channel,
          normalized,
        };
      })
      .filter((item) => item.normalized.length > 0);

    const identityRows = identityNeedles.length
      ? await prisma.identityBinding.findMany({
          where: {
            salonId,
            OR: identityNeedles.map((item) => ({
              channel: item.channel,
              subjectNormalized: item.normalized,
            })),
          },
          select: {
            channel: true,
            subjectNormalized: true,
            customerId: true,
          },
        })
      : [];

    const bindingCustomerByIdentity = new Map<string, number>();
    for (const row of identityRows) {
      bindingCustomerByIdentity.set(`${row.channel}:${row.subjectNormalized}`, row.customerId);
    }

    const itemsWithLink = baseItems.map((item) => {
      const raw = extractRawConversationKey(item.channel, item.conversationKey);
      const normalized = item.channel === 'WHATSAPP'
        ? normalizePhoneDigits(raw)
        : normalizeInstagramIdentity(raw);

      const conversationCandidates = Array.from(new Set([item.conversationKey, raw, `${item.channel}:${raw}`])).filter(Boolean);
      const stateMatches = conversationCandidates
        .map((key) => stateByConversation.get(`${item.channel}:${key}`) || null)
        .filter((row): row is ConversationStateSnapshot => Boolean(row));
      const stateRow = pickLatestState(stateMatches);
      const linkedFromState = stateRow?.customerId || null;
      const linkedFromBinding = normalized
        ? bindingCustomerByIdentity.get(`${item.channel}:${normalized}`) || null
        : null;
      const linkedCustomerId = linkedFromState || linkedFromBinding || null;

      return {
        ...item,
        linkedCustomerId,
        stateRow,
      };
    });

    const linkedCustomerIds = Array.from(
      new Set(
        itemsWithLink
          .map((item) => item.linkedCustomerId)
          .filter((value): value is number => typeof value === 'number' && value > 0),
      ),
    );

    const linkedCustomers = linkedCustomerIds.length
      ? await prisma.customer.findMany({
          where: {
            salonId,
            id: {
              in: linkedCustomerIds,
            },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];

    const linkedCustomerNameById = new Map<number, string>();
    for (const customer of linkedCustomers) {
      if (typeof customer.name === 'string' && customer.name.trim()) {
        linkedCustomerNameById.set(customer.id, customer.name.trim());
      }
    }

    const items = itemsWithLink.map((item) => {
      const { stateRow, ...baseItem } = item;
      const normalizedInstagramSubject =
        baseItem.channel === 'INSTAGRAM'
          ? normalizeInstagramIdentity(extractRawConversationKey('INSTAGRAM', baseItem.conversationKey))
          : '';
      const cachedInstagramProfile =
        normalizedInstagramSubject && instagramProfileBySubject.has(normalizedInstagramSubject)
          ? instagramProfileBySubject.get(normalizedInstagramSubject) || null
          : null;
      const linkedCustomerName =
        baseItem.linkedCustomerId && linkedCustomerNameById.has(baseItem.linkedCustomerId)
          ? linkedCustomerNameById.get(baseItem.linkedCustomerId) || null
          : null;

      return {
        ...baseItem,
        customerName: linkedCustomerName || baseItem.customerName || cachedInstagramProfile?.profileName || null,
        profileUsername: baseItem.profileUsername || cachedInstagramProfile?.profileUsername || null,
        profilePicUrl: baseItem.profilePicUrl || cachedInstagramProfile?.profilePicUrl || null,
        linkedCustomerName,
        identityLinked: Boolean(baseItem.linkedCustomerId),
        ...serializeConversationState(stateRow),
        lastEventTimestamp: baseItem.lastEventTimestamp.toISOString(),
      };
    });

    return res.status(200).json({
      items,
      hasMore: byConversation.size > limit,
      channelHealth,
    });
  } catch (error) {
    console.error('Admin conversations error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/conversations/:channel/:conversationKey/messages', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const channel = asInboundChannel(req.params.channel);
  if (!channel) {
    return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  const limit = asPositiveInt(req.query.limit, 80, 1, 200);

  try {
    const keyCandidates = conversationKeyCandidates(channel, conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey(channel, key))));
    const connectedInstagramId =
      channel === 'INSTAGRAM'
        ? normalizeInstagramIdentity((await resolveConnectedInstagramAccountIdForSalon(salonId)) || '')
        : '';
    const rawKeyCandidatesForLegacyEcho =
      channel === 'INSTAGRAM' && connectedInstagramId
        ? rawKeyCandidates.filter((key) => normalizeInstagramIdentity(key) !== connectedInstagramId)
        : rawKeyCandidates;
    const instagramOrClauses: any[] = [
      {
        conversationKey: {
          in: keyCandidates,
        },
      },
    ];
    if (rawKeyCandidatesForLegacyEcho.length > 0) {
      instagramOrClauses.push({
        messageType: {
          startsWith: 'echo_',
        },
        externalAccountId: {
          in: rawKeyCandidatesForLegacyEcho,
        },
      });
    }
    const where: any =
      channel === 'INSTAGRAM'
        ? {
            salonId,
            channel,
            OR: instagramOrClauses,
          }
        : {
            salonId,
            channel,
            conversationKey: {
              in: keyCandidates,
            },
          };

    const rows = await prisma.conversationMessageEvent.findMany({
      where,
      orderBy: {
        eventTimestamp: 'asc',
      },
      take: limit,
      select: {
        id: true,
        providerMessageId: true,
        customerName: true,
        messageType: true,
        text: true,
        direction: true,
        processingStatus: true,
        outboundSource: true,
        outboundSenderUserId: true,
        outboundSenderEmail: true,
        eventTimestamp: true,
        rawPayload: true,
      },
    });
    const stateRows = await prisma.conversationState.findMany({
      where: {
        salonId,
        channel,
        conversationKey: {
          in: keyCandidates,
        },
      },
      select: {
        channel: true,
        conversationKey: true,
        customerId: true,
        mode: true,
        manualAlways: true,
        humanPendingSince: true,
        humanActiveUntil: true,
        lastHumanMessageAt: true,
        lastCustomerMessageAt: true,
        updatedAt: true,
      },
    });
    const stateRow = pickLatestState(
      stateRows.map((row) => ({
        channel: row.channel as 'INSTAGRAM' | 'WHATSAPP',
        conversationKey: row.conversationKey,
        customerId: row.customerId || null,
        mode: row.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(row.manualAlways),
        humanPendingSince: row.humanPendingSince || null,
        humanActiveUntil: row.humanActiveUntil || null,
        lastHumanMessageAt: row.lastHumanMessageAt || null,
        lastCustomerMessageAt: row.lastCustomerMessageAt || null,
        updatedAt: row.updatedAt || null,
      })),
    );

    const items = rows.map((row) => {
      const raw = asObject(row.rawPayload);
      const direction = resolveStoredEventDirection(row.direction, row.messageType);
      const outboundMeta = resolveOutboundMessageMeta({
        direction,
        channel,
        messageType: row.messageType,
        rawPayload: row.rawPayload,
        traceSource: row.outboundSource || null,
        traceUserId: row.outboundSenderUserId || null,
        traceUserEmail: row.outboundSenderEmail || null,
      });

      return {
        id: row.id,
        providerMessageId: row.providerMessageId,
        customerName: row.customerName,
        messageType: row.messageType,
        text: row.text,
        status: row.processingStatus || 'DONE',
        direction,
        deliveryChannel: channel,
        outboundSource: outboundMeta.outboundSource,
        outboundSourceLabel: outboundMeta.outboundSourceLabel,
        outboundSenderUserId: outboundMeta.outboundSenderUserId,
        outboundSenderEmail: outboundMeta.outboundSenderEmail,
        eventTimestamp: row.eventTimestamp.toISOString(),
        raw,
      };
    });

    return res.status(200).json({
      items,
      conversationState: serializeConversationState(stateRow),
    });
  } catch (error) {
    console.error('Admin conversation messages error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/conversations/:channel/:conversationKey/reply', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const channel = asInboundChannel(req.params.channel);
  if (!channel) {
    return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
  }

  if (channel !== 'INSTAGRAM' && channel !== 'WHATSAPP') {
    return res.status(400).json({ message: 'Manual reply is currently enabled only for Instagram and WhatsApp.' });
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ message: 'text is required.' });
  }

  try {
    const keyCandidates = conversationKeyCandidates(channel, conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey(channel, key))));
    const latestInboundWhere: any = {
      salonId,
      channel,
      OR: [
        {
          conversationKey: {
            in: keyCandidates,
          },
        },
        {
          messageType: {
            startsWith: 'echo_',
          },
          externalAccountId: {
            in: rawKeyCandidates,
          },
        },
      ],
    };

    const latestInbound = await prisma.conversationMessageEvent.findFirst({
      where: latestInboundWhere,
      orderBy: {
        eventTimestamp: 'desc',
      },
      select: {
        conversationKey: true,
        externalAccountId: true,
        customerName: true,
        messageType: true,
        rawPayload: true,
      },
    });

    if (!latestInbound) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const resolvedConversationKey = latestInbound.conversationKey || conversationKey;
    const senderUserId = Number.isInteger(Number(req.user?.userId)) ? Number(req.user.userId) : null;
    const senderUser = senderUserId
      ? await prisma.salonUser.findFirst({
          where: {
            id: senderUserId,
            salonId,
          },
          select: {
            id: true,
            email: true,
          },
        })
      : null;
    const senderUserEmail =
      typeof senderUser?.email === 'string' && senderUser.email.trim() ? senderUser.email.trim() : null;

    const settings = await prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: { faqAnswers: true },
    });

    const faqAnswers = asObject(settings?.faqAnswers);
    const metaDirect = asObject(faqAnswers.metaDirect);
    const instagram = asObject(metaDirect.instagram);
    const accessToken = typeof instagram.accessToken === 'string' ? instagram.accessToken.trim() : '';
    const configuredInstagramId = typeof instagram.externalAccountId === 'string' ? instagram.externalAccountId.trim() : '';
    let senderInstagramId = configuredInstagramId;

    const actors = extractInstagramActors(latestInbound.rawPayload);
    const echoByType = isEchoMessageType(latestInbound.messageType || '');
    const normalizeId = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      return normalizeInstagramIdentity(trimmed) || trimmed;
    };
    const configuredNormalized = normalizeId(configuredInstagramId);
    const requestedRaw = extractRawConversationKey(channel, conversationKey);
    const requestedRecipient = normalizeId(requestedRaw);
    const keyRaw = extractRawConversationKey(channel, resolvedConversationKey);
    const actorRecipient = normalizeId(echoByType ? actors.recipientId : actors.senderId);
    const actorCounterpart = normalizeId(echoByType ? actors.senderId : actors.recipientId);
    const legacyExternal = normalizeId(latestInbound.externalAccountId);
    const keyRecipient = normalizeId(keyRaw);
    let rawRecipientId =
      [requestedRecipient, actorRecipient, actorCounterpart, legacyExternal, keyRecipient].find(
        (candidate) => candidate && (!configuredNormalized || candidate !== configuredNormalized),
      ) || '';

    if (!rawRecipientId) {
      return res.status(400).json({ message: 'Conversation recipient could not be resolved.' });
    }

    if (!senderInstagramId) {
      senderInstagramId = actorCounterpart || keyRecipient || '';
    }
    if ((!senderInstagramId || normalizeId(senderInstagramId) === rawRecipientId) && legacyExternal && legacyExternal !== rawRecipientId) {
      senderInstagramId = legacyExternal;
    }

    if (channel === "INSTAGRAM" && (!accessToken || !senderInstagramId)) {
      return res.status(400).json({ message: 'Instagram is not connected yet.' });
    }

    const canonicalConversationKey = `${channel}:${rawRecipientId}`;

    let graphMessageId = '';
    let usedExternalAccountId = '';

    if (channel === 'INSTAGRAM') {
      const url = `https://graph.instagram.com/${META_GRAPH_VERSION}/${senderInstagramId}/messages`;
      const graphResponse = await axios.post(
        url,
        {
          recipient: { id: rawRecipientId },
          message: { text },
        },
        {
          params: { access_token: accessToken },
          timeout: 20000,
        },
      );

      graphMessageId =
        (typeof graphResponse.data?.message_id === 'string' && graphResponse.data.message_id.trim()) ||
        `ig_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      usedExternalAccountId = senderInstagramId;
    } else if (channel === 'WHATSAPP') {
      const salon = await prisma.salon.findUnique({
        where: { id: salonId },
        select: { id: true, chakraPluginId: true, chakraPhoneNumberId: true },
      });

      const pluginId = salon?.chakraPluginId;
      const phoneId = salon?.chakraPhoneNumberId;
      const token = process.env.CHAKRA_API_TOKEN;

      if (!pluginId || !phoneId || !token) {
        return res.status(400).json({ message: 'WhatsApp is not properly connected (missing Chakra configuration).' });
      }

      const cleanTo = rawRecipientId.replace(/\D/g, '');
      const url = `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${pluginId}/api/v19.0/${phoneId}/messages`;
      
      const whatsappResponse = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
          type: 'text',
          text: { body: text },
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20000,
        },
      );

      const messages = whatsappResponse.data?.messages || whatsappResponse.data?._data?.messages;
      graphMessageId =
        (Array.isArray(messages) && messages[0]?.id) ||
        `wa_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      usedExternalAccountId = phoneId;
    }

    const saved = await prisma.inboundMessageQueue.create({
      data: {
        salonId,
        channel,
        conversationKey: canonicalConversationKey,
        providerMessageId: graphMessageId,
        externalAccountId: usedExternalAccountId,
        customerName: latestInbound.customerName || null,
        messageType: 'text_outbound',
        text,
        eventTimestamp: new Date(),
        rawPayload: {
          direction: 'outbound',
          source: 'HUMAN_APP',
          sentBy: {
            userId: senderUser?.id || null,
            email: senderUserEmail,
          },
        } as any,
        status: 'DONE',
        processedAt: new Date(),
      },
    });

    await prisma.outboundMessageTrace.upsert({
      where: {
        channel_providerMessageId: {
          channel,
          providerMessageId: graphMessageId,
        },
      },
      update: {
        salonId,
        conversationKey: canonicalConversationKey,
        source: 'HUMAN_APP',
        externalAccountId: usedExternalAccountId,
        text,
        sourceUserId: senderUser?.id || null,
        sourceUserEmail: senderUserEmail,
        sentAt: new Date(),
      },
      create: {
        salonId,
        channel,
        conversationKey: canonicalConversationKey,
        providerMessageId: graphMessageId,
        source: 'HUMAN_APP',
        externalAccountId: usedExternalAccountId,
        text,
        sourceUserId: senderUser?.id || null,
        sourceUserEmail: senderUserEmail,
        sentAt: new Date(),
      },
    });

    await upsertConversationMessageEvent({
      salonId,
      channel,
      conversationKey: canonicalConversationKey,
      providerMessageId: graphMessageId,
      externalAccountId: usedExternalAccountId,
      customerName: latestInbound.customerName || null,
      messageType: 'text_outbound',
      text,
      direction: 'OUTBOUND',
      eventTimestamp: saved.eventTimestamp,
      processingStatus: InboundMessageStatus.DONE,
      outboundSource: OutboundMessageSource.HUMAN_APP,
      outboundSenderUserId: senderUser?.id || null,
      outboundSenderEmail: senderUserEmail,
      rawPayload: {
        direction: 'outbound',
        source: 'HUMAN_APP',
        sentBy: {
          userId: senderUser?.id || null,
          email: senderUserEmail,
        },
      } as any,
    });

    await markConversationHumanActive({
      salonId,
      channel,
      conversationKey: canonicalConversationKey,
      profileName: latestInbound.customerName || null,
    });

    await resolveHandoverAlert({
      salonId,
      channel,
      conversationKey: canonicalConversationKey,
      byHumanMessage: true,
    });
    });

    return res.status(200).json({
      item: {
        id: saved.id,
        providerMessageId: saved.providerMessageId,
        messageType: saved.messageType,
        text: saved.text,
        status: saved.status,
        direction: 'outbound',
        eventTimestamp: saved.eventTimestamp.toISOString(),
      },
    });
  } catch (error: any) {
    const fbMessage =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'Failed to send message.';
    console.error('Admin conversations reply error:', error?.response?.data || error);
    return res.status(502).json({ message: String(fbMessage) });
  }
});

router.post('/conversations/:channel/:conversationKey/handover', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const channel = asInboundChannel(req.params.channel);
  if (!channel) {
    return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

  try {
    const keyCandidates = conversationKeyCandidates(channel, conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey(channel, key))));
    const latestInboundWhere: any =
      channel === 'INSTAGRAM'
        ? {
            salonId,
            channel,
            OR: [
              {
                conversationKey: {
                  in: keyCandidates,
                },
              },
              {
                messageType: {
                  startsWith: 'echo_',
                },
                externalAccountId: {
                  in: rawKeyCandidates,
                },
              },
            ],
          }
        : {
            salonId,
            channel,
            conversationKey: {
              in: keyCandidates,
            },
          };

    const latestInbound = await prisma.conversationMessageEvent.findFirst({
      where: latestInboundWhere,
      orderBy: {
        eventTimestamp: 'desc',
      },
      select: {
        conversationKey: true,
        externalAccountId: true,
        customerName: true,
      },
    });

    if (!latestInbound) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const resolvedConversationKey = latestInbound.conversationKey || conversationKey;
    const stateCandidates = Array.from(
      new Set([...keyCandidates, ...conversationKeyCandidates(channel, resolvedConversationKey)]),
    );
    const existingStateRows = await prisma.conversationState.findMany({
      where: {
        salonId,
        channel,
        conversationKey: {
          in: stateCandidates,
        },
      },
      select: {
        channel: true,
        conversationKey: true,
        customerId: true,
        mode: true,
        manualAlways: true,
        humanPendingSince: true,
        humanActiveUntil: true,
        lastHumanMessageAt: true,
        lastCustomerMessageAt: true,
        updatedAt: true,
      },
    });
    const existingState = pickLatestState(
      existingStateRows.map((row) => ({
        channel: row.channel as 'INSTAGRAM' | 'WHATSAPP',
        conversationKey: row.conversationKey,
        customerId: row.customerId || null,
        mode: row.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(row.manualAlways),
        humanPendingSince: row.humanPendingSince || null,
        humanActiveUntil: row.humanActiveUntil || null,
        lastHumanMessageAt: row.lastHumanMessageAt || null,
        lastCustomerMessageAt: row.lastCustomerMessageAt || null,
        updatedAt: row.updatedAt || null,
      })),
    );
    if (existingState && isHandoverMode(existingState.mode)) {
      return res.status(200).json({
        ok: true,
        alreadyRequested: true,
        state: serializeConversationState(existingState),
      });
    }

    const saved = await prisma.inboundMessageQueue.create({
      data: {
        salonId,
        channel,
        conversationKey: resolvedConversationKey,
        providerMessageId: `handover_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        externalAccountId: latestInbound.externalAccountId,
        customerName: latestInbound.customerName || null,
        messageType: 'handover_request',
        text: note || 'Human handover requested.',
        eventTimestamp: new Date(),
        rawPayload: {
          direction: 'system',
          handoverRequested: true,
        } as any,
        status: 'DONE',
        processedAt: new Date(),
      },
    });

    await upsertConversationMessageEvent({
      salonId,
      channel,
      conversationKey: resolvedConversationKey,
      providerMessageId: saved.providerMessageId,
      externalAccountId: latestInbound.externalAccountId,
      customerName: latestInbound.customerName || null,
      messageType: 'handover_request',
      text: note || 'Human handover requested.',
      direction: 'SYSTEM',
      eventTimestamp: saved.eventTimestamp,
      processingStatus: InboundMessageStatus.DONE,
      rawPayload: {
        direction: 'system',
        handoverRequested: true,
      } as any,
    });

    const updatedState = await markConversationHumanPending({
      salonId,
      channel,
      conversationKey: resolvedConversationKey,
      note: note || 'Human handover requested.',
      profileName: latestInbound.customerName || null,
    });
    await markHandoverTriggered({
      salonId,
      channel,
      conversationKey: resolvedConversationKey,
      customerName: latestInbound.customerName || null,
    });

    return res.status(200).json({
      ok: true,
      alreadyRequested: false,
      item: {
        id: saved.id,
        providerMessageId: saved.providerMessageId,
        messageType: saved.messageType,
        text: saved.text,
        status: saved.status,
        direction: 'system',
        eventTimestamp: saved.eventTimestamp.toISOString(),
      },
      state: serializeConversationState({
        channel,
        conversationKey: updatedState.conversationKey,
        customerId: updatedState.customerId || null,
        mode: updatedState.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(updatedState.manualAlways),
        humanPendingSince: updatedState.humanPendingSince || null,
        humanActiveUntil: updatedState.humanActiveUntil || null,
        lastHumanMessageAt: updatedState.lastHumanMessageAt || null,
        lastCustomerMessageAt: updatedState.lastCustomerMessageAt || null,
        updatedAt: updatedState.updatedAt || null,
      }),
    });
  } catch (error) {
    console.error('Admin conversations handover error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/conversations/:channel/:conversationKey/resume-auto', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const channel = asInboundChannel(req.params.channel);
  if (!channel) {
    return res.status(400).json({ message: 'channel must be INSTAGRAM or WHATSAPP.' });
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  try {
    const keyCandidates = conversationKeyCandidates(channel, conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey(channel, key))));
    const latestInboundWhere: any =
      channel === 'INSTAGRAM'
        ? {
            salonId,
            channel,
            OR: [
              {
                conversationKey: {
                  in: keyCandidates,
                },
              },
              {
                messageType: {
                  startsWith: 'echo_',
                },
                externalAccountId: {
                  in: rawKeyCandidates,
                },
              },
            ],
          }
        : {
            salonId,
            channel,
            conversationKey: {
              in: keyCandidates,
            },
          };

    const latestInbound = await prisma.conversationMessageEvent.findFirst({
      where: latestInboundWhere,
      orderBy: {
        eventTimestamp: 'desc',
      },
      select: {
        conversationKey: true,
        customerName: true,
      },
    });

    if (!latestInbound) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const resolvedConversationKey = latestInbound.conversationKey || conversationKey;

    const updatedState = await markConversationAuto({
      salonId,
      channel,
      conversationKey: resolvedConversationKey,
      note: 'manual_resumed_by_salon',
      profileName: latestInbound.customerName || null,
    });
    await resolveHandoverAlert({
      salonId,
      channel,
      conversationKey: resolvedConversationKey,
    });

    return res.status(200).json({
      ok: true,
      state: serializeConversationState({
        channel,
        conversationKey: updatedState.conversationKey,
        customerId: updatedState.customerId || null,
        mode: updatedState.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(updatedState.manualAlways),
        humanPendingSince: updatedState.humanPendingSince || null,
        humanActiveUntil: updatedState.humanActiveUntil || null,
        lastHumanMessageAt: updatedState.lastHumanMessageAt || null,
        lastCustomerMessageAt: updatedState.lastCustomerMessageAt || null,
        updatedAt: updatedState.updatedAt || null,
      }),
    });
  } catch (error) {
    console.error('Admin conversations resume-auto error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/instagram-inbox/conversations', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const limit = asPositiveInt(req.query.limit, 20, 1, 100);
  const scanLimit = Math.max(limit * 40, 200);

  try {
    const rows = await prisma.conversationMessageEvent.findMany({
      where: {
        salonId,
        channel: 'INSTAGRAM',
      },
      orderBy: {
        eventTimestamp: 'desc',
      },
      take: scanLimit,
      select: {
        id: true,
        conversationKey: true,
        externalAccountId: true,
        customerName: true,
        messageType: true,
        text: true,
        processingStatus: true,
        eventTimestamp: true,
        rawPayload: true,
      },
    });
    const connectedInstagramId = await resolveConnectedInstagramAccountIdForSalon(salonId);

    const byConversation = new Map<
      string,
      {
        conversationKey: string;
        customerName: string | null;
        profileUsername: string | null;
        profilePicUrl: string | null;
        lastMessageType: string;
        lastMessageText: string | null;
        lastEventTimestamp: Date;
        unreadCount: number;
        messageCount: number;
        hasHandoverRequest: boolean;
      }
    >();

    for (const row of rows) {
      const key = resolveInstagramConversationKeyFromRow({
        conversationKey: row.conversationKey,
        messageType: row.messageType,
        externalAccountId: row.externalAccountId,
        rawPayload: row.rawPayload,
        connectedAccountId: connectedInstagramId,
      });
      const existing = byConversation.get(key);
      const unread = row.processingStatus !== 'DONE' ? 1 : 0;
      const isHandover = row.messageType === 'handover_request';
      const profile = extractInstagramProfile(row.rawPayload);
      const profileName = row.customerName || profile.name || null;

      if (!existing) {
        byConversation.set(key, {
          conversationKey: key,
          customerName: profileName,
          profileUsername: profile.username || null,
          profilePicUrl: profile.profilePicUrl || null,
          lastMessageType: row.messageType,
          lastMessageText: row.text || null,
          lastEventTimestamp: row.eventTimestamp,
          unreadCount: unread,
          messageCount: 1,
          hasHandoverRequest: isHandover,
        });
        continue;
      }

      existing.unreadCount += unread;
      existing.messageCount += 1;
      if (!existing.hasHandoverRequest && isHandover) {
        existing.hasHandoverRequest = true;
      }
      if (!existing.customerName && profileName) {
        existing.customerName = profileName;
      }
      if (!existing.profileUsername && profile.username) {
        existing.profileUsername = profile.username;
      }
      if (!existing.profilePicUrl && profile.profilePicUrl) {
        existing.profilePicUrl = profile.profilePicUrl;
      }
    }

    const baseItems = Array.from(byConversation.values())
      .sort((a, b) => b.lastEventTimestamp.getTime() - a.lastEventTimestamp.getTime())
      .slice(0, limit);

    const conversationStateRows = baseItems.length
      ? await prisma.conversationState.findMany({
          where: {
            salonId,
            channel: 'INSTAGRAM',
            OR: baseItems.map((item) => {
              const raw = extractRawConversationKey('INSTAGRAM', item.conversationKey);
              return {
                conversationKey: {
                  in: Array.from(new Set([item.conversationKey, raw, `INSTAGRAM:${raw}`])).filter(Boolean),
                },
              };
            }),
          },
          select: {
            conversationKey: true,
            customerId: true,
            mode: true,
            manualAlways: true,
            humanPendingSince: true,
            humanActiveUntil: true,
            lastHumanMessageAt: true,
            lastCustomerMessageAt: true,
            updatedAt: true,
          },
        })
      : [];

    const stateByConversation = new Map<string, ConversationStateSnapshot>();
    for (const row of conversationStateRows) {
      stateByConversation.set(row.conversationKey, {
        channel: 'INSTAGRAM',
        conversationKey: row.conversationKey,
        customerId: row.customerId || null,
        mode: row.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(row.manualAlways),
        humanPendingSince: row.humanPendingSince || null,
        humanActiveUntil: row.humanActiveUntil || null,
        lastHumanMessageAt: row.lastHumanMessageAt || null,
        lastCustomerMessageAt: row.lastCustomerMessageAt || null,
        updatedAt: row.updatedAt || null,
      });
    }

    const instagramSubjects = Array.from(
      new Set(
        baseItems
          .map((item) => normalizeInstagramIdentity(extractRawConversationKey('INSTAGRAM', item.conversationKey)))
          .filter((value) => value.length > 0),
      ),
    );

    const instagramProfileCacheRows = instagramSubjects.length
      ? await prisma.channelProfileCache.findMany({
          where: {
            salonId,
            channel: 'INSTAGRAM',
            subjectNormalized: {
              in: instagramSubjects,
            },
          },
          select: {
            subjectNormalized: true,
            profileName: true,
            profileUsername: true,
            profilePicUrl: true,
          },
        })
      : [];

    const instagramProfileBySubject = new Map<
      string,
      {
        profileName: string | null;
        profileUsername: string | null;
        profilePicUrl: string | null;
      }
    >();
    for (const row of instagramProfileCacheRows) {
      instagramProfileBySubject.set(row.subjectNormalized, {
        profileName: row.profileName || null,
        profileUsername: row.profileUsername || null,
        profilePicUrl: row.profilePicUrl || null,
      });
    }

    const identityNeedles = baseItems
      .map((item) => normalizeInstagramIdentity(extractRawConversationKey('INSTAGRAM', item.conversationKey)))
      .filter((value) => value.length > 0);

    const identityRows = identityNeedles.length
      ? await prisma.identityBinding.findMany({
          where: {
            salonId,
            channel: 'INSTAGRAM',
            subjectNormalized: { in: identityNeedles },
          },
          select: {
            subjectNormalized: true,
            customerId: true,
          },
        })
      : [];

    const bindingCustomerByIdentity = new Map<string, number>();
    for (const row of identityRows) {
      bindingCustomerByIdentity.set(row.subjectNormalized, row.customerId);
    }

    const itemsWithLink = baseItems.map((item) => {
      const raw = extractRawConversationKey('INSTAGRAM', item.conversationKey);
      const normalized = normalizeInstagramIdentity(raw);
      const conversationCandidates = Array.from(new Set([item.conversationKey, raw, `INSTAGRAM:${raw}`])).filter(Boolean);
      const stateMatches = conversationCandidates
        .map((key) => stateByConversation.get(key) || null)
        .filter((row): row is ConversationStateSnapshot => Boolean(row));
      const stateRow = pickLatestState(stateMatches);
      const linkedFromState = stateRow?.customerId || null;
      const linkedFromBinding = normalized ? bindingCustomerByIdentity.get(normalized) || null : null;
      const linkedCustomerId = linkedFromState || linkedFromBinding || null;

      return {
        ...item,
        linkedCustomerId,
        stateRow,
      };
    });

    const linkedCustomerIds = Array.from(
      new Set(
        itemsWithLink
          .map((item) => item.linkedCustomerId)
          .filter((value): value is number => typeof value === 'number' && value > 0),
      ),
    );

    const linkedCustomers = linkedCustomerIds.length
      ? await prisma.customer.findMany({
          where: {
            salonId,
            id: { in: linkedCustomerIds },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];

    const linkedCustomerNameById = new Map<number, string>();
    for (const customer of linkedCustomers) {
      if (typeof customer.name === 'string' && customer.name.trim()) {
        linkedCustomerNameById.set(customer.id, customer.name.trim());
      }
    }

    const items = itemsWithLink.map((item) => {
      const { stateRow, ...baseItem } = item;
      const normalizedInstagramSubject = normalizeInstagramIdentity(
        extractRawConversationKey('INSTAGRAM', baseItem.conversationKey),
      );
      const cachedInstagramProfile =
        normalizedInstagramSubject && instagramProfileBySubject.has(normalizedInstagramSubject)
          ? instagramProfileBySubject.get(normalizedInstagramSubject) || null
          : null;
      const linkedCustomerName =
        baseItem.linkedCustomerId && linkedCustomerNameById.has(baseItem.linkedCustomerId)
          ? linkedCustomerNameById.get(baseItem.linkedCustomerId) || null
          : null;

      return {
        ...baseItem,
        customerName: linkedCustomerName || baseItem.customerName || cachedInstagramProfile?.profileName || null,
        profileUsername: baseItem.profileUsername || cachedInstagramProfile?.profileUsername || null,
        profilePicUrl: baseItem.profilePicUrl || cachedInstagramProfile?.profilePicUrl || null,
        linkedCustomerName,
        identityLinked: Boolean(baseItem.linkedCustomerId),
        ...serializeConversationState(stateRow),
        lastEventTimestamp: baseItem.lastEventTimestamp.toISOString(),
      };
    });

    return res.status(200).json({
      items,
      hasMore: byConversation.size > limit,
    });
  } catch (error) {
    console.error('Admin instagram inbox conversations error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/instagram-inbox/conversations/:conversationKey/messages', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  const limit = asPositiveInt(req.query.limit, 80, 1, 200);

  try {
    const keyCandidates = conversationKeyCandidates('INSTAGRAM', conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey('INSTAGRAM', key))));
    const connectedInstagramId = normalizeInstagramIdentity((await resolveConnectedInstagramAccountIdForSalon(salonId)) || '');
    const rawKeyCandidatesForLegacyEcho = connectedInstagramId
      ? rawKeyCandidates.filter((key) => normalizeInstagramIdentity(key) !== connectedInstagramId)
      : rawKeyCandidates;
    const instagramOrClauses: any[] = [
      {
        conversationKey: {
          in: keyCandidates,
        },
      },
    ];
    if (rawKeyCandidatesForLegacyEcho.length > 0) {
      instagramOrClauses.push({
        messageType: {
          startsWith: 'echo_',
        },
        externalAccountId: {
          in: rawKeyCandidatesForLegacyEcho,
        },
      });
    }
    const where: any = {
      salonId,
      channel: 'INSTAGRAM',
      OR: instagramOrClauses,
    };

    const rows = await prisma.conversationMessageEvent.findMany({
      where,
      orderBy: {
        eventTimestamp: 'asc',
      },
      take: limit,
      select: {
        id: true,
        providerMessageId: true,
        customerName: true,
        messageType: true,
        text: true,
        direction: true,
        processingStatus: true,
        outboundSource: true,
        outboundSenderUserId: true,
        outboundSenderEmail: true,
        eventTimestamp: true,
        rawPayload: true,
      },
    });
    const stateRows = await prisma.conversationState.findMany({
      where: {
        salonId,
        channel: 'INSTAGRAM',
        conversationKey: {
          in: keyCandidates,
        },
      },
      select: {
        channel: true,
        conversationKey: true,
        customerId: true,
        mode: true,
        manualAlways: true,
        humanPendingSince: true,
        humanActiveUntil: true,
        lastHumanMessageAt: true,
        lastCustomerMessageAt: true,
        updatedAt: true,
      },
    });
    const stateRow = pickLatestState(
      stateRows.map((row) => ({
        channel: row.channel as 'INSTAGRAM' | 'WHATSAPP',
        conversationKey: row.conversationKey,
        customerId: row.customerId || null,
        mode: row.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(row.manualAlways),
        humanPendingSince: row.humanPendingSince || null,
        humanActiveUntil: row.humanActiveUntil || null,
        lastHumanMessageAt: row.lastHumanMessageAt || null,
        lastCustomerMessageAt: row.lastCustomerMessageAt || null,
        updatedAt: row.updatedAt || null,
      })),
    );

    const items = rows.map((row) => {
      const raw = asObject(row.rawPayload);
      const direction = resolveStoredEventDirection(row.direction, row.messageType);
      const outboundMeta = resolveOutboundMessageMeta({
        direction,
        channel: 'INSTAGRAM',
        messageType: row.messageType,
        rawPayload: row.rawPayload,
        traceSource: row.outboundSource || null,
        traceUserId: row.outboundSenderUserId || null,
        traceUserEmail: row.outboundSenderEmail || null,
      });

      return {
        id: row.id,
        providerMessageId: row.providerMessageId,
        customerName: row.customerName,
        messageType: row.messageType,
        text: row.text,
        status: row.processingStatus || 'DONE',
        direction,
        deliveryChannel: 'INSTAGRAM',
        outboundSource: outboundMeta.outboundSource,
        outboundSourceLabel: outboundMeta.outboundSourceLabel,
        outboundSenderUserId: outboundMeta.outboundSenderUserId,
        outboundSenderEmail: outboundMeta.outboundSenderEmail,
        eventTimestamp: row.eventTimestamp.toISOString(),
        raw,
      };
    });

    return res.status(200).json({
      items,
      conversationState: serializeConversationState(stateRow),
    });
  } catch (error) {
    console.error('Admin instagram inbox messages error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/instagram-inbox/conversations/:conversationKey/reply', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ message: 'text is required.' });
  }

  try {
    const keyCandidates = conversationKeyCandidates('INSTAGRAM', conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey('INSTAGRAM', key))));
    const latestInboundWhere: any = {
      salonId,
      channel: 'INSTAGRAM',
      OR: [
        {
          conversationKey: {
            in: keyCandidates,
          },
        },
        {
          messageType: {
            startsWith: 'echo_',
          },
          externalAccountId: {
            in: rawKeyCandidates,
          },
        },
      ],
    };

    const latestInbound = await prisma.conversationMessageEvent.findFirst({
      where: latestInboundWhere,
      orderBy: {
        eventTimestamp: 'desc',
      },
      select: {
        conversationKey: true,
        externalAccountId: true,
        customerName: true,
        messageType: true,
        rawPayload: true,
      },
    });

    if (!latestInbound) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const resolvedConversationKey = latestInbound.conversationKey || conversationKey;
    const senderUserId = Number.isInteger(Number(req.user?.userId)) ? Number(req.user.userId) : null;
    const senderUser = senderUserId
      ? await prisma.salonUser.findFirst({
          where: {
            id: senderUserId,
            salonId,
          },
          select: {
            id: true,
            email: true,
          },
        })
      : null;
    const senderUserEmail =
      typeof senderUser?.email === 'string' && senderUser.email.trim() ? senderUser.email.trim() : null;
    const settings = await prisma.salonAiAgentSettings.findUnique({
      where: { salonId },
      select: { faqAnswers: true },
    });

    const faqAnswers = asObject(settings?.faqAnswers);
    const metaDirect = asObject(faqAnswers.metaDirect);
    const instagram = asObject(metaDirect.instagram);
    const accessToken = typeof instagram.accessToken === 'string' ? instagram.accessToken.trim() : '';
    const configuredInstagramId = typeof instagram.externalAccountId === 'string' ? instagram.externalAccountId.trim() : '';
    let senderInstagramId = configuredInstagramId;
    const actors = extractInstagramActors(latestInbound.rawPayload);
    const echoByType = isEchoMessageType(latestInbound.messageType || '');
    const normalizeId = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      return normalizeInstagramIdentity(trimmed) || trimmed;
    };
    const configuredNormalized = normalizeId(configuredInstagramId);
    const requestedRaw = extractRawConversationKey('INSTAGRAM', conversationKey);
    const requestedRecipient = normalizeId(requestedRaw);
    const keyRaw = extractRawConversationKey('INSTAGRAM', resolvedConversationKey);
    const actorRecipient = normalizeId(echoByType ? actors.recipientId : actors.senderId);
    const actorCounterpart = normalizeId(echoByType ? actors.senderId : actors.recipientId);
    const legacyExternal = normalizeId(latestInbound.externalAccountId);
    const keyRecipient = normalizeId(keyRaw);
    let rawRecipientId =
      [requestedRecipient, actorRecipient, actorCounterpart, legacyExternal, keyRecipient].find(
        (candidate) => candidate && (!configuredNormalized || candidate !== configuredNormalized),
      ) || '';
    if (!rawRecipientId) {
      return res.status(400).json({ message: 'Conversation recipient could not be resolved.' });
    }
    if (!senderInstagramId) {
      senderInstagramId = actorCounterpart || keyRecipient || '';
    }
    if ((!senderInstagramId || normalizeId(senderInstagramId) === rawRecipientId) && legacyExternal && legacyExternal !== rawRecipientId) {
      senderInstagramId = legacyExternal;
    }

    if (!accessToken || !senderInstagramId) {
      return res.status(400).json({ message: 'Instagram is not connected yet.' });
    }

    const canonicalConversationKey = `INSTAGRAM:${rawRecipientId}`;

    const url = `https://graph.instagram.com/${META_GRAPH_VERSION}/${senderInstagramId}/messages`;
    const graphResponse = await axios.post(
      url,
      {
        recipient: { id: rawRecipientId },
        message: { text },
      },
      {
        params: { access_token: accessToken },
        timeout: 20000,
      },
    );

    const graphMessageId =
      (typeof graphResponse.data?.message_id === 'string' && graphResponse.data.message_id.trim()) ||
      `ig_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const saved = await prisma.inboundMessageQueue.create({
      data: {
        salonId,
        channel: 'INSTAGRAM',
        conversationKey: canonicalConversationKey,
        providerMessageId: graphMessageId,
        externalAccountId: senderInstagramId,
        customerName: latestInbound.customerName || null,
        messageType: 'text_outbound',
        text,
        eventTimestamp: new Date(),
        rawPayload: {
          direction: 'outbound',
          source: 'HUMAN_APP',
          sentBy: {
            userId: senderUser?.id || null,
            email: senderUserEmail,
          },
          graphResponse: graphResponse.data || null,
        } as any,
        status: 'DONE',
        processedAt: new Date(),
      },
    });

    await prisma.outboundMessageTrace.upsert({
      where: {
        channel_providerMessageId: {
          channel: 'INSTAGRAM',
          providerMessageId: graphMessageId,
        },
      },
      update: {
        salonId,
        conversationKey: canonicalConversationKey,
        source: 'HUMAN_APP',
        externalAccountId: senderInstagramId,
        text,
        sourceUserId: senderUser?.id || null,
        sourceUserEmail: senderUserEmail,
        sentAt: new Date(),
      },
      create: {
        salonId,
        channel: 'INSTAGRAM',
        conversationKey: canonicalConversationKey,
        providerMessageId: graphMessageId,
        source: 'HUMAN_APP',
        externalAccountId: senderInstagramId,
        text,
        sourceUserId: senderUser?.id || null,
        sourceUserEmail: senderUserEmail,
        sentAt: new Date(),
      },
    });

    await upsertConversationMessageEvent({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: canonicalConversationKey,
      providerMessageId: graphMessageId,
      externalAccountId: senderInstagramId,
      customerName: latestInbound.customerName || null,
      messageType: 'text_outbound',
      text,
      direction: 'OUTBOUND',
      eventTimestamp: saved.eventTimestamp,
      processingStatus: InboundMessageStatus.DONE,
      outboundSource: OutboundMessageSource.HUMAN_APP,
      outboundSenderUserId: senderUser?.id || null,
      outboundSenderEmail: senderUserEmail,
      rawPayload: {
        direction: 'outbound',
        source: 'HUMAN_APP',
        sentBy: {
          userId: senderUser?.id || null,
          email: senderUserEmail,
        },
        graphResponse: graphResponse.data || null,
      } as any,
    });

    await markConversationHumanActive({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: canonicalConversationKey,
      profileName: latestInbound.customerName || null,
    });
    await resolveHandoverAlert({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: canonicalConversationKey,
      byHumanMessage: true,
    });

    return res.status(200).json({
      item: {
        id: saved.id,
        providerMessageId: saved.providerMessageId,
        messageType: saved.messageType,
        text: saved.text,
        status: saved.status,
        direction: 'outbound',
        eventTimestamp: saved.eventTimestamp.toISOString(),
      },
    });
  } catch (error: any) {
    const fbMessage =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'Failed to send message.';
    console.error('Admin instagram inbox reply error:', error?.response?.data || error);
    return res.status(502).json({ message: String(fbMessage) });
  }
});

router.post('/instagram-inbox/conversations/:conversationKey/handover', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

  try {
    const keyCandidates = conversationKeyCandidates('INSTAGRAM', conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey('INSTAGRAM', key))));
    const latestInboundWhere: any = {
      salonId,
      channel: 'INSTAGRAM',
      OR: [
        {
          conversationKey: {
            in: keyCandidates,
          },
        },
        {
          messageType: {
            startsWith: 'echo_',
          },
          externalAccountId: {
            in: rawKeyCandidates,
          },
        },
      ],
    };

    const latestInbound = await prisma.conversationMessageEvent.findFirst({
      where: latestInboundWhere,
      orderBy: {
        eventTimestamp: 'desc',
      },
      select: {
        conversationKey: true,
        externalAccountId: true,
        customerName: true,
      },
    });

    if (!latestInbound) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const resolvedConversationKey = latestInbound.conversationKey || conversationKey;
    const stateCandidates = Array.from(
      new Set([...keyCandidates, ...conversationKeyCandidates('INSTAGRAM', resolvedConversationKey)]),
    );
    const existingStateRows = await prisma.conversationState.findMany({
      where: {
        salonId,
        channel: 'INSTAGRAM',
        conversationKey: {
          in: stateCandidates,
        },
      },
      select: {
        channel: true,
        conversationKey: true,
        customerId: true,
        mode: true,
        manualAlways: true,
        humanPendingSince: true,
        humanActiveUntil: true,
        lastHumanMessageAt: true,
        lastCustomerMessageAt: true,
        updatedAt: true,
      },
    });
    const existingState = pickLatestState(
      existingStateRows.map((row) => ({
        channel: row.channel as 'INSTAGRAM' | 'WHATSAPP',
        conversationKey: row.conversationKey,
        customerId: row.customerId || null,
        mode: row.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(row.manualAlways),
        humanPendingSince: row.humanPendingSince || null,
        humanActiveUntil: row.humanActiveUntil || null,
        lastHumanMessageAt: row.lastHumanMessageAt || null,
        lastCustomerMessageAt: row.lastCustomerMessageAt || null,
        updatedAt: row.updatedAt || null,
      })),
    );
    if (existingState && isHandoverMode(existingState.mode)) {
      return res.status(200).json({
        ok: true,
        alreadyRequested: true,
        state: serializeConversationState(existingState),
      });
    }

    const saved = await prisma.inboundMessageQueue.create({
      data: {
        salonId,
        channel: 'INSTAGRAM',
        conversationKey: resolvedConversationKey,
        providerMessageId: `handover_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        externalAccountId: latestInbound.externalAccountId,
        customerName: latestInbound.customerName || null,
        messageType: 'handover_request',
        text: note || 'Human handover requested.',
        eventTimestamp: new Date(),
        rawPayload: {
          direction: 'system',
          handoverRequested: true,
        } as any,
        status: 'DONE',
        processedAt: new Date(),
      },
    });

    await upsertConversationMessageEvent({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: resolvedConversationKey,
      providerMessageId: saved.providerMessageId,
      externalAccountId: latestInbound.externalAccountId,
      customerName: latestInbound.customerName || null,
      messageType: 'handover_request',
      text: note || 'Human handover requested.',
      direction: 'SYSTEM',
      eventTimestamp: saved.eventTimestamp,
      processingStatus: InboundMessageStatus.DONE,
      rawPayload: {
        direction: 'system',
        handoverRequested: true,
      } as any,
    });

    const updatedState = await markConversationHumanPending({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: resolvedConversationKey,
      note: note || 'Human handover requested.',
      profileName: latestInbound.customerName || null,
    });
    await markHandoverTriggered({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: resolvedConversationKey,
      customerName: latestInbound.customerName || null,
    });

    return res.status(200).json({
      ok: true,
      alreadyRequested: false,
      item: {
        id: saved.id,
        providerMessageId: saved.providerMessageId,
        messageType: saved.messageType,
        text: saved.text,
        status: saved.status,
        direction: 'system',
        eventTimestamp: saved.eventTimestamp.toISOString(),
      },
      state: serializeConversationState({
        channel: 'INSTAGRAM',
        conversationKey: updatedState.conversationKey,
        customerId: updatedState.customerId || null,
        mode: updatedState.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(updatedState.manualAlways),
        humanPendingSince: updatedState.humanPendingSince || null,
        humanActiveUntil: updatedState.humanActiveUntil || null,
        lastHumanMessageAt: updatedState.lastHumanMessageAt || null,
        lastCustomerMessageAt: updatedState.lastCustomerMessageAt || null,
        updatedAt: updatedState.updatedAt || null,
      }),
    });
  } catch (error) {
    console.error('Admin instagram inbox handover error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/instagram-inbox/conversations/:conversationKey/resume-auto', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const conversationKey = typeof req.params.conversationKey === 'string' ? req.params.conversationKey.trim() : '';
  if (!conversationKey) {
    return res.status(400).json({ message: 'conversationKey is required.' });
  }

  try {
    const keyCandidates = conversationKeyCandidates('INSTAGRAM', conversationKey);
    const rawKeyCandidates = Array.from(new Set(keyCandidates.map((key) => extractRawConversationKey('INSTAGRAM', key))));
    const latestInboundWhere: any = {
      salonId,
      channel: 'INSTAGRAM',
      OR: [
        {
          conversationKey: {
            in: keyCandidates,
          },
        },
        {
          messageType: {
            startsWith: 'echo_',
          },
          externalAccountId: {
            in: rawKeyCandidates,
          },
        },
      ],
    };

    const latestInbound = await prisma.conversationMessageEvent.findFirst({
      where: latestInboundWhere,
      orderBy: {
        eventTimestamp: 'desc',
      },
      select: {
        conversationKey: true,
        customerName: true,
      },
    });

    if (!latestInbound) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const resolvedConversationKey = latestInbound.conversationKey || conversationKey;

    const updatedState = await markConversationAuto({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: resolvedConversationKey,
      note: 'manual_resumed_by_salon',
      profileName: latestInbound.customerName || null,
    });
    await resolveHandoverAlert({
      salonId,
      channel: 'INSTAGRAM',
      conversationKey: resolvedConversationKey,
    });

    return res.status(200).json({
      ok: true,
      state: serializeConversationState({
        channel: 'INSTAGRAM',
        conversationKey: updatedState.conversationKey,
        customerId: updatedState.customerId || null,
        mode: updatedState.mode as ConversationAutomationModeValue,
        manualAlways: Boolean(updatedState.manualAlways),
        humanPendingSince: updatedState.humanPendingSince || null,
        humanActiveUntil: updatedState.humanActiveUntil || null,
        lastHumanMessageAt: updatedState.lastHumanMessageAt || null,
        lastCustomerMessageAt: updatedState.lastCustomerMessageAt || null,
        updatedAt: updatedState.updatedAt || null,
      }),
    });
  } catch (error) {
    console.error('Admin instagram inbox resume-auto error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/blacklist', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  try {
    const items = await prisma.blacklistEntry.findMany({
      where: {
        salonId,
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { reason: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return res.status(200).json({ items });
  } catch (error) {
    console.error('Admin blacklist list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/blacklist', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : null;
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : null;
  const customerId = req.body?.customerId ? Number(req.body.customerId) : null;

  if (!phone && !customerId) {
    return res.status(400).json({ message: 'phone or customerId is required.' });
  }

  try {
    const item = await prisma.blacklistEntry.create({
      data: {
        salonId,
        phone,
        fullName,
        reason,
        customerId: customerId && customerId > 0 ? customerId : null,
        createdById: req.user.userId,
        isActive: true,
      },
    });

    return res.status(201).json({ item });
  } catch (error) {
    console.error('Admin blacklist create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.patch('/blacklist/:id', authenticateToken, async (req: any, res: any) => {
  const salonId = getSalonId(req, res);
  if (!salonId) {
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id.' });
  }

  try {
    const current = await prisma.blacklistEntry.findFirst({ where: { id, salonId } });
    if (!current) {
      return res.status(404).json({ message: 'Blacklist entry not found.' });
    }

    const item = await prisma.blacklistEntry.update({
      where: { id },
      data: {
        ...(req.body?.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
        ...(req.body?.reason !== undefined ? { reason: req.body.reason ? String(req.body.reason).trim() : null } : {}),
      },
    });

    return res.status(200).json({ item });
  } catch (error) {
    console.error('Admin blacklist update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
