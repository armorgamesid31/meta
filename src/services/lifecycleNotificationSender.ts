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
import { pickTemplateForSend } from './salonTemplateSubmitter.js';
import { createFeedbackMagicLink } from './feedbackService.js';

export type NotificationKind =
  // CONFIRMATION retired with kdy_randevu_onay
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

// Resolve the salon slug that fills the {{1}} placeholder in URL buttons
// (e.g. https://api.kedyapp.com/r/booking/{{1}} → r/booking/bella-studio).
async function resolveSalonSlug(salonId: number): Promise<string | null> {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { slug: true },
  });
  return salon?.slug?.trim().toLowerCase() || null;
}

// Logical-key → buttonParams resolver. Returns the buttonParams array to
// pass to sendTemplate, populating the {{1}} URL placeholder per template.
async function buildButtonParamsForLogicalKey(
  salonId: number,
  logicalKey: string,
): Promise<Array<{ type: 'url' | 'quick_reply'; value: string }> | undefined> {
  const slugButtons = new Set([
    'kdy_randevu_hatirlatma_2_saat', // Yol Tarifi → /r/maps/:slug
    'kdy_no_show_hatirlatma',         // Yeni Randevu Al → /r/booking/:slug
    'kdy_dogum_gunu_kutlamasi',       // Randevu Al → /r/booking/:slug
    'kdy_geri_donus',                 // Randevu Al → /r/booking/:slug
    'kdy_google_maps_yorum',          // Google'da Yorum Yap → /r/maps/:slug
  ]);
  if (!slugButtons.has(logicalKey)) return undefined;

  const slug = await resolveSalonSlug(salonId);
  if (!slug) return undefined;
  return [{ type: 'url', value: slug }];
}

async function sendAppointmentBound(
  kind: NotificationKind,
  logicalKey: string,
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

  // Resolve logical key to a tone-appropriate approved Meta template name.
  const templateName = await pickTemplateForSend({ salonId: input.salonId, logicalKey });
  if (!templateName) return { ok: false, reason: 'no_approved_template_variation' };

  // If caller passed explicit buttons, use them; otherwise derive from the
  // logical key (slug-based URL button injection for the standard set).
  const buttonParams = options.buttons ?? (await buildButtonParamsForLogicalKey(input.salonId, logicalKey));

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams,
    conversationDisplayText: renderHumanDisplayText(kind, ctx.params),
    conversationMetadata: {
      kind,
      customerId: input.customerId,
      appointmentId: input.appointmentId,
      logicalKey,
      templateName,
    },
  });

  if (result.ok) {
    await logSent(kind, input.customerId, input.appointmentId);
  }
  return result;
}

// Map lifecycle kinds → human-readable bubble preview for the salon's
// chat thread. Falls back to the generic "[Şablon: ...]" placeholder
// from whatsappTemplateSender if a kind isn't mapped here.
function renderHumanDisplayText(
  kind: NotificationKind,
  bodyParams: Record<string, string>,
): string | undefined {
  const customerFirst = (bodyParams.customer_first_name || bodyParams.customer_name || '').trim();
  const start = (bodyParams.start_time_human || bodyParams.appointment_time || '').trim();
  const service = (bodyParams.service_name || '').trim();
  const greet = customerFirst ? `${customerFirst}, ` : '';
  switch (kind) {
    case 'REMINDER_1_DAY':
      return `📅 ${greet}yarınki ${start || 'randevunuz'} için hatırlatma gönderildi${service ? ` (${service})` : ''}.`;
    case 'REMINDER_3_DAY':
      return `📅 ${greet}3 gün sonraki ${start || 'randevunuz'} için hatırlatma gönderildi.`;
    case 'REMINDER_2_HOUR':
      return `⏰ ${greet}2 saat sonraki randevunuz için hatırlatma + yol tarifi gönderildi.`;
    case 'NO_SHOW':
      return `❌ ${greet}gelmediğin randevu için takip mesajı gönderildi.`;
    case 'SATISFACTION_SURVEY':
      return `⭐ ${greet}memnuniyet anketi linki gönderildi.`;
    case 'GOOGLE_MAPS_REVIEW':
      return `🗺️ ${greet}Google yorum bağlantısı gönderildi.`;
    case 'WAITLIST_OFFER':
      return `🎟️ ${greet}bekleme listesi teklifi gönderildi.`;
    case 'BIRTHDAY':
      return `🎂 ${greet}doğum günü kuponu gönderildi.`;
    case 'WINBACK':
      return `💌 ${greet}geri dönüş kampanyası gönderildi.`;
    default:
      return undefined;
  }
}

// sendAppointmentConfirmation removed — kdy_randevu_onay template is no
// longer part of the salon pipeline.

export function sendReminder1Day(input: AppointmentInput) {
  return sendAppointmentBound('REMINDER_1_DAY', 'kdy_randevu_hatirlatma_1_gun', input);
}

export function sendReminder3Day(input: AppointmentInput) {
  return sendAppointmentBound('REMINDER_3_DAY', 'kdy_randevu_hatirlatma_3_gun', input);
}

export function sendReminder2Hour(input: AppointmentInput) {
  return sendAppointmentBound('REMINDER_2_HOUR', 'kdy_randevu_hatirlatma_2_saat', input);
}

export function sendNoShow(input: AppointmentInput) {
  return sendAppointmentBound('NO_SHOW', 'kdy_no_show_hatirlatma', input);
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

  const templateName = await pickTemplateForSend({ salonId: input.salonId, logicalKey: 'kdy_memnuniyet_anketi' });
  if (!templateName) return { ok: false, reason: 'no_approved_template_variation' };

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams: [{ type: 'url', value: link.token }],
    conversationDisplayText: renderHumanDisplayText(kind, ctx.params),
    conversationMetadata: {
      kind,
      customerId: input.customerId,
      appointmentId: input.appointmentId,
      templateName,
      feedbackToken: link.token,
    },
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

  // Button now uses the slug-based /r/maps/:slug short link; the redirect
  // route resolves the real googleMapsUrl on click.
  const templateName = await pickTemplateForSend({ salonId: input.salonId, logicalKey: 'kdy_google_maps_yorum' });
  if (!templateName) return { ok: false, reason: 'no_approved_template_variation' };

  const buttonParams = await buildButtonParamsForLogicalKey(input.salonId, 'kdy_google_maps_yorum');

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams,
    conversationDisplayText: renderHumanDisplayText('GOOGLE_MAPS_REVIEW', ctx.params),
    conversationMetadata: {
      kind: 'GOOGLE_MAPS_REVIEW',
      customerId: input.customerId,
      templateName,
    },
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

  const templateName = await pickTemplateForSend({ salonId: input.salonId, logicalKey: 'kdy_dogum_gunu_kutlamasi' });
  if (!templateName) return { ok: false, reason: 'no_approved_template_variation' };

  const buttonParams = await buildButtonParamsForLogicalKey(input.salonId, 'kdy_dogum_gunu_kutlamasi');

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams,
    conversationDisplayText: renderHumanDisplayText(kind, ctx.params),
    conversationMetadata: {
      kind,
      customerId: input.customerId,
      templateName,
    },
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

  const templateName = await pickTemplateForSend({ salonId: input.salonId, logicalKey: 'kdy_geri_donus' });
  if (!templateName) return { ok: false, reason: 'no_approved_template_variation' };

  const buttonParams = await buildButtonParamsForLogicalKey(input.salonId, 'kdy_geri_donus');

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams,
    conversationDisplayText: renderHumanDisplayText(kind, ctx.params),
    conversationMetadata: {
      kind,
      customerId: input.customerId,
      templateName,
    },
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

  const templateName = await pickTemplateForSend({ salonId: input.salonId, logicalKey: 'kdy_waitlist_teklif' });
  if (!templateName) return { ok: false, reason: 'no_approved_template_variation' };

  const result = await sendTemplate({
    salonId: input.salonId,
    templateName,
    recipientPhone: ctx.recipientPhone,
    bodyParams: ctx.params,
    buttonParams: [{ type: 'url', value: input.offerToken }],
    conversationDisplayText: renderHumanDisplayText('WAITLIST_OFFER', ctx.params),
    conversationMetadata: {
      kind: 'WAITLIST_OFFER',
      customerId: input.customerId,
      templateName,
      offerToken: input.offerToken,
    },
  });

  if (result.ok) await logSent('WAITLIST_OFFER', input.customerId, null);
  return result;
}
