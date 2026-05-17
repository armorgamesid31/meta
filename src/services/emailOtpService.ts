// Minimal email OTP helper used by the team-invite activation flow.
//
// Mirrors the structure of phoneVerification.ts but skips the per-salon
// constraint (a teammate's email isn't necessarily attached to a salon
// yet at the moment we send the code) and writes to a dedicated
// EmailOtpVerification table so phone analytics don't get muddied.

import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import { sendVerificationCodeEmail, isEmailConfigured } from './emailService.js';

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_LIMIT = 5;
const OTP_MAX_ATTEMPTS = 5;

function generateCode(): string {
  // 6-digit zero-padded.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export async function createEmailOtp(input: {
  email: string;
  salonId?: number | null;
  purpose?: string;
  name?: string | null;
}) {
  if (!isEmailConfigured()) {
    throw new Error('email_provider_not_configured');
  }
  const email = normalizeEmail(input.email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('email_invalid');
  }

  const code = generateCode();
  const record = await prisma.emailOtpVerification.create({
    data: {
      salonId: input.salonId ?? null,
      email,
      codeHash: hashCode(code),
      purpose: input.purpose || 'INVITE_EMAIL',
      status: 'PENDING',
      maxAttempts: OTP_MAX_ATTEMPTS,
      sendCount: 1,
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      lastSentAt: new Date(),
    },
  });

  await sendVerificationCodeEmail({
    to: email,
    name: input.name || null,
    code,
    ttlMinutes: OTP_TTL_MINUTES,
  });

  return record;
}

export async function resendEmailOtp(input: { verificationId: string }) {
  const record = await prisma.emailOtpVerification.findUnique({
    where: { id: input.verificationId },
  });
  if (!record) throw new Error('verification_not_found');
  if (record.status !== 'PENDING') throw new Error('verification_not_pending');
  if ((record.sendCount || 0) >= OTP_RESEND_LIMIT) {
    throw new Error('verification_resend_limit_reached');
  }

  const code = generateCode();
  const updated = await prisma.emailOtpVerification.update({
    where: { id: record.id },
    data: {
      codeHash: hashCode(code),
      sendCount: { increment: 1 },
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      lastSentAt: new Date(),
    },
  });

  await sendVerificationCodeEmail({
    to: record.email,
    name: null,
    code,
    ttlMinutes: OTP_TTL_MINUTES,
  });
  return updated;
}

export async function verifyEmailOtp(input: { verificationId: string; code: string }) {
  const record = await prisma.emailOtpVerification.findUnique({
    where: { id: input.verificationId },
  });
  if (!record) throw new Error('verification_not_found');
  if (record.status !== 'PENDING') throw new Error('verification_not_pending');
  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.emailOtpVerification.update({
      where: { id: record.id },
      data: { status: 'EXPIRED' },
    });
    throw new Error('verification_expired');
  }
  if ((record.attemptCount || 0) >= (record.maxAttempts || OTP_MAX_ATTEMPTS)) {
    throw new Error('verification_attempt_limit_reached');
  }

  const matches = hashCode(String(input.code || '').trim()) === record.codeHash;
  if (!matches) {
    await prisma.emailOtpVerification.update({
      where: { id: record.id },
      data: { attemptCount: { increment: 1 } },
    });
    throw new Error('verification_code_invalid');
  }

  return prisma.emailOtpVerification.update({
    where: { id: record.id },
    data: { status: 'VERIFIED', verifiedAt: new Date() },
  });
}

export async function isEmailVerificationConsumed(verificationId: string, email: string): Promise<boolean> {
  if (!verificationId) return false;
  const record = await prisma.emailOtpVerification.findUnique({
    where: { id: verificationId },
  });
  if (!record) return false;
  if (record.status !== 'VERIFIED') return false;
  return normalizeEmail(record.email) === normalizeEmail(email);
}
