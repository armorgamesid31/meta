import type { ChannelType } from '@prisma/client';
import { prisma } from '../prisma.js';
import { normalizeInstagramIdentity, normalizePhoneDigits } from './identityService.js';
import { getSalonCustomerRiskPolicy } from './customerRiskPolicy.js';

export type BlacklistMatchType = 'CUSTOMER' | 'PHONE' | 'IDENTITY';

export type IdentityBanCheckInput = {
  salonId: number;
  customerId?: number | null;
  phone?: string | null;
  channel?: ChannelType | null;
  subjectNormalized?: string | null;
};

export type IdentityBanCheckResult = {
  blocked: boolean;
  reason: string | null;
  entryId: number | null;
  matchType: BlacklistMatchType | null;
};

type NormalizedIdentity = {
  customerId: number | null;
  phone: string | null;
  channel: ChannelType | null;
  subjectNormalized: string | null;
};

function asChannel(value: unknown): ChannelType | null {
  if (value === 'INSTAGRAM' || value === 'WHATSAPP') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') return normalized as ChannelType;
  return null;
}

function normalizeIdentity(input: {
  customerId?: number | null;
  phone?: string | null;
  channel?: ChannelType | null;
  subjectNormalized?: string | null;
}): NormalizedIdentity {
  const customerId = Number.isInteger(Number(input.customerId)) && Number(input.customerId) > 0 ? Number(input.customerId) : null;
  const channel = asChannel(input.channel);
  const phone = normalizePhoneDigits(input.phone || '') || null;
  const subjectNormalizedRaw = typeof input.subjectNormalized === 'string' ? input.subjectNormalized.trim() : '';
  const subjectNormalized = channel === 'INSTAGRAM' ? normalizeInstagramIdentity(subjectNormalizedRaw) || null : subjectNormalizedRaw || null;

  return {
    customerId,
    phone,
    channel,
    subjectNormalized,
  };
}

export async function isIdentityBanned(input: IdentityBanCheckInput): Promise<IdentityBanCheckResult> {
  const normalized = normalizeIdentity(input);
  const blacklist = (prisma as any).blacklistEntry;

  const whereOr: any[] = [];
  if (normalized.customerId) whereOr.push({ customerId: normalized.customerId });
  if (normalized.phone) whereOr.push({ phone: { not: null } });
  if (normalized.channel && normalized.subjectNormalized) {
    whereOr.push({
      channel: normalized.channel,
      subjectNormalized: normalized.subjectNormalized,
    });
  }

  if (!whereOr.length) {
    return { blocked: false, reason: null, entryId: null, matchType: null };
  }

  const candidates = await blacklist.findMany({
    where: {
      salonId: input.salonId,
      isActive: true,
      OR: whereOr,
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });

  for (const item of candidates as any[]) {
    if (normalized.customerId && Number(item.customerId) === normalized.customerId) {
      return {
        blocked: true,
        reason: item.reason || null,
        entryId: Number(item.id),
        matchType: 'CUSTOMER',
      };
    }
  }

  for (const item of candidates as any[]) {
    if (
      normalized.channel &&
      normalized.subjectNormalized &&
      item.channel === normalized.channel &&
      typeof item.subjectNormalized === 'string' &&
      item.subjectNormalized.trim() === normalized.subjectNormalized
    ) {
      return {
        blocked: true,
        reason: item.reason || null,
        entryId: Number(item.id),
        matchType: 'IDENTITY',
      };
    }
  }

  for (const item of candidates as any[]) {
    const itemPhone = normalizePhoneDigits(item.phone || '');
    if (normalized.phone && itemPhone && itemPhone === normalized.phone) {
      return {
        blocked: true,
        reason: item.reason || null,
        entryId: Number(item.id),
        matchType: 'PHONE',
      };
    }
  }

  return { blocked: false, reason: null, entryId: null, matchType: null };
}

export async function assertBookingAllowed(input: IdentityBanCheckInput): Promise<void> {
  const policy = await getSalonCustomerRiskPolicy(input.salonId);
  if (!policy.blockBookingWhenBanned) return;

  const blocked = await isIdentityBanned(input);
  if (blocked.blocked) {
    const error = new Error('CUSTOMER_BANNED');
    (error as any).code = 'CUSTOMER_BANNED';
    (error as any).status = 403;
    (error as any).ban = blocked;
    throw error;
  }
}

export async function upsertBlacklistBan(input: {
  salonId: number;
  customerId?: number | null;
  phone?: string | null;
  channel?: ChannelType | null;
  subjectNormalized?: string | null;
  fullName?: string | null;
  reason?: string | null;
  createdById?: number | null;
  isActive?: boolean;
}) {
  const normalized = normalizeIdentity(input);
  const blacklist = (prisma as any).blacklistEntry;
  const isActive = input.isActive ?? true;

  const allCandidates = await blacklist.findMany({
    where: {
      salonId: input.salonId,
      OR: [
        ...(normalized.customerId ? [{ customerId: normalized.customerId }] : []),
        ...(normalized.channel && normalized.subjectNormalized
          ? [{ channel: normalized.channel, subjectNormalized: normalized.subjectNormalized }]
          : []),
        ...(normalized.phone ? [{ phone: { not: null } }] : []),
      ],
    },
    orderBy: [{ id: 'desc' }],
    take: 200,
  });

  const matchedByCustomer = normalized.customerId
    ? (allCandidates as any[]).find((item) => Number(item.customerId) === normalized.customerId)
    : null;
  const matchedByIdentity =
    !matchedByCustomer && normalized.channel && normalized.subjectNormalized
      ? (allCandidates as any[]).find(
          (item) => item.channel === normalized.channel && String(item.subjectNormalized || '') === normalized.subjectNormalized,
        )
      : null;
  const matchedByPhone =
    !matchedByCustomer && !matchedByIdentity && normalized.phone
      ? (allCandidates as any[]).find((item) => normalizePhoneDigits(item.phone || '') === normalized.phone)
      : null;

  const existing = matchedByCustomer || matchedByIdentity || matchedByPhone || null;
  const data = {
    customerId: normalized.customerId,
    phone: normalized.phone,
    channel: normalized.channel,
    subjectNormalized: normalized.subjectNormalized,
    fullName: typeof input.fullName === 'string' && input.fullName.trim() ? input.fullName.trim() : null,
    reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : null,
    isActive,
    createdById: Number.isInteger(Number(input.createdById)) && Number(input.createdById) > 0 ? Number(input.createdById) : null,
  };

  if (existing) {
    return blacklist.update({
      where: { id: existing.id },
      data,
    });
  }

  return blacklist.create({
    data: {
      salonId: input.salonId,
      ...data,
    },
  });
}

export async function maybeAutoBanCustomerByNoShow(input: {
  salonId: number;
  customerId: number;
  noShowCount: number;
  createdById?: number | null;
}) {
  const policy = await getSalonCustomerRiskPolicy(input.salonId);
  if (!policy.autoBanEnabled) return { applied: false, reason: 'auto_ban_disabled' as const };
  if (input.noShowCount < policy.noShowThreshold) return { applied: false, reason: 'threshold_not_reached' as const };

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, salonId: input.salonId },
    select: {
      id: true,
      name: true,
      phone: true,
      instagram: true,
    },
  });

  if (!customer) return { applied: false, reason: 'customer_not_found' as const };

  await upsertBlacklistBan({
    salonId: input.salonId,
    customerId: customer.id,
    phone: customer.phone || null,
    fullName: customer.name || null,
    reason: `Auto-ban: no-show threshold reached (${input.noShowCount}/${policy.noShowThreshold})`,
    createdById: input.createdById || null,
    isActive: true,
  });

  const normalizedIg = normalizeInstagramIdentity(customer.instagram || '');
  if (normalizedIg) {
    await upsertBlacklistBan({
      salonId: input.salonId,
      channel: 'INSTAGRAM',
      subjectNormalized: normalizedIg,
      fullName: customer.name || null,
      reason: `Auto-ban: no-show threshold reached (${input.noShowCount}/${policy.noShowThreshold})`,
      createdById: input.createdById || null,
      isActive: true,
    });
  }

  if (customer.phone) {
    await upsertBlacklistBan({
      salonId: input.salonId,
      channel: 'WHATSAPP',
      phone: customer.phone,
      fullName: customer.name || null,
      reason: `Auto-ban: no-show threshold reached (${input.noShowCount}/${policy.noShowThreshold})`,
      createdById: input.createdById || null,
      isActive: true,
    });
  }

  return { applied: true as const, reason: 'threshold_reached' as const };
}
