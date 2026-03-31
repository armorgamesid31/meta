import { ChannelType, MagicLink, MagicLinkType, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma.js';
import { buildBookingUrl } from '../utils/bookingUrl.js';
import { resolveIdentity, upsertIdentitySession } from './identityService.js';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const MAGIC_LINK_TTL_MINUTES = 60;

function pickTokenChar(byte: number): string {
  return TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
}

function generateToken(length = 16): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += pickTokenChar(bytes[i]);
  }
  return out;
}

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

async function createUniqueToken(): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const token = generateToken(16);
    const existing = await prisma.magicLink.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!existing) {
      return token;
    }
  }

  return `${generateToken(12)}${Date.now().toString().slice(-4)}`;
}

export async function ensureMagicLink(params: {
  salonId: number;
  type?: MagicLinkType;
  phone?: string | null;
  customerKey?: string | null;
  channel?: ChannelType | null;
  context?: Prisma.InputJsonValue | null;
  salonSlug?: string | null;
  conversationKey?: string | null;
  canonicalUserId?: string | null;
  customerId?: number | null;
}) {
  const type = params.type || 'BOOKING';
  const now = new Date();
  const contextObj = asObject(params.context);
  const contextChannel = typeof contextObj.channel === 'string' ? (contextObj.channel as string) : null;
  const contextConversationKey = typeof contextObj.conversationKey === 'string' ? contextObj.conversationKey : null;
  const contextCanonicalUserId = typeof contextObj.canonicalUserId === 'string' ? contextObj.canonicalUserId : null;
  const contextCustomerId = Number.isInteger(Number(contextObj.customerId)) ? Number(contextObj.customerId) : null;

  const conversationKey = params.conversationKey || contextConversationKey || null;
  const canonicalUserId = params.canonicalUserId || contextCanonicalUserId || null;
  const customerId = params.customerId || contextCustomerId || null;

  const identity = resolveIdentity({
    channel: params.channel || contextChannel,
    phone: params.phone,
    customerKey: params.customerKey,
    conversationKey,
  });

  if (!identity) {
    throw new Error('identity_required');
  }

  const session = await upsertIdentitySession({
    salonId: params.salonId,
    identity,
    conversationKey,
    canonicalUserId,
    customerId,
    outboundAt: now,
    status: customerId ? 'LINKED' : 'ACTIVE',
  });

  await prisma.magicLink.updateMany({
    where: {
      salonId: params.salonId,
      channel: identity.channel,
      subjectNormalized: identity.subjectNormalized,
      type,
      status: 'ACTIVE',
      expiresAt: { lt: now },
    },
    data: {
      status: 'EXPIRED',
    },
  });

  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  const mergedContext: Prisma.InputJsonValue = {
    ...contextObj,
    salonId: params.salonId,
    channel: identity.channel,
    customerKey: params.customerKey || contextObj.customerKey || null,
    conversationKey: conversationKey || null,
    canonicalUserId: canonicalUserId || null,
    customerId: customerId || null,
    identitySessionId: session.id,
    subjectNormalized: identity.subjectNormalized,
  };

  const reusable = await prisma.magicLink.findFirst({
    where: {
      salonId: params.salonId,
      channel: identity.channel,
      type,
      subjectNormalized: identity.subjectNormalized,
      status: 'ACTIVE',
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  let record: MagicLink;
  let action: 'created' | 'renewed';

  if (reusable) {
    record = await prisma.magicLink.update({
      where: { id: reusable.id },
      data: {
        phone: identity.subjectRaw,
        subjectType: identity.subjectType,
        subjectNormalized: identity.subjectNormalized,
        identitySessionId: session.id,
        context: mergedContext,
        expiresAt,
        status: 'ACTIVE',
      },
    });
    action = 'renewed';
  } else {
    const token = await createUniqueToken();
    record = await prisma.magicLink.create({
      data: {
        token,
        phone: identity.subjectRaw,
        type,
        context: mergedContext,
        salonId: params.salonId,
        channel: identity.channel,
        subjectType: identity.subjectType,
        subjectNormalized: identity.subjectNormalized,
        identitySessionId: session.id,
        status: 'ACTIVE',
        expiresAt,
      },
    });
    action = 'created';
  }

  const contextSlug = normalizeSlug(contextObj.salonSlug);
  const magicUrl = buildBookingUrl({
    token: record.token,
    salonId: params.salonId,
    salonSlug: normalizeSlug(params.salonSlug) || contextSlug,
  });

  return {
    ok: true as const,
    action,
    token: record.token,
    magicUrl,
    expiresAt: record.expiresAt,
  };
}
