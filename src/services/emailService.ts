// Email service — SMTP2GO HTTP API.
//
// Migrated off Amazon SES SMTP because:
//   1. Coolify env stores fewer secrets (just one API key vs.
//      SMTP_USER/SMTP_PASS/SMTP_HOST/SMTP_PORT)
//   2. SMTP2GO's HTTP endpoint short-circuits the STARTTLS dance and
//      gives us structured JSON errors instead of socket-level ones.
//
// Used for:
//   - Salon signup email magic-link (sendVerificationEmail)
//   - Team-invite email magic-link (sendVerificationEmail with TEAM_INVITE)
//   - Team-invite email OTP code (sendVerificationCodeEmail)
//   - Onboarding email magic-link (sendVerificationEmail from
//     onboardingService)
//
// Required env:
//   SMTP2GO_API_KEY    api-XXXX... key from SMTP2GO dashboard
//   EMAIL_FROM         "Kedy <noreply@mail.kedyapp.com>" (must be on a
//                      domain SMTP2GO has DKIM-verified)

import axios from 'axios';

const SMTP2GO_API_KEY = (process.env.SMTP2GO_API_KEY || '').trim();
const SMTP2GO_ENDPOINT = (process.env.SMTP2GO_ENDPOINT || 'https://api.smtp2go.com/v3/email/send').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'Kedy <noreply@mail.kedyapp.com>').trim();

export function isEmailConfigured(): boolean {
  return Boolean(SMTP2GO_API_KEY && EMAIL_FROM);
}

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: string;
}

async function send(input: SendMailInput): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error('email_provider_not_configured');
  }
  try {
    const response = await axios.post(
      SMTP2GO_ENDPOINT,
      {
        sender: EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html_body: input.html,
        text_body: input.text,
        custom_headers: [
          { header: 'X-Kedy-Mail-Kind', value: input.kind },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Smtp2go-Api-Key': SMTP2GO_API_KEY,
          Accept: 'application/json',
        },
        timeout: 25_000,
      },
    );

    // SMTP2GO replies with { data: { succeeded: 1, failed: 0, ... } } on
    // success, or { data: { failed: 1, failures: [...] } } on a partial
    // failure. Treat anything other than "everything succeeded" as an
    // error so the caller sees the rejection.
    const data = response?.data?.data || {};
    const succeeded = Number(data.succeeded || 0);
    const failed = Number(data.failed || 0);
    if (succeeded < 1 || failed > 0) {
      const reason = JSON.stringify(data.failures || data || {});
      throw new Error(`smtp2go_rejected:${reason}`);
    }
  } catch (error: any) {
    const apiError = error?.response?.data;
    const code = apiError?.data?.error_code || error?.code || 'unknown';
    const message = apiError?.data?.error || error?.message || 'send_failed';
    console.error('[emailService] SMTP2GO send failed', {
      to: input.to,
      code,
      message,
      status: error?.response?.status,
    });
    throw new Error(`email_send_failed:${code}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Magic-link email
// ─────────────────────────────────────────────────────────────────

export interface VerificationEmailInput {
  to: string;
  name?: string | null;
  actionLabel: string;
  link: string;
  ttlMinutes: number;
}

export async function sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
  await send({
    to: input.to,
    subject: `Kedy — ${input.actionLabel}`,
    html: renderVerificationHtml(input),
    text: renderVerificationText(input),
    kind: 'verification',
  });
}

// ─────────────────────────────────────────────────────────────────
// Lead-flow invite email — big readable code + web link + store badges
// ─────────────────────────────────────────────────────────────────
//
// Sent after a salon owner submits the /baslayalim form on the
// marketing site. Designed so the recipient can pick ANY of three paths
// to activate:
//   - tap the orange button: opens kedyapp.com/baslayalim/{code}
//   - download the mobile app (Play/App Store badges) and type the code
//   - copy/paste the code into a phone they already have the app on
//
// The code itself is 8 characters, human-friendly (excludes O/0, I/1,
// etc.). See services/leadService.ts:generateUniqueCode for the alphabet.

export interface LeadInviteEmailInput {
  to: string;
  name: string;
  salonName: string;
  code: string;
  webLink: string;
  ttlDays: number;
  /** Optional app store URLs (leave blank to hide the badge row). */
  appStoreUrl?: string;
  playStoreUrl?: string;
}

export async function sendLeadInviteEmail(input: LeadInviteEmailInput): Promise<void> {
  await send({
    to: input.to,
    subject: `${input.salonName} için Kedy davet kodun hazır`,
    html: renderLeadInviteHtml(input),
    text: renderLeadInviteText(input),
    kind: 'lead-invite',
  });
}

function renderLeadInviteText(input: LeadInviteEmailInput): string {
  return [
    `Merhaba ${input.name},`,
    '',
    `${input.salonName} için Kedy davet kodun: ${input.code}`,
    '',
    'Şu üç yoldan istediğini seç:',
    '',
    '1) Mobil uygulamayı indir, kodu gir:',
    input.playStoreUrl ? `   Play Store: ${input.playStoreUrl}` : '',
    input.appStoreUrl ? `   App Store: ${input.appStoreUrl}` : '',
    '',
    '2) Veya bilgisayardan devam et:',
    `   ${input.webLink}`,
    '',
    `Kod ${input.ttlDays} gün boyunca geçerlidir.`,
    'Eğer bu işlemi siz başlatmadıysanız bu mesajı görmezden gelebilirsiniz.',
    '',
    '— Kedy ekibi',
    'kedyapp.com',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderLeadInviteHtml(input: LeadInviteEmailInput): string {
  const greeting = `Merhaba ${escapeHtml(input.name)},`;
  const safeSalon = escapeHtml(input.salonName);
  const safeCode = escapeHtml(input.code);
  const safeLink = escapeHtml(input.webLink);

  // App store row — only rendered if at least one URL is configured.
  const storeButtons = (() => {
    if (!input.playStoreUrl && !input.appStoreUrl) return '';
    const buttons: string[] = [];
    if (input.playStoreUrl) {
      buttons.push(
        `<a href="${escapeHtml(input.playStoreUrl)}" style="display:inline-block;margin:0 6px;">
           <img src="https://kedyapp.com/badges/google-play-badge.png" alt="Google Play" height="48" style="height:48px;width:auto;border:0;">
         </a>`,
      );
    }
    if (input.appStoreUrl) {
      buttons.push(
        `<a href="${escapeHtml(input.appStoreUrl)}" style="display:inline-block;margin:0 6px;">
           <img src="https://kedyapp.com/badges/app-store-badge.png" alt="App Store" height="48" style="height:48px;width:auto;border:0;">
         </a>`,
      );
    }
    return `
      <tr><td align="center" style="padding:8px 32px 24px;">
        ${buttons.join('')}
      </td></tr>`;
  })();

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kedy davet kodun</title>
</head>
<body style="margin:0;padding:0;background:#F8F7F4;font-family:'Manrope','Inter',system-ui,-apple-system,sans-serif;color:#252528;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8F7F4;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#FFFFFF;border-radius:16px;border:1px solid #E7E5E1;overflow:hidden;">
        <tr><td style="padding:32px 32px 0;">
          <img src="https://kedyapp.com/kedy-logo-light.png" alt="Kedy" height="36" style="display:block;height:36px;width:auto;border:0;">
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.3;color:#252528;">
            ${safeSalon} için davet kodun hazır 🎉
          </h1>
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#252528;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#252528;">
            14 gün ücretsiz kurulum dönemine başlamak için aşağıdaki kodu kullan.
            Mobil uygulamadan veya bilgisayarından — sana hangisi uygunsa.
          </p>
        </td></tr>

        <!-- The code -->
        <tr><td align="center" style="padding:8px 32px 12px;">
          <div style="display:inline-block;padding:18px 28px;background:#FFF0E6;border:2px dashed #F47A20;border-radius:12px;font-family:'SF Mono','Menlo','Consolas',monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#252528;">
            ${safeCode}
          </div>
          <p style="margin:10px 0 0;font-size:12px;color:#77747A;">Davet kodu</p>
        </td></tr>

        <!-- App download row -->
        ${storeButtons || `<tr><td style="padding:0 32px 8px;">
          <p style="margin:12px 0 6px;font-size:14px;font-weight:600;color:#252528;">Mobil uygulamadan devam et</p>
          <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#77747A;">
            Kedy uygulamasını telefonuna indir, kodu giriş ekranına yapıştır.
            (App Store ve Google Play yakında.)
          </p>
        </td></tr>`}

        <!-- Web continue button -->
        <tr><td align="center" style="padding:4px 32px 24px;">
          <p style="margin:0 0 12px;font-size:14px;color:#77747A;">
            veya bilgisayardan devam et:
          </p>
          <a href="${safeLink}" style="display:inline-block;padding:14px 28px;background:#F47A20;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;">Web'den hesabımı aç</a>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#77747A;">
            Buton açılmazsa şu adresi tarayıcına kopyala:
          </p>
          <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#77747A;word-break:break-all;">
            <a href="${safeLink}" style="color:#F47A20;text-decoration:underline;">${safeLink}</a>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#77747A;">
            Kod ve link <strong>${input.ttlDays} gün</strong> boyunca geçerlidir.
            Bu işlemi siz başlatmadıysanız bu mesajı görmezden gelebilirsiniz.
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
// 6-digit OTP email (mobile flows where switching apps is awkward)
// ─────────────────────────────────────────────────────────────────

export interface VerificationCodeEmailInput {
  to: string;
  name?: string | null;
  code: string;
  ttlMinutes: number;
}

export async function sendVerificationCodeEmail(input: VerificationCodeEmailInput): Promise<void> {
  await send({
    to: input.to,
    subject: 'Kedy — E-posta doğrulama kodunuz',
    html: renderCodeHtml(input),
    text: renderCodeText(input),
    kind: 'verification-code',
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
