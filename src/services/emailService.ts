// Email service — Amazon SES via SMTP (nodemailer).
//
// Used for:
//   - Salon signup email verification (UTILITY-link based)
//   - Future password reset via email (when added)
//
// We send via SMTP (port 587, STARTTLS) rather than the SES HTTPS API
// because the operator manages an SMTP IAM user (kedy-ses-smtp-transactional)
// and that's simpler to deploy on Coolify / any Node host than the SDK
// credential chain. Deliverability is identical; the SMTP endpoint is
// just a fronting protocol for the same SES infrastructure.
//
// Required env (set in Coolify):
//   SMTP_HOST          email-smtp.eu-west-1.amazonaws.com
//   SMTP_PORT          587
//   SMTP_USER          IAM SMTP user name (e.g. AKIA...)
//   SMTP_PASS          IAM SMTP password
//   EMAIL_FROM         "Kedy <noreply@mail.kedyapp.com>"
//                      (must be on a SES-verified domain — we use the
//                       mail.kedyapp.com subdomain to isolate transactional
//                       sender reputation)

import nodemailer, { type Transporter } from 'nodemailer';

const SMTP_HOST = (process.env.SMTP_HOST || 'email-smtp.eu-west-1.amazonaws.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'Kedy <noreply@mail.kedyapp.com>').trim();

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!isEmailConfigured()) {
    throw new Error('email_provider_not_configured');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      // Port 587 → STARTTLS upgrade (secure=false + requireTLS=true).
      // Port 465 → implicit TLS (secure=true).
      secure: SMTP_PORT === 465,
      requireTLS: SMTP_PORT === 587,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      pool: true,
      maxConnections: 4,
      maxMessages: 100,
      connectionTimeout: 10_000,
      socketTimeout: 25_000,
    });
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_FROM);
}

export interface VerificationEmailInput {
  to: string;
  name?: string | null;
  actionLabel: string; // "hesabınızı doğrulayın", "ekip katılımı", "şifre sıfırlama"
  link: string;
  ttlMinutes: number;
}

/**
 * Sends a UTILITY-style verification email via Amazon SES (SMTP).
 */
export async function sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
  const t = getTransporter();
  const html = renderVerificationHtml(input);
  const text = renderVerificationText(input);
  const subject = `Kedy — ${input.actionLabel}`;

  try {
    await t.sendMail({
      from: EMAIL_FROM,
      to: input.to,
      subject,
      html,
      text,
      headers: {
        'X-Kedy-Mail-Kind': 'verification',
      },
    });
  } catch (error: any) {
    // nodemailer error codes:
    //   EAUTH        — SMTP credentials wrong
    //   ECONNECTION  — host unreachable
    //   ESOCKET      — TLS / port issue
    //   EENVELOPE    — recipient rejected (SES sandbox: recipient not verified)
    //   EMESSAGE     — message rejected post-DATA
    const code = error?.code || error?.responseCode || 'unknown';
    const message = error?.response || error?.message || 'smtp_send_failed';
    console.error('[emailService] SMTP send failed', {
      to: input.to,
      code,
      message,
    });
    throw new Error(`email_send_failed:${code}`);
  }
}

export interface VerificationCodeEmailInput {
  to: string;
  name?: string | null;
  code: string;
  ttlMinutes: number;
}

/**
 * Sends a 6-digit OTP code via SES (SMTP). Used by mobile flows where
 * a magic link would force the user to switch apps mid-registration —
 * a typed code keeps them in the app.
 */
export async function sendVerificationCodeEmail(input: VerificationCodeEmailInput): Promise<void> {
  const t = getTransporter();
  const subject = 'Kedy — E-posta doğrulama kodunuz';
  const html = renderCodeHtml(input);
  const text = renderCodeText(input);

  try {
    await t.sendMail({
      from: EMAIL_FROM,
      to: input.to,
      subject,
      html,
      text,
      headers: { 'X-Kedy-Mail-Kind': 'verification-code' },
    });
  } catch (error: any) {
    const code = error?.code || error?.responseCode || 'unknown';
    const message = error?.response || error?.message || 'smtp_send_failed';
    console.error('[emailService] SMTP code send failed', {
      to: input.to,
      code,
      message,
    });
    throw new Error(`email_send_failed:${code}`);
  }
}

function renderCodeText(input: VerificationCodeEmailInput): string {
  const greeting = input.name ? `Merhaba ${input.name},` : 'Merhaba,';
  return [
    greeting,
    '',
    `E-posta doğrulama kodunuz: ${input.code}`,
    '',
    `Bu kod ${input.ttlMinutes} dakika boyunca geçerlidir.`,
    'Eğer bu işlemi siz başlatmadıysanız bu mesajı görmezden gelebilirsiniz.',
    '',
    '— Kedy ekibi',
    'kedyapp.com',
  ].join('\n');
}

function renderCodeHtml(input: VerificationCodeEmailInput): string {
  const greeting = input.name
    ? `Merhaba ${escapeHtml(input.name)},`
    : 'Merhaba,';
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>E-posta doğrulama kodu</title>
</head>
<body style="margin:0;padding:0;background:#F8F7F4;font-family:'Manrope','Inter',system-ui,-apple-system,sans-serif;color:#252528;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8F7F4;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="480" style="max-width:480px;background:#FFFFFF;border-radius:16px;border:1px solid #E7E5E1;overflow:hidden;">
        <tr><td style="padding:32px 32px 0;">
          <img src="https://kedyapp.com/kedy-logo-light.png" alt="Kedy" height="36" style="display:block;height:36px;width:auto;border:0;">
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.3;color:#252528;">E-posta doğrulama kodunuz</h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#252528;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#252528;">
            Kedy uygulamasında devam etmek için aşağıdaki kodu girin.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 24px;">
          <div style="display:inline-block;padding:18px 32px;background:#F8F7F4;border:1px solid #E7E5E1;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:8px;color:#252528;">${escapeHtml(input.code)}</div>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#77747A;">
            Bu kod <strong>${input.ttlMinutes} dakika</strong> boyunca geçerlidir.
            Eğer bu işlemi siz başlatmadıysanız bu mesajı görmezden gelebilirsiniz.
          </p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #E7E5E1;background:#FBFAF8;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#A3A0A6;text-align:center;">
            © ${new Date().getFullYear()} Kedy · <a href="https://kedyapp.com" style="color:#A3A0A6;text-decoration:underline;">kedyapp.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────
// Templates (Kedy brand)
// ─────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderVerificationText(input: VerificationEmailInput): string {
  const greeting = input.name ? `Merhaba ${input.name},` : 'Merhaba,';
  return [
    greeting,
    '',
    `Kedy hesabınızda ${input.actionLabel} işleminizi tamamlamak için aşağıdaki linke tıklayın:`,
    '',
    input.link,
    '',
    `Bu link ${input.ttlMinutes} dakika boyunca geçerlidir.`,
    'Eğer bu işlemi siz başlatmadıysanız bu mesajı görmezden gelebilirsiniz.',
    '',
    '— Kedy ekibi',
    'kedyapp.com',
  ].join('\n');
}

function renderVerificationHtml(input: VerificationEmailInput): string {
  const greeting = input.name
    ? `Merhaba ${escapeHtml(input.name)},`
    : 'Merhaba,';

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.actionLabel)}</title>
</head>
<body style="margin:0;padding:0;background:#F8F7F4;font-family:'Manrope','Inter',system-ui,-apple-system,sans-serif;color:#252528;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8F7F4;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #E7E5E1;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 0;">
              <img src="https://kedyapp.com/kedy-logo-light.png" alt="Kedy" height="36" style="display:block;height:36px;width:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.3;color:#252528;">${escapeHtml(input.actionLabel)}</h1>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#252528;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#252528;">
                Kedy hesabınızdaki işleminizi tamamlamak için aşağıdaki butona dokunun.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 24px;">
              <a href="${escapeHtml(input.link)}" style="display:inline-block;padding:14px 28px;background:#F47A20;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;">İşleme Devam Et</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#77747A;">
                Buton çalışmıyorsa şu adresi tarayıcınıza kopyalayın:
              </p>
              <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#77747A;word-break:break-all;">
                <a href="${escapeHtml(input.link)}" style="color:#F47A20;text-decoration:underline;">${escapeHtml(input.link)}</a>
              </p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#77747A;">
                Bu link <strong>${input.ttlMinutes} dakika</strong> boyunca geçerlidir.
                Eğer bu işlemi siz başlatmadıysanız bu mesajı görmezden gelebilirsiniz.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #E7E5E1;background:#FBFAF8;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#A3A0A6;text-align:center;">
                © ${new Date().getFullYear()} Kedy · <a href="https://kedyapp.com" style="color:#A3A0A6;text-decoration:underline;">kedyapp.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
