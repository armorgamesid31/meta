/**
 * Lead capture lifecycle.
 *
 *   createLead(input)  — marketing form submitted (POST /api/leads)
 *     1. Normalize email + phone, validate
 *     2. Persist Lead row with a fresh activation token (raw → email, hash → DB)
 *     3. Fire n8n webhook (best-effort, async)
 *     4. Send activation email to the salon owner
 *     5. Mark INVITED
 *
 *   previewLead(rawToken) — public, used by the activation page to
 *     prefill the form (no password change yet, just show name/email)
 *
 *   activateLead(rawToken, password) — owner clicked the link, set password
 *     1. Validate token + TTL + status
 *     2. Run the same flow /api/auth/register-salon uses:
 *        create Salon → SalonUser → UserIdentity → SalonMembership →
 *        ensureSalonServiceCategories → ensureSalonAccessSeed →
 *        startSetupPeriod → issue JWT pair
 *     3. Mark Lead ACTIVATED, link to the new Salon
 *     4. Return tokens so the marketing/admin page can redirect into the app
 */

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import axios from 'axios';
import { LeadStatus, SalonCategory, UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import { createAuthTokens } from './mobileAuth.js';
import { ensureSalonServiceCategories } from './salonCategorySetup.js';
import { ensureSalonAccessSeed } from './accessControl.js';
import { startSetupPeriod } from './onboarding/lifecycle.js';
import { sendVerificationEmail, isEmailConfigured } from './emailService.js';
import { normalizeDigitsOnly } from './phoneValidation.js';
import { BusinessError } from '../lib/errors.js';

const LEAD_TTL_DAYS = 14;
const TOKEN_BYTES = 24;

const LEAD_ACTIVATION_BASE_URL =
  (process.env.LEAD_ACTIVATION_BASE_URL ||
    process.env.VERIFICATION_BASE_URL_KEDY ||
    'https://kedyapp.com')
    .trim()
    .replace(/\/+$/, '');

const N8N_LEAD_WEBHOOK_URL = (process.env.LEAD_CREATED_WEBHOOK_URL || '').trim();

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function normalizeEmail(input: string): string {
  return String(input || '').trim().toLowerCase();
}

function normalizePhone(input: string): string {
  // Keep + prefix if present, otherwise digits-only. We don't try to
  // do E.164 inference here — the form is Turkish so most numbers
  // come as 0XXXXXXXXXX; normalizeDigitsOnly strips non-digits.
  const digits = normalizeDigitsOnly(input || '');
  return digits;
}

export interface CreateLeadInput {
  contactName: string;
  phone: string;
  email: string;
  salonName: string;
  salonCategory?: SalonCategory | null;
  acceptMarketing?: boolean;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateLeadResult {
  leadId: number;
  status: LeadStatus;
  /** True when both the activation email AND the n8n webhook fired ok. */
  delivered: boolean;
  emailSent: boolean;
  webhookSent: boolean;
}

export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  const contactName = String(input.contactName || '').trim();
  const salonName = String(input.salonName || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || '').trim();

  if (contactName.length < 2 || contactName.length > 80) {
    throw new BusinessError('VALIDATION_FAILED', 'İsim 2-80 karakter arası olmalı.', 400);
  }
  if (salonName.length < 2 || salonName.length > 120) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon adı 2-120 karakter arası olmalı.', 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçerli bir e-posta girin.', 400);
  }
  const phoneNormalized = normalizePhone(phone);
  if (phoneNormalized.length < 9 || phoneNormalized.length > 15) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçerli bir telefon numarası girin.', 400);
  }
  const emailNormalized = normalizeEmail(email);

  // Soft-dedupe: if a NEW or INVITED lead with the same email exists
  // in the last 7 days, reuse it (renew the token, resend the email)
  // instead of cluttering the table with re-submissions. Once the lead
  // is ACTIVATED or EXPIRED we let a new row through.
  const reuseWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const reusable = await prisma.lead.findFirst({
    where: {
      emailNormalized,
      status: { in: [LeadStatus.NEW, LeadStatus.INVITED] },
      createdAt: { gte: reuseWindow },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + LEAD_TTL_DAYS * 24 * 60 * 60 * 1000);

  let leadId: number;
  if (reusable) {
    const updated = await prisma.lead.update({
      where: { id: reusable.id },
      data: {
        contactName,
        salonName,
        salonCategory: input.salonCategory ?? null,
        phone,
        phoneNormalized,
        acceptMarketing: Boolean(input.acceptMarketing),
        utmSource: input.utmSource || reusable.utmSource,
        utmMedium: input.utmMedium || reusable.utmMedium,
        utmCampaign: input.utmCampaign || reusable.utmCampaign,
        utmContent: input.utmContent || reusable.utmContent,
        utmTerm: input.utmTerm || reusable.utmTerm,
        referrer: input.referrer || reusable.referrer,
        landingPath: input.landingPath || reusable.landingPath,
        ipAddress: input.ipAddress || reusable.ipAddress,
        userAgent: input.userAgent || reusable.userAgent,
        activationTokenHash: tokenHash,
        expiresAt,
        status: LeadStatus.NEW,
      },
    });
    leadId = updated.id;
  } else {
    const created = await prisma.lead.create({
      data: {
        contactName,
        salonName,
        salonCategory: input.salonCategory ?? null,
        phone,
        phoneNormalized,
        email,
        emailNormalized,
        acceptMarketing: Boolean(input.acceptMarketing),
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || null,
        utmContent: input.utmContent || null,
        utmTerm: input.utmTerm || null,
        referrer: input.referrer || null,
        landingPath: input.landingPath || null,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
        activationTokenHash: tokenHash,
        expiresAt,
        status: LeadStatus.NEW,
      },
    });
    leadId = created.id;
  }

  // Fire n8n webhook (non-blocking). We do this BEFORE sending the
  // email so n8n already has the row when the user is in their inbox
  // (handy for "lead landed" notifications to the sales operator).
  const webhookSent = await sendLeadWebhook(leadId, {
    event: 'lead.created',
    leadId,
    contactName,
    phone,
    email,
    salonName,
    salonCategory: input.salonCategory || null,
    utm: {
      source: input.utmSource || null,
      medium: input.utmMedium || null,
      campaign: input.utmCampaign || null,
      content: input.utmContent || null,
      term: input.utmTerm || null,
    },
    referrer: input.referrer || null,
    landingPath: input.landingPath || null,
    createdAt: new Date().toISOString(),
  });

  // Send activation email (this is the link the user actually clicks).
  const emailSent = await sendActivationEmail(leadId, {
    email,
    contactName,
    salonName,
    rawToken,
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: emailSent ? LeadStatus.INVITED : LeadStatus.NEW,
      activationLinkSentAt: emailSent ? new Date() : null,
      activationLinkSendCount: { increment: emailSent ? 1 : 0 },
    },
  });

  return {
    leadId,
    status: emailSent ? LeadStatus.INVITED : LeadStatus.NEW,
    delivered: emailSent && webhookSent,
    emailSent,
    webhookSent,
  };
}

async function sendLeadWebhook(leadId: number, payload: Record<string, unknown>): Promise<boolean> {
  if (!N8N_LEAD_WEBHOOK_URL) {
    // Webhook not configured — that's fine, mark as "skipped".
    return true;
  }
  try {
    await axios.post(N8N_LEAD_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': process.env.N8N_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '',
      },
      timeout: 10_000,
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { webhookSentAt: new Date(), webhookLastError: null },
    });
    return true;
  } catch (error: any) {
    const reason = error?.response?.data?.message || error?.message || 'unknown_error';
    console.error('[leadService] webhook send failed', { leadId, reason });
    await prisma.lead
      .update({
        where: { id: leadId },
        data: { webhookLastError: String(reason).slice(0, 500) },
      })
      .catch(() => null);
    return false;
  }
}

async function sendActivationEmail(
  leadId: number,
  input: { email: string; contactName: string; salonName: string; rawToken: string },
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[leadService] email provider not configured — skipping send');
    await prisma.lead
      .update({
        where: { id: leadId },
        data: { activationLastError: 'email_provider_not_configured' },
      })
      .catch(() => null);
    return false;
  }
  const link = `${LEAD_ACTIVATION_BASE_URL}/baslayalim/${input.rawToken}`;
  try {
    await sendVerificationEmail({
      to: input.email,
      name: input.contactName,
      actionLabel: 'Kedy hesabını aktifleştirme',
      link,
      ttlMinutes: LEAD_TTL_DAYS * 24 * 60,
    });
    return true;
  } catch (error: any) {
    const reason = error?.message || 'unknown_error';
    console.error('[leadService] activation email send failed', { leadId, reason });
    await prisma.lead
      .update({
        where: { id: leadId },
        data: { activationLastError: String(reason).slice(0, 500) },
      })
      .catch(() => null);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Activation: previewLead + activateLead
// -----------------------------------------------------------------------------

export interface LeadPreview {
  ok: true;
  contactName: string;
  salonName: string;
  email: string;
  phone: string;
  salonCategory: SalonCategory | null;
  expiresAt: string;
}

export async function previewLead(rawToken: string): Promise<LeadPreview> {
  const hash = hashToken(String(rawToken || '').trim());
  if (!hash) throw new BusinessError('VALIDATION_FAILED', 'Geçersiz link.', 400);
  const lead = await prisma.lead.findUnique({ where: { activationTokenHash: hash } });
  if (!lead) throw new BusinessError('NOT_FOUND', 'Bu link bulunamadı veya süresi doldu.', 404);
  if (lead.status === LeadStatus.ACTIVATED) {
    throw new BusinessError(
      'LEAD_ALREADY_ACTIVATED',
      'Bu link daha önce kullanıldı. Lütfen normal giriş ekranından devam edin.',
      409,
    );
  }
  if (lead.status === LeadStatus.BLOCKED) {
    throw new BusinessError('LEAD_BLOCKED', 'Bu kayıt engellenmiş.', 403);
  }
  if (lead.expiresAt < new Date()) {
    await prisma.lead
      .update({ where: { id: lead.id }, data: { status: LeadStatus.EXPIRED } })
      .catch(() => null);
    throw new BusinessError('LEAD_EXPIRED', 'Bu linkin süresi dolmuş. Lütfen yeni bir başvuru yapın.', 410);
  }
  return {
    ok: true,
    contactName: lead.contactName,
    salonName: lead.salonName,
    email: lead.email,
    phone: lead.phone,
    salonCategory: lead.salonCategory,
    expiresAt: lead.expiresAt.toISOString(),
  };
}

export interface ActivateLeadResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    email: string;
    role: UserRole;
    salonId: number;
    membershipId: number;
  };
}

export async function activateLead(input: {
  rawToken: string;
  password: string;
}): Promise<ActivateLeadResult> {
  const hash = hashToken(String(input.rawToken || '').trim());
  const lead = await prisma.lead.findUnique({ where: { activationTokenHash: hash } });
  if (!lead) throw new BusinessError('NOT_FOUND', 'Geçersiz link.', 404);
  if (lead.status === LeadStatus.ACTIVATED) {
    throw new BusinessError(
      'LEAD_ALREADY_ACTIVATED',
      'Bu hesap zaten aktif. Lütfen giriş yapın.',
      409,
    );
  }
  if (lead.status === LeadStatus.BLOCKED) {
    throw new BusinessError('LEAD_BLOCKED', 'Bu kayıt engellenmiş.', 403);
  }
  if (lead.expiresAt < new Date()) {
    await prisma.lead
      .update({ where: { id: lead.id }, data: { status: LeadStatus.EXPIRED } })
      .catch(() => null);
    throw new BusinessError('LEAD_EXPIRED', 'Linkin süresi dolmuş.', 410);
  }
  if (!input.password || input.password.length < 8) {
    throw new BusinessError('VALIDATION_FAILED', 'Şifre en az 8 karakter olmalı.', 400);
  }

  // Defensive check: another account may have been created with the
  // same email since the lead was captured. If so, point the user to
  // the login screen instead of creating a duplicate.
  const existingIdentity = await prisma.userIdentity.findFirst({
    where: { email: lead.emailNormalized },
    select: { id: true },
  });
  if (existingIdentity) {
    throw new BusinessError(
      'CONFLICT',
      'Bu e-posta ile zaten bir hesap var. Giriş yapın veya şifrenizi sıfırlayın.',
      409,
    );
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  // Mirror the /api/auth/register-salon flow exactly so any future
  // additions there get picked up here too if we refactor it into a
  // shared service. (For now we duplicate consciously to keep blast
  // radius small.)
  const salon = await prisma.salon.create({
    data: {
      name: lead.salonName,
      category: lead.salonCategory || undefined,
    },
  });

  const legacyUser = await prisma.salonUser.create({
    data: {
      salonId: salon.id,
      email: lead.emailNormalized,
      phone: lead.phoneNormalized || null,
      firstName: lead.contactName.split(' ')[0] || null,
      lastName: lead.contactName.split(' ').slice(1).join(' ') || null,
      displayName: lead.contactName || null,
      passwordHash,
      role: UserRole.OWNER,
      isActive: true,
    },
  });

  const identity = await prisma.userIdentity.create({
    data: {
      email: lead.emailNormalized,
      phone: lead.phoneNormalized || null,
      firstName: lead.contactName.split(' ')[0] || null,
      lastName: lead.contactName.split(' ').slice(1).join(' ') || null,
      displayName: lead.contactName || null,
      passwordHash,
      isActive: true,
      emailVerifiedAt: new Date(), // came through email link, treat as verified
    },
  });

  const membership = await prisma.salonMembership.create({
    data: {
      salonId: salon.id,
      identityId: identity.id,
      role: UserRole.OWNER,
      isActive: true,
      legacySalonUserId: legacyUser.id,
    },
  });

  try {
    await ensureSalonServiceCategories(salon.id);
  } catch (err) {
    console.error('[leadService] category seed warning', err);
  }
  try {
    await ensureSalonAccessSeed(salon.id);
  } catch (err) {
    console.error('[leadService] access seed warning', err);
  }
  try {
    await startSetupPeriod(salon.id);
  } catch (err) {
    console.error('[leadService] setup period start warning', err);
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: LeadStatus.ACTIVATED,
      activatedAt: new Date(),
      activatedSalonId: salon.id,
    },
  });

  const { accessToken, refreshToken } = await createAuthTokens({
    legacyUserId: legacyUser.id,
    membershipId: membership.id,
    identityId: identity.id,
    salonId: salon.id,
    role: membership.role as string,
  } as any);

  return {
    accessToken,
    refreshToken,
    user: {
      id: identity.id,
      email: identity.email || lead.emailNormalized,
      role: membership.role as UserRole,
      salonId: salon.id,
      membershipId: membership.id,
    },
  };
}
