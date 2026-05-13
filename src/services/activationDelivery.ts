// Activation email delivery — sends the Stripe-checkout-completed activation
// code to the salon owner's email so they can install the mobile app and
// activate their salon.
//
// Status: STUB. We are waiting on Amazon SES production-access approval for
// the noreply@mail.kedyapp.com sender. Until SES_ENABLED=true is set in the
// env, this module only logs to the console — the activation flow still
// works because the marketing checkout success page also displays the same
// code via the read-once GET /api/checkout/activation endpoint.
//
// To enable real sending later:
//   1) Make sure SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM are configured
//      (these are already used by emailService.ts).
//   2) Set SES_ENABLED=true in Coolify.
//   3) Verify the recipient sandbox restrictions are lifted on SES.

import { isEmailConfigured } from './emailService.js';

const SES_ENABLED = String(process.env.SES_ENABLED || '').trim().toLowerCase() === 'true';

export interface SendActivationEmailInput {
  to: string;
  ownerName: string;
  salonName: string;
  code: string;
  expiresAt: Date;
}

export interface SendActivationEmailResult {
  delivered: boolean;
  provider: 'console' | 'ses';
}

function formatExpiresAt(expiresAt: Date): string {
  // tr-TR locale, Europe/Istanbul. Falls back to ISO if locale unavailable.
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Europe/Istanbul',
    }).format(expiresAt);
  } catch {
    return expiresAt.toISOString();
  }
}

function renderActivationText(input: SendActivationEmailInput): string {
  const expiresText = formatExpiresAt(input.expiresAt);
  return [
    `Merhaba ${input.ownerName},`,
    '',
    `Kedy aboneliğin başarıyla oluşturuldu. ${input.salonName} salonunu kurmaya başlamak için:`,
    '',
    `Aktivasyon Kodun: ${input.code}`,
    `Geçerlilik: ${expiresText}`,
    '',
    'Mobil uygulamayı indir → "Davet kodum var" → kodu gir.',
    '',
    'iOS: https://apps.apple.com/...',
    'Android: https://play.google.com/...',
    '',
    'Sorun yaşarsan: support@kedyapp.com',
    '',
    '— Kedy ekibi',
    'kedyapp.com',
  ].join('\n');
}

/**
 * Sends the activation email. When SES_ENABLED is not "true" this is a
 * no-op log-only stub — useful for local dev and for the current period
 * while SES production access is pending.
 */
export async function sendActivationEmail(
  input: SendActivationEmailInput,
): Promise<SendActivationEmailResult> {
  // Always log so operators can see the activation code flowed even when
  // real sending is disabled. Code is intentionally included in dev logs;
  // it's already visible to the operator on the checkout success page.
  console.log(
    '[activation-email] would send to:',
    input.to,
    'code:',
    input.code,
    'salon:',
    input.salonName,
    'expiresAt:',
    input.expiresAt.toISOString(),
  );

  if (!SES_ENABLED) {
    return { delivered: false, provider: 'console' };
  }

  // TODO: when SES is approved and we want to flip this on, wire the real
  // send through emailService.ts's nodemailer transporter. Sketch:
  //
  //   import { sendVerificationEmail } from './emailService.js';
  //   await sendVerificationEmail({
  //     to: input.to,
  //     name: input.ownerName,
  //     actionLabel: 'Aktivasyon Kodun',
  //     link: '',                     // -or- a deep link to the app
  //     ttlMinutes: 7 * 24 * 60,
  //   });
  //
  // For now we just check the SMTP config is in place and treat the
  // SES_ENABLED gate as "okay to actually send."
  if (!isEmailConfigured()) {
    console.warn('[activation-email] SES_ENABLED=true but SMTP not configured; skipping send.');
    return { delivered: false, provider: 'console' };
  }

  try {
    // Lazy import nodemailer transporter from the existing emailService
    // module. We send the raw text below directly rather than reusing the
    // verification-link template; that template is link-bearing whereas
    // activation is code-bearing.
    const nodemailer = await import('nodemailer');
    const SMTP_HOST = (process.env.SMTP_HOST || 'email-smtp.eu-west-1.amazonaws.com').trim();
    const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
    const SMTP_USER = (process.env.SMTP_USER || '').trim();
    const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
    const EMAIL_FROM = (process.env.EMAIL_FROM || 'Kedy <noreply@mail.kedyapp.com>').trim();

    const transporter = nodemailer.default.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      requireTLS: SMTP_PORT === 587,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: EMAIL_FROM,
      to: input.to,
      subject: "Kedy'ye hoş geldin — Aktivasyon Kodun",
      text: renderActivationText(input),
      headers: { 'X-Kedy-Mail-Kind': 'activation' },
    });

    return { delivered: true, provider: 'ses' };
  } catch (error: any) {
    console.error('[activation-email] send failed', {
      to: input.to,
      message: error?.message || String(error),
    });
    return { delivered: false, provider: 'ses' };
  }
}
