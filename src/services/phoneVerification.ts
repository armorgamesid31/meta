import { ChannelType, CustomerPhoneVerificationPurpose, CustomerPhoneVerificationStatus } from '@prisma/client';
import axios from 'axios';
import { createHash, randomInt } from 'crypto';
import { prisma } from '../prisma.js';
import { normalizeDigitsOnly } from './phoneValidation.js';

const CHAKRA_WHATSAPP_SEND_URL = (process.env.CHAKRA_WHATSAPP_SEND_URL || '').trim();
const CHAKRA_API_TOKEN = (process.env.CHAKRA_API_TOKEN || '').trim();
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_LIMIT = 3;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function resolveSalonWhatsappMeta(salonId: number) {
  return prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      chakraPluginId: true,
      chakraPhoneNumberId: true,
    },
  });
}

async function sendWhatsappCode(params: { salonId: number; phone: string; code: string }) {
  if (!CHAKRA_WHATSAPP_SEND_URL) {
    throw new Error('CHAKRA_WHATSAPP_SEND_URL is missing');
  }

  const salon = await resolveSalonWhatsappMeta(params.salonId);
  if (!salon?.chakraPluginId) {
    throw new Error('Chakra plugin is not connected');
  }

  const to = normalizeDigitsOnly(params.phone);
  if (!to) {
    throw new Error('customer_phone_missing');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CHAKRA_API_TOKEN) {
    headers.Authorization = `Bearer ${CHAKRA_API_TOKEN}`;
  }

  await axios.post(
    CHAKRA_WHATSAPP_SEND_URL,
    {
      pluginId: salon.chakraPluginId,
      phoneNumberId: salon.chakraPhoneNumberId || null,
      to,
      type: 'text',
      text: `KedyApp dogrulama kodunuz: ${params.code}. Bu kod 10 dakika gecerli.`,
    },
    { headers, timeout: 25000 },
  );
}

type VerificationPayload = Record<string, unknown>;

export async function createPhoneVerification(input: {
  salonId: number;
  phone: string;
  countryIso: string;
  purpose: CustomerPhoneVerificationPurpose;
  payload: VerificationPayload;
  customerId?: number | null;
}) {
  const code = generateCode();
  const record = await prisma.customerPhoneVerification.create({
    data: {
      salonId: input.salonId,
      customerId: input.customerId || null,
      purpose: input.purpose,
      deliveryChannel: ChannelType.WHATSAPP,
      countryIso: input.countryIso,
      phone: input.phone,
      status: CustomerPhoneVerificationStatus.PENDING,
      codeHash: hashCode(code),
      payload: input.payload as any,
      maxAttempts: OTP_MAX_ATTEMPTS,
      sendCount: 1,
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      lastSentAt: new Date(),
    },
  });

  await sendWhatsappCode({ salonId: input.salonId, phone: input.phone, code });
  return record;
}

export async function resendPhoneVerification(input: { verificationId: string; salonId: number }) {
  const record = await prisma.customerPhoneVerification.findFirst({
    where: {
      id: input.verificationId,
      salonId: input.salonId,
    },
  });

  if (!record) {
    throw new Error('verification_not_found');
  }
  if (record.status !== CustomerPhoneVerificationStatus.PENDING) {
    throw new Error('verification_not_pending');
  }
  if ((record.sendCount || 0) >= OTP_RESEND_LIMIT) {
    throw new Error('verification_resend_limit_reached');
  }

  const code = generateCode();
  const updated = await prisma.customerPhoneVerification.update({
    where: { id: record.id },
    data: {
      codeHash: hashCode(code),
      sendCount: { increment: 1 },
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      lastSentAt: new Date(),
    },
  });

  await sendWhatsappCode({ salonId: input.salonId, phone: updated.phone, code });
  return updated;
}

export async function verifyPhoneCode(input: { verificationId: string; salonId: number; code: string }) {
  const record = await prisma.customerPhoneVerification.findFirst({
    where: {
      id: input.verificationId,
      salonId: input.salonId,
    },
  });

  if (!record) {
    throw new Error('verification_not_found');
  }
  if (record.status !== CustomerPhoneVerificationStatus.PENDING) {
    throw new Error('verification_not_pending');
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.customerPhoneVerification.update({
      where: { id: record.id },
      data: { status: CustomerPhoneVerificationStatus.EXPIRED },
    });
    throw new Error('verification_expired');
  }
  if ((record.attemptCount || 0) >= (record.maxAttempts || OTP_MAX_ATTEMPTS)) {
    throw new Error('verification_attempt_limit_reached');
  }

  const matches = hashCode(String(input.code || '').trim()) === record.codeHash;
  if (!matches) {
    await prisma.customerPhoneVerification.update({
      where: { id: record.id },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    throw new Error('verification_code_invalid');
  }

  return prisma.customerPhoneVerification.update({
    where: { id: record.id },
    data: {
      status: CustomerPhoneVerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      consumedAt: new Date(),
      lastAttemptAt: new Date(),
    },
  });
}
