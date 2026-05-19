// Feedback service — creates and consumes FEEDBACK-type magic links.
//
// Behavior diverges from BOOKING/RESCHEDULE magic links in two ways:
//   1. **No TTL**: feedback links are valid indefinitely (customer may
//      tap the WA button days after the appointment). Stored as a far-
//      future expiresAt because the schema requires a non-null value.
//   2. **Single-use is strict**: once submitted, usedAt is set and any
//      retry on the same token returns "already submitted".
//
// Form captures two 5-star ratings (service + salon) plus an optional
// free-text review, persisted to Appointment.customerRating /
// Appointment.salonRating / Appointment.customerReview.

import { randomBytes } from 'crypto';
import { ChannelType, MagicLinkType, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
// 50 years — effectively no expiry, but the column requires a value.
const FAR_FUTURE_MS = 50 * 365 * 24 * 60 * 60 * 1000;

function generateToken(length = 18): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

async function createUniqueToken(): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const token = generateToken(18);
    const existing = await prisma.magicLink.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!existing) return token;
  }
  return `${generateToken(14)}${Date.now().toString().slice(-4)}`;
}

export interface CreateFeedbackLinkInput {
  appointmentId: number;
}

export interface FeedbackLink {
  token: string;
  url: string;
}

const FRONTEND_BASE =
  (process.env.FEEDBACK_BASE_URL || process.env.BOOKING_BASE_URL || 'https://web.kedyapp.com')
    .trim()
    .replace(/\/+$/, '');

export async function createFeedbackMagicLink(
  input: CreateFeedbackLinkInput,
): Promise<FeedbackLink> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      id: true,
      salonId: true,
      customerId: true,
      customerPhone: true,
      customerName: true,
    },
  });
  if (!appointment) throw new Error('appointment_not_found');

  // Reuse an active feedback link for the same appointment if one exists.
  const existing = await prisma.magicLink.findFirst({
    where: {
      salonId: appointment.salonId,
      type: 'FEEDBACK',
      status: 'ACTIVE',
      usedAt: null,
      context: { path: ['appointmentId'], equals: appointment.id },
    },
    select: { token: true },
  });
  if (existing) {
    return { token: existing.token, url: `${FRONTEND_BASE}/feedback/${existing.token}` };
  }

  // Resolve an IdentitySession to satisfy the FK. Reuse the most recent
  // ACTIVE session for this customer on this salon, or create a stub one.
  const phone = String(appointment.customerPhone || '').replace(/\D/g, '');
  const subjectNormalized = phone || `appointment-${appointment.id}`;

  const session = await prisma.identitySession.findFirst({
    where: {
      salonId: appointment.salonId,
      subjectNormalized,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!session) {
    // Highly unusual but possible for legacy customers — create one.
    const created = await prisma.identitySession.create({
      data: {
        salonId: appointment.salonId,
        channel: ChannelType.WHATSAPP,
        subjectType: 'PHONE',
        subjectRaw: appointment.customerPhone,
        subjectNormalized,
        customerId: appointment.customerId || null,
        canonicalUserId: appointment.customerId ? `customer:${appointment.customerId}` : null,
      },
      select: { id: true },
    });
    session as any;
    return await mintLink(created.id, appointment, subjectNormalized);
  }

  return await mintLink(session.id, appointment, subjectNormalized);
}

async function mintLink(
  sessionId: string,
  appointment: { id: number; salonId: number; customerId: number | null; customerPhone: string; customerName: string },
  subjectNormalized: string,
): Promise<FeedbackLink> {
  const token = await createUniqueToken();
  const expiresAt = new Date(Date.now() + FAR_FUTURE_MS);

  const context: Prisma.InputJsonValue = {
    kind: 'feedback',
    appointmentId: appointment.id,
    salonId: appointment.salonId,
    customerId: appointment.customerId,
  };

  await prisma.magicLink.create({
    data: {
      token,
      phone: appointment.customerPhone,
      type: MagicLinkType.FEEDBACK,
      status: 'ACTIVE',
      context,
      salonId: appointment.salonId,
      channel: ChannelType.WHATSAPP,
      subjectType: 'PHONE',
      subjectNormalized,
      identitySessionId: sessionId,
      expiresAt,
      usedByCustomerId: appointment.customerId || null,
    },
  });

  return { token, url: `${FRONTEND_BASE}/feedback/${token}` };
}

export interface FeedbackContext {
  appointmentId: number;
  salonId: number;
  salonName: string;
  serviceName: string;
  staffName: string;
  appointmentDate: Date;
  customerName: string;
  alreadySubmitted: boolean;
  existingServiceRating?: number | null;
  existingSalonRating?: number | null;
}

export async function getFeedbackContext(token: string): Promise<FeedbackContext> {
  if (!token) throw new Error('feedback_token_required');

  const link = await prisma.magicLink.findUnique({
    where: { token },
    include: {
      salon: { select: { id: true, name: true } },
    },
  });
  if (!link) throw new Error('feedback_link_not_found');
  if (link.type !== 'FEEDBACK') throw new Error('feedback_link_wrong_type');
  if (link.status === 'REVOKED') throw new Error('feedback_link_revoked');

  const ctx = (link.context as any) || {};
  const appointmentId = Number(ctx.appointmentId || 0);
  if (!appointmentId) throw new Error('feedback_context_invalid');

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      service: { select: { name: true } },
      staff: { select: { firstName: true, lastName: true } },
    },
  });
  if (!appointment) throw new Error('feedback_appointment_not_found');

  return {
    appointmentId: appointment.id,
    salonId: appointment.salonId,
    salonName: link.salon.name,
    serviceName: appointment.service?.name || '',
    staffName: [appointment.staff?.firstName, appointment.staff?.lastName].filter(Boolean).join(' ').trim(),
    appointmentDate: appointment.startTime,
    customerName: appointment.customerName,
    alreadySubmitted: Boolean(link.usedAt),
    existingServiceRating: appointment.customerRating,
    existingSalonRating: appointment.salonRating,
  };
}

export interface SubmitFeedbackInput {
  token: string;
  serviceRating: number; // 1..5
  salonRating: number; // 1..5
  comment?: string | null;
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<{ ok: true }> {
  if (!input.token) throw new Error('feedback_token_required');
  if (!Number.isInteger(input.serviceRating) || input.serviceRating < 1 || input.serviceRating > 5) {
    throw new Error('feedback_service_rating_invalid');
  }
  if (!Number.isInteger(input.salonRating) || input.salonRating < 1 || input.salonRating > 5) {
    throw new Error('feedback_salon_rating_invalid');
  }

  const now = new Date();

  // Atomic consume: only update if still ACTIVE + unused.
  const updated = await prisma.magicLink.updateMany({
    where: {
      token: input.token,
      type: 'FEEDBACK',
      status: 'ACTIVE',
      usedAt: null,
    },
    data: {
      usedAt: now,
      status: 'USED',
    },
  });
  if (updated.count === 0) {
    const found = await prisma.magicLink.findUnique({ where: { token: input.token } });
    if (!found) throw new Error('feedback_link_not_found');
    if (found.usedAt) throw new Error('feedback_already_submitted');
    if (found.status === 'REVOKED') throw new Error('feedback_link_revoked');
    throw new Error('feedback_link_invalid');
  }

  const link = await prisma.magicLink.findUnique({ where: { token: input.token } });
  const appointmentId = Number((link?.context as any)?.appointmentId || 0);
  if (!appointmentId) throw new Error('feedback_context_invalid');

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      customerRating: input.serviceRating,
      salonRating: input.salonRating,
      customerReview: input.comment ? input.comment.slice(0, 2000) : null,
      customerReviewedAt: now,
    },
  });

  return { ok: true };
}
