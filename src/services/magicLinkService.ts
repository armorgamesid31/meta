import { MagicLink, MagicLinkType, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma.js';

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

function normalizeIdentity(phone: unknown, customerKey: unknown): string | null {
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : '';
  if (normalizedPhone) {
    return normalizedPhone;
  }

  const normalizedKey = typeof customerKey === 'string' ? customerKey.trim() : '';
  if (normalizedKey) {
    return `id:${normalizedKey}`;
  }

  return null;
}

function extractSalonId(context: Prisma.JsonValue | null): number | null {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null;
  }
  const value = (context as any).salonId;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildMagicUrl(token: string): string {
  const baseUrl = process.env.BOOKING_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${baseUrl.replace(/\/+$/, '')}/m/${token}`;
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
  context?: Prisma.InputJsonValue | null;
}) {
  const type = params.type || 'BOOKING';
  const subject = normalizeIdentity(params.phone, params.customerKey);
  if (!subject) {
    throw new Error('phone_or_customer_key_required');
  }

  const now = Date.now();
  const expiresAt = new Date(now + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  const mergedContext: Prisma.InputJsonValue = {
    ...(typeof params.context === 'object' && params.context && !Array.isArray(params.context) ? params.context : {}),
    salonId: params.salonId,
    customerKey: params.customerKey || null,
  };

  const candidates = await prisma.magicLink.findMany({
    where: {
      phone: subject,
      type,
      usedAt: null,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 20,
  });

  const reusable = candidates.find((item) => extractSalonId(item.context as Prisma.JsonValue | null) === params.salonId);

  let record: MagicLink;
  let action: 'created' | 'renewed';

  if (reusable) {
    record = await prisma.magicLink.update({
      where: { id: reusable.id },
      data: {
        expiresAt,
        context: mergedContext,
      },
    });
    action = 'renewed';
  } else {
    const token = await createUniqueToken();
    record = await prisma.magicLink.create({
      data: {
        token,
        phone: subject,
        type,
        context: mergedContext,
        expiresAt,
      },
    });
    action = 'created';
  }

  return {
    ok: true as const,
    action,
    token: record.token,
    magicUrl: buildMagicUrl(record.token),
    expiresAt: record.expiresAt,
  };
}
