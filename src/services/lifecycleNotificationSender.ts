// lifecycleNotificationSender — per-template-type orchestrator.
//
// Called from internal HTTP endpoints that n8n hits hourly. Each function:
//   1. Resolves context (customer + salon + appointment + salon offer)
//   2. Checks preconditions (acceptMarketing for marketing templates,
//      salon WABA, salon offer config, dedup window)
//   3. Sends via the generic WhatsApp template sender
//   4. Logs to NotificationLog on success (for n8n dedup query)
//
// All functions return a NotificationResult so n8n can branch.

import { prisma } from '../prisma.js';
import {
  resolveTemplateContext,
  getBirthdayOfferConfig,
  getWinbackOfferConfig,
} from './templateContextResolver.js';
import { sendTemplate } from './whatsappTemplateSender.js';
import { createFeedbackMagicLink } from './feedbackService.js';

export type NotificationKind =
  | 'CONFIRMATION'
  | 'REMINDER_1_DAY'
  | 'REMINDER_3_DAY'
  | 'REMINDER_2_HOUR'
  | 'NO_SHOW'
  | 'SATISFACTION_SURVEY'
  | 'GOOGLE_MAPS_REVIEW'
  | 'WAITLIST_OFFER'
  | 'BIRTHDAY'
  | 'WINBACK';

export interface NotificationResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  messageId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Dedup helper
// ─────────────────────────────────────────────────────────────────

async function alreadySentRecently(
  kind: NotificationKind,
  customerId: number,
  appointmentId: number | null,
  withinHours: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);
  const where: any = { type: kind, sentAt: { gt: cutoff } };
  if (appointmentId) where.appointmentId = appointmentId;
  else where.customerId = customerId;
  const existing = await prisma.notificationLog.findFirst({ where });
  return Boolean(existing);
}

async function logSent(
  kind: NotificationKind,
  customerId: number | null,
  appointmentId: number | null,
): Promise<void> {
  await prisma.notificationLog.create({
    data: {
      type: kind,
      customerId: customerId || null,
      appointmentId: appointmentId || null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Appointment-bound notifications
// ─────────────────────────────────────────────────────────────────

interface AppointmentInput {
  salonId: number;
  customerId: number;
  appointmentId: number;
}

async function sendAppointmentBound(
  kind: NotificationKind,
  templateName: string,
  input: AppointmentInput,
  options: {
    dedupHours?: number;
    buttons?: Array<{ type: 'url' | 'quick_reply'; value: string }>;
  } = {},
): Promise<NotificationResult> {
  const dedupHours = options.dedupHours ?? 12;
  if (await alreadySentRecently(kind, input.customerId, input.appointmentId, dedupHours)) {
    return { ok: true, skipped: true, reason: 'dedup_recent_send' };
  }

  const ctx = await resolveTemplateContext({
    salonId: input.salonId,
    customerId: input.customerId,
    appointmentId: input.appointmentId,
  });

  if (!ctx.salonWabaReady) return { ok: false, reason: 'salon_waba_not_connected' };
  if (!ctx.recipientPhone) return { ok: false, reason: 'recipient_phone_missing' };

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams: options.buttons,
  });

  if (result.ok) {
    await logSent(kind, input.customerId, input.appointmentId);
  }
  return result;
}

export function sendAppointmentConfirmation(input: AppointmentInput) {
  return sendAppointmentBound('CONFIRMATION', 'kedy_randevu_onay', input, { dedupHours: 48 });
}

export function sendReminder1Day(input: AppointmentInput) {
  return sendAppointmentBound('REMINDER_1_DAY', 'kedy_randevu_hatirlatma_1_gun', input);
}

export function sendReminder3Day(input: AppointmentInput) {
  return sendAppointmentBound('REMINDER_3_DAY', 'kedy_randevu_hatirlatma_3_gun', input);
}

export function sendReminder2Hour(input: AppointmentInput) {
  return sendAppointmentBound('REMINDER_2_HOUR', 'kedy_randevu_hatirlatma_2_saat', input);
}

export function sendNoShow(input: AppointmentInput) {
  return sendAppointmentBound('NO_SHOW', 'kedy_no_show_hatirlatma', input);
}

// ─────────────────────────────────────────────────────────────────
// Satisfaction survey — uses feedback magic link as button URL
// ─────────────────────────────────────────────────────────────────

export async function sendSatisfactionSurvey(input: AppointmentInput): Promise<NotificationResult> {
  const kind: NotificationKind = 'SATISFACTION_SURVEY';
  if (await alreadySentRecently(kind, input.customerId, input.appointmentId, 24 * 30)) {
    // 30 days — feedback link is single-use, no need to re-send
    return { ok: true, skipped: true, reason: 'dedup_recent_send' };
  }

  const ctx = await resolveTemplateContext({
    salonId: input.salonId,
    customerId: input.customerId,
    appointmentId: input.appointmentId,
  });
  if (!ctx.salonWabaReady) return { ok: false, reason: 'salon_waba_not_connected' };
  if (!ctx.recipientPhone) return { ok: false, reason: 'recipient_phone_missing' };

  // Mint a feedback magic link — single-use, no TTL
  const link = await createFeedbackMagicLink({ appointmentId: input.appointmentId });

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName: 'kedy_memnuniyet_anketi',
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams: [{ type: 'url', value: link.token }],
  });

  if (result.ok) await logSent(kind, input.customerId, input.appointmentId);
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Google Maps review — one-shot per customer per salon
// ─────────────────────────────────────────────────────────────────

export async function sendGoogleMapsReview(input: {
  salonId: number;
  customerId: number;
}): Promise<NotificationResult> {
  // Guard: one-shot using Customer.googleReviewRequestedAt
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { googleReviewRequestedAt: true, phone: true },
  });
  if (!customer) return { ok: false, reason: 'customer_not_found' };
  if (customer.googleReviewRequestedAt) {
    return { ok: true, skipped: true, reason: 'already_requested' };
  }

  const ctx = await resolveTemplateContext({
    salonId: input.salonId,
    customerId: input.customerId,
  });
  if (!ctx.salonWabaReady) return { ok: false, reason: 'salon_waba_not_connected' };
  if (!ctx.recipientPhone) return { ok: false, reason: 'recipient_phone_missing' };

  const salonWithMaps = await prisma.salon.findUnique({
    where: { id: input.salonId },
    select: { googleMapsUrl: true },
  });
  if (!salonWithMaps?.googleMapsUrl) {
    return { ok: false, reason: 'salon_google_maps_url_missing' };
  }

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName: 'kedy_google_maps_yorum',
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams: [{ type: 'url', value: salonWithMaps.googleMapsUrl }],
  });

  if (result.ok) {
    await prisma.customer.update({
      where: { id: input.customerId },
      data: { googleReviewRequestedAt: new Date() },
    });
    await logSent('GOOGLE_MAPS_REVIEW', input.customerId, null);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Birthday (MARKETING)
// ─────────────────────────────────────────────────────────────────

export async function sendBirthday(input: {
  salonId: number;
  customerId: number;
}): Promise<NotificationResult> {
  const kind: NotificationKind = 'BIRTHDAY';
  // Once per year per (customer, salon)
  if (await alreadySentRecently(kind, input.customerId, null, 24 * 300)) {
    return { ok: true, skipped: true, reason: 'dedup_already_sent_this_year' };
  }

  const offer = await getBirthdayOfferConfig(input.salonId);
  if (!offer.enabled) return { ok: true, skipped: true, reason: 'salon_offer_not_configured' };

  const ctx = await resolveTemplateContext({
    salonId: input.salonId,
    customerId: input.customerId,
    extra: {
      discount_amount: offer.discountText,
      validity_period: offer.validityText,
    },
  });

  if (!ctx.acceptMarketing) return { ok: true, skipped: true, reason: 'customer_marketing_opt_out' };
  if (!ctx.salonWabaReady) return { ok: false, reason: 'salon_waba_not_connected' };
  if (!ctx.recipientPhone) return { ok: false, reason: 'recipient_phone_missing' };

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName: 'kedy_dogum_gunu_kutlamasi',
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
  });

  if (result.ok) await logSent(kind, input.customerId, null);
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Winback (MARKETING)
// ─────────────────────────────────────────────────────────────────

export async function sendWinback(input: {
  salonId: number;
  customerId: number;
}): Promise<NotificationResult> {
  const kind: NotificationKind = 'WINBACK';
  // 30 days dedup
  if (await alreadySentRecently(kind, input.customerId, null, 24 * 30)) {
    return { ok: true, skipped: true, reason: 'dedup_recent_send' };
  }

  const offer = await getWinbackOfferConfig(input.salonId);
  if (!offer.enabled) return { ok: true, skipped: true, reason: 'salon_offer_not_configured' };

  const ctx = await resolveTemplateContext({
    salonId: input.salonId,
    customerId: input.customerId,
    extra: {
      discount_amount: offer.discountText,
      validity_period: offer.validityText,
    },
  });

  if (!ctx.acceptMarketing) return { ok: true, skipped: true, reason: 'customer_marketing_opt_out' };
  if (!ctx.salonWabaReady) return { ok: false, reason: 'salon_waba_not_connected' };
  if (!ctx.recipientPhone) return { ok: false, reason: 'recipient_phone_missing' };

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName: 'kedy_geri_donus',
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
  });

  if (result.ok) await logSent(kind, input.customerId, null);
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Waitlist offer — token comes from caller (WaitlistOffer.token)
// ─────────────────────────────────────────────────────────────────

export async function sendWaitlistOfferTemplate(input: {
  salonId: number;
  customerId: number;
  offerToken: string;
}): Promise<NotificationResult> {
  const ctx = await resolveTemplateContext({
    salonId: input.salonId,
    customerId: input.customerId,
  });
  if (!ctx.salonWabaReady) return { ok: false, reason: 'salon_waba_not_connected' };
  if (!ctx.recipientPhone) return { ok: false, reason: 'recipient_phone_missing' };

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName: 'kedy_waitlist_teklif',
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams: [{ type: 'url', value: input.offerToken }],
  });

  if (result.ok) await logSent('WAITLIST_OFFER', input.customerId, null);
  return result;
}
