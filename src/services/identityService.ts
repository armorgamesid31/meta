import { ChannelType, IdentityBindingSource, IdentitySessionStatus, IdentitySubjectType } from '@prisma/client';
import { prisma } from '../prisma.js';

type NullableString = string | null | undefined;

export interface ResolvedIdentity {
  channel: ChannelType;
  subjectType: IdentitySubjectType;
  subjectRaw: string;
  subjectNormalized: string;
}

export function normalizePhoneDigits(value: NullableString): string {
  return (value || '').replace(/\D/g, '');
}

export function normalizeInstagramIdentity(value: NullableString): string {
  let out = (value || '').trim();
  if (!out) return '';
  if (out.startsWith('id:')) out = out.slice(3);
  if (out.toUpperCase().startsWith('INSTAGRAM:')) out = out.slice('INSTAGRAM:'.length);
  if (out.toLowerCase().startsWith('customer:')) return '';
  return out.replace(/^@/, '').trim().toLowerCase();
}

export function extractRawConversationKey(channel: ChannelType, conversationKey: NullableString): string {
  const trimmed = (conversationKey || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(`${channel}:`)) return trimmed.slice(channel.length + 1).trim();
  return trimmed;
}

function asChannel(value: NullableString): ChannelType | null {
  const normalized = (value || '').trim().toUpperCase();
  if (normalized === 'INSTAGRAM' || normalized === 'WHATSAPP') {
    return normalized as ChannelType;
  }
  return null;
}

function inferChannel(params: {
  channel?: NullableString;
  phone?: NullableString;
  customerKey?: NullableString;
  conversationKey?: NullableString;
}): ChannelType | null {
  const explicit = asChannel(params.channel || '');
  if (explicit) return explicit;

  const fromConversation = (params.conversationKey || '').trim().toUpperCase();
  if (fromConversation.startsWith('INSTAGRAM:')) return 'INSTAGRAM';
  if (fromConversation.startsWith('WHATSAPP:')) return 'WHATSAPP';

  const fromKey = (params.customerKey || '').trim().toUpperCase();
  if (fromKey.startsWith('INSTAGRAM:') || fromKey.startsWith('ID:')) return 'INSTAGRAM';
  if (fromKey.startsWith('WHATSAPP:')) return 'WHATSAPP';

  if ((params.phone || '').trim()) return 'WHATSAPP';
  if ((params.customerKey || '').trim()) return 'INSTAGRAM';
  return null;
}

export function resolveIdentity(params: {
  channel?: NullableString;
  phone?: NullableString;
  customerKey?: NullableString;
  conversationKey?: NullableString;
}): ResolvedIdentity | null {
  const channel = inferChannel(params);
  if (!channel) return null;

  if (channel === 'WHATSAPP') {
    const raw = (params.phone || extractRawConversationKey('WHATSAPP', params.conversationKey)).trim();
    const normalized = normalizePhoneDigits(raw);
    if (!raw || !normalized) return null;
    return {
      channel,
      subjectType: 'PHONE',
      subjectRaw: raw,
      subjectNormalized: normalized,
    };
  }

  const rawKey =
    (params.customerKey || '').trim() ||
    extractRawConversationKey('INSTAGRAM', params.conversationKey).trim();
  const normalized = normalizeInstagramIdentity(rawKey);
  if (!rawKey || !normalized) return null;
  return {
    channel,
    subjectType: 'INSTAGRAM_ID',
    subjectRaw: rawKey,
    subjectNormalized: normalized,
  };
}

export async function upsertIdentitySession(input: {
  salonId: number;
  identity: ResolvedIdentity;
  conversationKey?: string | null;
  canonicalUserId?: string | null;
  customerId?: number | null;
  inboundAt?: Date | null;
  outboundAt?: Date | null;
  status?: IdentitySessionStatus;
  metadata?: Record<string, unknown> | null;
}) {
  return prisma.identitySession.upsert({
    where: {
      salonId_channel_subjectNormalized: {
        salonId: input.salonId,
        channel: input.identity.channel,
        subjectNormalized: input.identity.subjectNormalized,
      },
    },
    update: {
      subjectRaw: input.identity.subjectRaw,
      subjectType: input.identity.subjectType,
      ...(input.conversationKey ? { conversationKey: input.conversationKey } : {}),
      ...(input.canonicalUserId ? { canonicalUserId: input.canonicalUserId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.inboundAt ? { lastInboundAt: input.inboundAt } : {}),
      ...(input.outboundAt ? { lastOutboundAt: input.outboundAt } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.metadata ? { metadata: input.metadata as any } : {}),
    },
    create: {
      salonId: input.salonId,
      channel: input.identity.channel,
      subjectType: input.identity.subjectType,
      subjectRaw: input.identity.subjectRaw,
      subjectNormalized: input.identity.subjectNormalized,
      conversationKey: input.conversationKey || null,
      canonicalUserId: input.canonicalUserId || null,
      customerId: input.customerId || null,
      lastInboundAt: input.inboundAt || null,
      lastOutboundAt: input.outboundAt || null,
      status: input.status || 'ACTIVE',
      metadata: input.metadata ? (input.metadata as any) : undefined,
    },
  });
}

export async function findBoundCustomer(params: {
  salonId: number;
  channel: ChannelType;
  subjectNormalized: string;
}) {
  const binding = await prisma.identityBinding.findUnique({
    where: {
      salonId_channel_subjectNormalized: {
        salonId: params.salonId,
        channel: params.channel,
        subjectNormalized: params.subjectNormalized,
      },
    },
    select: {
      customer: {
        select: { id: true, name: true, firstName: true, lastName: true, phone: true, instagram: true },
      },
    },
  });

  return binding?.customer || null;
}

export async function upsertIdentityBinding(input: {
  salonId: number;
  channel: ChannelType;
  subjectNormalized: string;
  subjectRaw: string;
  customerId: number;
  sessionId?: string | null;
  source?: IdentityBindingSource;
}) {
  return prisma.identityBinding.upsert({
    where: {
      salonId_channel_subjectNormalized: {
        salonId: input.salonId,
        channel: input.channel,
        subjectNormalized: input.subjectNormalized,
      },
    },
    update: {
      customerId: input.customerId,
      subjectRaw: input.subjectRaw,
      sessionId: input.sessionId || null,
      source: input.source || 'SYSTEM',
      isActive: true,
      verifiedAt: new Date(),
    },
    create: {
      salonId: input.salonId,
      channel: input.channel,
      subjectNormalized: input.subjectNormalized,
      subjectRaw: input.subjectRaw,
      customerId: input.customerId,
      sessionId: input.sessionId || null,
      source: input.source || 'SYSTEM',
      isActive: true,
      verifiedAt: new Date(),
    },
  });
}
