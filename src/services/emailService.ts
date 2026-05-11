// Email service — Amazon SES (sesv2) integration.
//
// Used for:
//   - Salon signup email verification (UTILITY-link based)
//   - Future password reset via email (when added)
//
// AWS SES was chosen because:
//   - Already on AWS for credit / cost reasons
//   - $0.10 / 1000 emails — by far the cheapest of the major providers
//   - High deliverability with verified sender domain
//   - Region-pinned (eu-central-1 / eu-west-1 closest to TR users)
//
// Required env:
//   AWS_SES_REGION              eu-central-1
//   AWS_ACCESS_KEY_ID           AKIA...
//   AWS_SECRET_ACCESS_KEY       ...
//   EMAIL_FROM                  "Kedy <noreply@kedyapp.com>"  (verified in SES)
//
// SES sandbox notes:
//   - When the AWS account is in sandbox mode, recipient addresses must
//     also be verified. Production account exit happens via the AWS console.
//   - Sender domain (kedyapp.com) MUST be domain-verified or sender-
//     verified before send is allowed.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const AWS_REGION = (
  process.env.AWS_SES_REGION ||
  process.env.AWS_REGION ||
  'eu-central-1'
).trim();
const AWS_ACCESS_KEY_ID = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const AWS_SECRET_ACCESS_KEY = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'Kedy <noreply@kedyapp.com>').trim();
const CONFIGURATION_SET = (process.env.AWS_SES_CONFIGURATION_SET || '').trim();

let client: SESv2Client | null = null;

function getClient(): SESv2Client {
  if (!isEmailConfigured()) {
    throw new Error('email_provider_not_configured');
  }
  if (!client) {
    client = new SESv2Client({
      region: AWS_REGION,
      // If creds are not provided, fall through to the default chain
      // (IAM role, env, shared config). Explicit creds win when present.
      ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: AWS_ACCESS_KEY_ID,
              secretAccessKey: AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }
  return client;
}

/**
 * `true` if at least region + sender are configured. Credentials may come
 * from the AWS SDK default chain (IAM, profile) when explicit keys are absent.
 */
export function isEmailConfigured(): boolean {
  if (!AWS_REGION || !EMAIL_FROM) return false;
  // If explicit creds are partially provided, treat as misconfigured.
  if (AWS_ACCESS_KEY_ID && !AWS_SECRET_ACCESS_KEY) return false;
  if (!AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) return false;
  return true;
}

export interface VerificationEmailInput {
  to: string;
  name?: string | null;
  actionLabel: string; // "hesabınızı doğrulayın", "ekip katılımı", "şifre sıfırlama"
  link: string;
  ttlMinutes: number;
}

/**
 * Sends a UTILITY-style verification email via Amazon SES.
 */
export async function sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
  const c = getClient();
  const html = renderVerificationHtml(input);
  const text = renderVerificationText(input);
  const subject = `Kedy — ${input.actionLabel}`;

  const command = new SendEmailCommand({
    FromEmailAddress: EMAIL_FROM,
    Destination: { ToAddresses: [input.to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: text, Charset: 'UTF-8' },
        },
        Headers: [{ Name: 'X-Kedy-Mail-Kind', Value: 'verification' }],
      },
    },
    ...(CONFIGURATION_SET ? { ConfigurationSetName: CONFIGURATION_SET } : {}),
  });

  try {
    await c.send(command);
  } catch (error: any) {
    // SES surfaces useful error names like MessageRejected, NotAuthorized,
    // SendingPausedException, AccountSuspendedException — log and rethrow
    // a typed message so the caller can surface "service unavailable".
    const reason = error?.name || error?.Code || error?.message || 'ses_send_failed';
    console.error('[emailService] SES send failed', {
      to: input.to,
      reason,
      message: error?.message,
    });
    throw new Error(`email_send_failed:${reason}`);
  }
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
