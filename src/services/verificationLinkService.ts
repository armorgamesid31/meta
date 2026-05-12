// VerificationLink service — UTILITY-link based phone/email verification.
//
// Replaces OTP-style codes with magic links that target a stable web URL.
// Token plaintext is generated client-side as base58 (~24 chars), only
// sha256(token) is stored in the DB. This means a DB dump cannot leak
// usable URLs.
//
// All flows that need verification (salon signup email, team invite phone,
// phone change, password reset, customer phone, customer link consent)
// share a single VerificationLink row format with `purpose` discriminator.

import { randomBytes, createHash } from 'crypto';
import { Prisma, VerificationChannel, VerificationPurpose } from '@prisma/client';
import { prisma } from '../prisma.js';

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

const TTL_MINUTES = Number(process.env.VERIFICATION_LINK_TTL_MINUTES || 15);
const RESEND_COOLDOWN_SECONDS = Number(process.env.VERIFICATION_RESEND_COOLDOWN_SECONDS || 60);
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TOKEN_BYTE_LEN = 18; // 18 random bytes → ~24 base58 chars

// BASE_URL_KEDY → marketing site (kedyapp.com/v/[token]) — Kedy auth flows
// BASE_URL_CUSTOMER → booking frontend (app.berkai.shop/c/v/[token]) —
// customer-side verify (same host serves booking pages + the backend API).
const BASE_URL_KEDY = (process.env.VERIFICATION_BASE_URL_KEDY || 'https://kedyapp.com').replace(/\/+$/, '');
const BASE_URL_CUSTOMER = (process.env.VERIFICATION_BASE_URL_CUSTOMER || 'https://app.berkai.shop').replace(/\/+$/, '');

// ─────────────────────────────────────────────────────────────────
// Token primitives
// ─────────────────────────────────────────────────────────────────

function generateToken(): string {
  const bytes = randomBytes(TOKEN_BYTE_LEN);
  let out = '';
  for (let i = 0; i < TOKEN_BYTE_LEN; i += 1) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildLink(params: {
  token: string;
  purpose: VerificationPurpose;
  salonSlug?: string | null;
}): string {
  // Customer flows go to the booking frontend (salon-branded landing).
  // All other flows go to the Kedy app landing.
  const isCustomerFlow =
    params.purpose === VerificationPurpose.CUSTOMER_PHONE ||
    params.purpose === VerificationPurpose.CUSTOMER_LINK_CONSENT;

  if (isCustomerFlow) {
    const slug = params.salonSlug || 'app';
    return `${BASE_URL_CUSTOMER}/c/v/${params.token}?salon=${encodeURIComponent(slug)}`;
  }

  return `${BASE_URL_KEDY}/v/${params.token}`;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export interface CreateVerificationLinkInput {
  purpose: VerificationPurpose;
  channel: VerificationChannel;
  targetIdentityId?: number | null;
  targetSalonId?: number | null;
  targetPhone?: string | null;
  targetEmail?: string | null;
  payload?: Record<string, unknown> | null;
  salonSlug?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * If true, invalidate any other ACTIVE verification links for the same
   * (purpose, target) tuple. Defaults to true — only one link should be
   * usable per target at any given time.
   */
  invalidateExisting?: boolean;
}

export interface CreateVerificationLinkResult {
  id: string;
  token: string;
  link: string;
  expiresAt: Date;
}

export async function createVerificationLink(
  input: CreateVerificationLinkInput,
): Promise<CreateVerificationLinkResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);

  // Invalidate stale active links for the same target (best effort).
  if (input.invalidateExisting !== false) {
    await invalidateExistingActive({
      purpose: input.purpose,
      targetIdentityId: input.targetIdentityId ?? undefined,
      targetSalonId: input.targetSalonId ?? undefined,
      targetPhone: input.targetPhone ?? undefined,
      targetEmail: input.targetEmail ?? undefined,
    });
  }

  // Token collision is statistically impossible (≈ 2^99 keyspace) but the
  // DB has @unique on tokenHash so a rare collision retries.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = generateToken();
    const tokenHash = hashToken(token);
    try {
      const record = await prisma.verificationLink.create({
        data: {
          tokenHash,
          purpose: input.purpose,
          channel: input.channel,
          targetIdentityId: input.targetIdentityId ?? null,
          targetSalonId: input.targetSalonId ?? null,
          targetPhone: input.targetPhone ?? null,
          targetEmail: input.targetEmail ?? null,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          expiresAt,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          deliveryStatus: 'queued',
          lastSentAt: now,
        },
      });

      return {
        id: record.id,
        token,
        link: buildLink({ token, purpose: input.purpose, salonSlug: input.salonSlug }),
        expiresAt: record.expiresAt,
      };
    } catch (error: any) {
      if (error?.code === 'P2002' && attempt < 3) {
        // Unique constraint hit — retry with new token.
        continue;
      }
      throw error;
    }
  }
  throw new Error('verification_link_token_generation_failed');
}

export interface ConsumeContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ConsumedVerification {
  id: string;
  purpose: VerificationPurpose;
  channel: VerificationChannel;
  targetIdentityId: number | null;
  targetSalonId: number | null;
  targetPhone: string | null;
  targetEmail: string | null;
  payload: Record<string, unknown>;
  consumedAt: Date;
}

/**
 * Atomically consume a magic-link token. Returns the verification context.
 * Throws with a typed error code if invalid / expired / already used.
 */
export async function consumeVerificationLink(
  token: string,
  ctx: ConsumeContext = {},
): Promise<ConsumedVerification> {
  if (!token || typeof token !== 'string') {
    throw new VerificationError('VERIFICATION_LINK_INVALID', 'Token is required.');
  }
  const tokenHash = hashToken(token.trim());
  const now = new Date();

  // Use update returning to atomically mark used. Postgres @@unique on
  // tokenHash + the where clause prevents double-use under concurrency.
  const updated = await prisma.verificationLink.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      invalidatedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      usedAt: now,
    },
  });

  if (updated.count === 0) {
    // Diagnose why it failed.
    const found = await prisma.verificationLink.findUnique({ where: { tokenHash } });
    if (!found) {
      throw new VerificationError('VERIFICATION_LINK_NOT_FOUND', 'Geçersiz veya hatalı bağlantı.');
    }
    if (found.usedAt) {
      throw new VerificationError('VERIFICATION_LINK_USED', 'Bu bağlantı zaten kullanıldı.');
    }
    if (found.invalidatedAt) {
      throw new VerificationError('VERIFICATION_LINK_INVALIDATED', 'Bu bağlantı iptal edildi.');
    }
    if (found.expiresAt.getTime() <= now.getTime()) {
      throw new VerificationError('VERIFICATION_LINK_EXPIRED', 'Bu bağlantının süresi doldu.');
    }
    throw new VerificationError('VERIFICATION_LINK_INVALID', 'Bağlantı kullanılamaz.');
  }

  const record = await prisma.verificationLink.findUnique({ where: { tokenHash } });
  if (!record) {
    throw new VerificationError('VERIFICATION_LINK_NOT_FOUND', 'Doğrulama kaydı bulunamadı.');
  }

  // Best-effort: attach IP/UA from the consume request.
  if (ctx.ipAddress || ctx.userAgent) {
    await prisma.verificationLink.update({
      where: { id: record.id },
      data: {
        ipAddress: record.ipAddress || ctx.ipAddress || null,
        userAgent: record.userAgent || ctx.userAgent || null,
      },
    }).catch(() => undefined);
  }

  return {
    id: record.id,
    purpose: record.purpose,
    channel: record.channel,
    targetIdentityId: record.targetIdentityId,
    targetSalonId: record.targetSalonId,
    targetPhone: record.targetPhone,
    targetEmail: record.targetEmail,
    payload: (record.payload as Record<string, unknown>) || {},
    consumedAt: record.usedAt || now,
  };
}

export async function invalidateExistingActive(filter: {
  purpose: VerificationPurpose;
  targetIdentityId?: number;
  targetSalonId?: number;
  targetPhone?: string;
  targetEmail?: string;
}): Promise<void> {
  const where: Prisma.VerificationLinkWhereInput = {
    purpose: filter.purpose,
    usedAt: null,
    invalidatedAt: null,
  };
  if (filter.targetIdentityId) where.targetIdentityId = filter.targetIdentityId;
  if (filter.targetSalonId) where.targetSalonId = filter.targetSalonId;
  if (filter.targetPhone) where.targetPhone = filter.targetPhone;
  if (filter.targetEmail) where.targetEmail = filter.targetEmail;

  await prisma.verificationLink.updateMany({
    where,
    data: { invalidatedAt: new Date() },
  });
}

export async function markDeliveryStatus(
  id: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
): Promise<void> {
  await prisma.verificationLink.update({
    where: { id },
    data: { deliveryStatus: status },
  });
}

export interface VerificationStatusView {
  id: string;
  purpose: VerificationPurpose;
  channel: VerificationChannel;
  state: 'pending' | 'verified' | 'expired' | 'invalidated';
  expiresAt: Date;
  deliveryStatus: string | null;
}

/**
 * Read-only peek at a verification link by token — does NOT consume it.
 * Used by the customer landing page to differentiate the welcome UI for
 * cross-salon (consent) vs first-time (verification) flows.
 */
export async function peekVerificationLink(
  token: string,
): Promise<ConsumedVerification | null> {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token.trim());
  const record = await prisma.verificationLink.findUnique({ where: { tokenHash } });
  if (!record) return null;
  const now = new Date();
  if (record.usedAt) return null;
  if (record.invalidatedAt) return null;
  if (record.expiresAt.getTime() <= now.getTime()) return null;
  return {
    id: record.id,
    purpose: record.purpose,
    channel: record.channel,
    targetIdentityId: record.targetIdentityId,
    targetSalonId: record.targetSalonId,
    targetPhone: record.targetPhone,
    targetEmail: record.targetEmail,
    payload: (record.payload as Record<string, unknown>) || {},
    consumedAt: now,
  };
}

export async function getStatus(id: string): Promise<VerificationStatusView | null> {
  const record = await prisma.verificationLink.findUnique({ where: { id } });
  if (!record) return null;
  const now = new Date();
  let state: VerificationStatusView['state'] = 'pending';
  if (record.usedAt) state = 'verified';
  else if (record.invalidatedAt) state = 'invalidated';
  else if (record.expiresAt.getTime() <= now.getTime()) state = 'expired';
  return {
    id: record.id,
    purpose: record.purpose,
    channel: record.channel,
    state,
    expiresAt: record.expiresAt,
    deliveryStatus: record.deliveryStatus,
  };
}

export async function canResend(id: string): Promise<boolean> {
  const record = await prisma.verificationLink.findUnique({ where: { id } });
  if (!record) return false;
  if (record.usedAt || record.invalidatedAt) return false;
  if (!record.lastSentAt) return true;
  const elapsed = (Date.now() - record.lastSentAt.getTime()) / 1000;
  return elapsed >= RESEND_COOLDOWN_SECONDS;
}

export async function markResent(id: string): Promise<void> {
  await prisma.verificationLink.update({
    where: { id },
    data: {
      sendCount: { increment: 1 },
      lastSentAt: new Date(),
      deliveryStatus: 'queued',
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Error helper
// ─────────────────────────────────────────────────────────────────

export class VerificationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

export const VERIFICATION_TTL_MINUTES = TTL_MINUTES;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = RESEND_COOLDOWN_SECONDS;
