// Email service — Resend (https://resend.com) integration.
//
// Used for:
//   - Salon signup email verification (UTILITY-link based)
//   - Future password reset via email (when added)
//
// Resend was chosen over SendGrid/Postmark for:
//   - Simpler API, JSON SDK with no callbacks
//   - Free tier 3K/month, $20/mo for 50K — fits our scale
//   - First-class Turkish deliverability
//
// Required env:
//   RESEND_API_KEY              re_xxx...
//   EMAIL_FROM                  "Kedy <noreply@kedyapp.com>"  (sender must be verified)

import { Resend } from 'resend';

const API_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM = (process.env.EMAIL_FROM || 'Kedy <noreply@kedyapp.com>').trim();

let client: Resend | null = null;
function getClient(): Resend {
  if (!API_KEY) {
    throw new Error('email_provider_not_configured');
  }
  if (!client) {
    client = new Resend(API_KEY);
  }
  return client;
}

export function isEmailConfigured(): boolean {
  return Boolean(API_KEY);
}

export interface VerificationEmailInput {
  to: string;
  name?: string | null;
  actionLabel: string; // "hesabınızı doğrulayın", "ekip katılımı", "şifre sıfırlama"
  link: string;
  ttlMinutes: number;
}

/**
 * Sends a UTILITY-style verification email. Single template, brand-consistent.
 */
export async function sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
  const c = getClient();
  const html = renderVerificationHtml(input);
  const text = renderVerificationText(input);
  const subject = `Kedy — ${input.actionLabel}`;

  await c.emails.send({
    from: FROM,
    to: input.to,
    subject,
    html,
    text,
    headers: {
      'X-Kedy-Mail-Kind': 'verification',
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Templates
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
