// Customer verify-link landing pages.
//
// Mounted at /c/v/:token (public router, no auth) so the customer who
// taps the `kdy_islem_link` button in WhatsApp lands on a real page
// instead of the 404 the old `app.berkai.shop/c/v/...` URL was
// surfacing. The customer's identity travels with the token itself —
// no Authorization header, no tenant subdomain — so the salon is
// resolved from the consumed link's `targetSalonId`.
//
// Flow:
//   GET  /c/v/:token  → peek (read-only), render KVKK consent + form
//   POST /c/v/:token  → consume token, create/upgrade Customer (VERIFIED),
//                        render success page
//
// The kdy_islem_link button URL Meta has approved points to
// app.berkai.shop/c/v/{{1}} (legacy domain). We expect the user to set
// up a redirect from that host to api.kedyapp.com/c/v/* so customers
// land here regardless of which template URL is in flight.

import { Router } from 'express';
import {
  consumeVerificationLink,
  peekVerificationLink,
  VerificationError,
} from '../services/verificationLinkService.js';
import { VerificationPurpose } from '@prisma/client';
import { prisma } from '../prisma.js';
import {
  upsertPhoneIdentity,
  linkCustomerToIdentity,
} from '../services/phoneIdentityService.js';
import {
  syncCustomerToGlobalIdentity,
  markGlobalIdentityVerified,
} from '../services/globalCustomerIdentity.js';

const router = Router();

function clientReqInfo(req: any): { ipAddress: string | null; userAgent: string | null } {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    ipAddress: ip || req.ip || req.socket?.remoteAddress || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
  };
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderShell(input: {
  title: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin:0; padding:0; background:#F8F7F4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',sans-serif; color:#252528; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border:1px solid #E7E5E1; border-radius:24px; padding:32px 24px; max-width:420px; width:100%; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
  .icon { width:64px; height:64px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:30px; font-weight:700; margin:0 auto 16px; }
  .icon.brand { background:#FCE9D9; color:#C95F0D; }
  .icon.success { background:#10b98115; color:#10b981; }
  .icon.error { background:#ef444415; color:#ef4444; }
  h1 { margin:0 0 8px; font-size:20px; font-weight:700; text-align:center; }
  .salon { margin:0 0 16px; font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#8b888f; text-align:center; }
  p { margin:0 0 12px; font-size:15px; line-height:1.55; color:#5a575e; }
  .hint { margin-top:20px; font-size:12px; color:#a3a0a6; text-align:center; }
  label.consent { display:flex; align-items:flex-start; gap:10px; padding:14px; border:1px solid #E7E5E1; border-radius:14px; background:#FAFAF8; cursor:pointer; margin:20px 0 16px; }
  label.consent input { margin-top:2px; flex-shrink:0; }
  label.consent span { font-size:13px; line-height:1.5; color:#3a373d; }
  button { width:100%; padding:14px 18px; background:#252528; color:#fff; border:none; border-radius:999px; font-size:15px; font-weight:600; cursor:pointer; transition: opacity 160ms; }
  button:hover:not(:disabled) { opacity:0.92; }
  button:disabled { opacity:0.4; cursor:not-allowed; }
  a.return { display:inline-block; margin-top:16px; font-size:13px; color:#C95F0D; text-decoration:none; font-weight:500; }
</style>
</head>
<body>
  <div class="card">
    ${input.bodyHtml}
  </div>
</body>
</html>`;
}

function renderError(title: string, body: string, status = 400): { status: number; html: string } {
  return {
    status,
    html: renderShell({
      title,
      bodyHtml: `
        <div class="icon error">⚠</div>
        <h1>${escapeHtml(title)}</h1>
        <p style="text-align:center">${escapeHtml(body)}</p>
        <p class="hint">Bu sekmeyi kapatıp WhatsApp'tan yeni bir doğrulama linki iste.</p>
      `,
    }),
  };
}

// GET /c/v/:token — render the KVKK consent page. Peek-only; the
// token is only consumed when the customer submits the form.
router.get('/:token', async (req: any, res: any) => {
  const token = String(req.params.token || '').trim();
  if (!token) {
    const err = renderError('Bağlantı geçersiz', 'Doğrulama linkinde token bilgisi yok.');
    return res.status(err.status).type('html').send(err.html);
  }

  let peeked;
  try {
    peeked = await peekVerificationLink(token);
  } catch (error) {
    console.error('[c/v] peek failed', error);
    const err = renderError('Bir şeyler ters gitti', 'Bağlantıyı işleyemedik. Lütfen tekrar dene.', 500);
    return res.status(err.status).type('html').send(err.html);
  }

  if (!peeked) {
    const err = renderError(
      'Bağlantı geçersiz',
      'Bu doğrulama bağlantısı süresi dolmuş veya daha önce kullanılmış olabilir.',
      404,
    );
    return res.status(err.status).type('html').send(err.html);
  }

  if (
    peeked.purpose !== VerificationPurpose.CUSTOMER_PHONE &&
    peeked.purpose !== VerificationPurpose.CUSTOMER_LINK_CONSENT
  ) {
    const err = renderError('Bağlantı geçersiz', 'Bu link bu sayfa için uygun değil.');
    return res.status(err.status).type('html').send(err.html);
  }

  const payloadAny = peeked.payload as any;
  const salonName = (payloadAny?.salonName as string) || 'Salon';
  const customerName = (payloadAny?.customerName as string) || '';

  const greetingLine = customerName
    ? `Merhaba ${escapeHtml(customerName)},`
    : 'Merhaba,';

  const bodyHtml = `
    <div class="icon brand">✓</div>
    <p class="salon">${escapeHtml(salonName)}</p>
    <h1>Telefon numaranı doğrula</h1>
    <p style="text-align:center">${greetingLine} bu salondan randevu işlemlerini tamamlayabilmen için WhatsApp numaranı doğrulamamız gerek.</p>
    <form method="POST" action="/c/v/${encodeURIComponent(token)}">
      <label class="consent">
        <input type="checkbox" name="consent" value="1" required>
        <span>Telefon numaramın <strong>${escapeHtml(salonName)}</strong> ile randevu işlemlerinde kullanılmasını onaylıyorum. KVKK aydınlatma metnini okudum.</span>
      </label>
      <button type="submit">Devam Et</button>
    </form>
    <p class="hint">Bu linki ben istemedim diyorsan kapatabilirsin — kayıt oluşmaz.</p>
  `;

  return res.status(200).type('html').send(
    renderShell({ title: `${salonName} — Telefon doğrulama`, bodyHtml }),
  );
});

// POST /c/v/:token — consume token, create/upgrade VERIFIED Customer.
// Same Customer-creation logic as /api/customers/verify-link/confirm,
// but salon is resolved from the link itself (no tenant middleware
// since this route lives on api.kedyapp.com).
router.post('/:token', async (req: any, res: any) => {
  const token = String(req.params.token || '').trim();
  // Both form-urlencoded and JSON bodies — body parser is wired globally.
  const consent = req.body?.consent === '1' || req.body?.consent === 1 || req.body?.consent === true || req.body?.consentAccepted === true;
  if (!token) {
    const err = renderError('Bağlantı geçersiz', 'Doğrulama linkinde token bilgisi yok.');
    return res.status(err.status).type('html').send(err.html);
  }
  if (!consent) {
    const err = renderError('Onay gerekli', 'Devam etmek için KVKK onay kutusunu işaretlemelisin.');
    return res.status(err.status).type('html').send(err.html);
  }

  const { ipAddress, userAgent } = clientReqInfo(req);

  let consumed;
  try {
    consumed = await consumeVerificationLink(token, { ipAddress, userAgent });
  } catch (error: any) {
    if (error instanceof VerificationError) {
      const expired = error.code === 'VERIFICATION_LINK_EXPIRED';
      const err = renderError(
        expired ? 'Linkin süresi doldu' : 'Bağlantı geçersiz',
        expired
          ? 'Bu doğrulama linkinin süresi doldu. WhatsApp\'tan yeni bir link iste.'
          : 'Bu link kullanılmış veya geçersiz.',
        expired ? 410 : 400,
      );
      return res.status(err.status).type('html').send(err.html);
    }
    console.error('[c/v] consume failed', error);
    const err = renderError('Bir şeyler ters gitti', 'Bağlantıyı işleyemedik. Lütfen tekrar dene.', 500);
    return res.status(err.status).type('html').send(err.html);
  }

  if (
    consumed.purpose !== VerificationPurpose.CUSTOMER_PHONE &&
    consumed.purpose !== VerificationPurpose.CUSTOMER_LINK_CONSENT
  ) {
    const err = renderError('Bağlantı geçersiz', 'Bu link bu sayfa için uygun değil.');
    return res.status(err.status).type('html').send(err.html);
  }

  const salonId = consumed.targetSalonId;
  const phone = consumed.targetPhone;
  if (!salonId || !phone) {
    const err = renderError('Bağlantı eksik', 'Doğrulama bilgileri eksik. Lütfen yeni bir link iste.', 400);
    return res.status(err.status).type('html').send(err.html);
  }

  const payloadAny = consumed.payload as any;

  // STEP-1 verify-only (wizard): this link only proves phone ownership before the
  // form is filled. Mark the CustomerPhoneVerification VERIFIED and STOP — do NOT
  // create a Customer (the final /register creates it once with the full form,
  // trusting this via verifiedVerificationId). Creating a stub Customer here would
  // make /register's existingVerified short-circuit skip the real name/gender.
  const step1VerificationId =
    typeof payloadAny?.step1VerificationId === 'string' ? payloadAny.step1VerificationId : '';
  if (step1VerificationId) {
    try {
      await prisma.customerPhoneVerification.updateMany({
        where: { id: step1VerificationId, salonId, phone, status: 'PENDING' },
        data: { status: 'VERIFIED' },
      });
    } catch (e) {
      console.warn('[c/v] step1 phone verify mark failed', e);
    }
    const okHtml = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Doğrulandı</title></head><body style="font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f6f7f9;color:#111"><div style="max-width:380px;margin:48px auto;padding:0 24px"><div style="background:#fff;border-radius:20px;padding:32px 24px;text-align:center;box-shadow:0 2px 14px rgba(15,23,42,.06)"><div style="font-size:46px;line-height:1">✅</div><h2 style="margin:14px 0 6px;font-size:20px">Numaranız doğrulandı</h2><p style="color:#555;font-size:15px;line-height:1.55;margin:0">Açtığınız randevu sekmesine dönüp işleminize devam edebilirsiniz.</p></div></div></body></html>`;
    return res.status(200).type('html').send(okHtml);
  }

  const customerName = (payloadAny?.customerName as string) || 'Müşteri';
  const source = ((payloadAny?.source as string) || 'BOOKING').toUpperCase() as
    | 'INSTAGRAM'
    | 'BOOKING'
    | 'ADMIN'
    | 'WHATSAPP_INBOUND'
    | 'WEB';

  // Same shape as /api/customers/verify-link/confirm — registration
  // payload populates Customer fields beyond the basic name.
  const registrationPayload = payloadAny?.registration as {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    gender?: 'male' | 'female' | 'other' | null;
    birthDate?: string | null;
    acceptMarketing?: boolean;
    originChannel?: string | null;
    originPhone?: string | null;
    instagramId?: string | null;
    magicToken?: string | null;
  } | null | undefined;

  try {
    const phoneIdentity = await upsertPhoneIdentity({ phone });
    const existing = await prisma.customer.findFirst({ where: { phone, salonId } });

    let customer;
    if (existing) {
      customer = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          registrationStatus: 'VERIFIED',
          ...(registrationPayload
            ? {
                name: registrationPayload.fullName || customerName,
                firstName: registrationPayload.firstName || existing.firstName,
                lastName: registrationPayload.lastName || existing.lastName,
                ...(registrationPayload.gender ? { gender: registrationPayload.gender } : {}),
                ...(registrationPayload.birthDate ? { birthDate: new Date(registrationPayload.birthDate) } : {}),
                acceptMarketing: Boolean(registrationPayload.acceptMarketing),
              }
            : {}),
        },
      });
    } else {
      const splitName = customerName.split(' ');
      customer = await prisma.customer.create({
        data: {
          phone,
          salonId,
          name: registrationPayload?.fullName || customerName,
          firstName: registrationPayload?.firstName || splitName[0] || null,
          lastName: registrationPayload?.lastName || splitName.slice(1).join(' ') || null,
          ...(registrationPayload?.gender ? { gender: registrationPayload.gender } : {}),
          ...(registrationPayload?.birthDate
            ? { birthDate: new Date(registrationPayload.birthDate) }
            : {}),
          registrationStatus: 'VERIFIED',
          acceptMarketing: Boolean(registrationPayload?.acceptMarketing),
        },
      });
      await prisma.customerRiskProfile.create({
        data: { customerId: customer.id, salonId, riskScore: 0, riskLevel: null },
      });
    }

    await linkCustomerToIdentity({
      salonId,
      phoneIdentityId: phoneIdentity.id,
      customerId: customer.id,
      consentSource: source,
      optInChannels: { whatsapp: true },
    });

    await syncCustomerToGlobalIdentity(customer.id).catch((err) =>
      console.error('GlobalCustomerIdentity sync failed:', err),
    );
    await markGlobalIdentityVerified(phone).catch(() => undefined);
  } catch (error) {
    console.error('[c/v] customer creation failed', error);
    const err = renderError(
      'Bir şeyler ters gitti',
      'Doğrulamayı kaydedemedik. Lütfen tekrar dene.',
      500,
    );
    return res.status(err.status).type('html').send(err.html);
  }

  // Success page. The booking-page poll on api.kedyapp.com will
  // detect the consumed link on its next 4-sec tick and finalize the
  // customer there, so the customer can just close this tab.
  const salonNameForSuccess = (payloadAny?.salonName as string) || 'Salon';
  return res.status(200).type('html').send(
    renderShell({
      title: `${salonNameForSuccess} — Doğrulandı`,
      bodyHtml: `
        <div class="icon success">✓</div>
        <p class="salon">${escapeHtml(salonNameForSuccess)}</p>
        <h1>Telefonun doğrulandı</h1>
        <p style="text-align:center">Harika! WhatsApp numaranı başarıyla doğruladık. Randevu sayfasına geri dönebilir, işlemine kaldığın yerden devam edebilirsin.</p>
        <p class="hint">Bu sekmeyi kapatabilirsin.</p>
      `,
    }),
  );
});

export default router;
