// Magic-link landing pages.
//
// When a user taps the WhatsApp button in the `kedyekip` template OR
// the link in the verification email, they land here. We mark the
// corresponding OnboardingSession token as verified and render a
// minimalist success page that nudges them back to the Kedy app.
//
// Mounted at /v on the public router so it works without an Authorization
// header — the token in the path IS the credential.

import { Router } from 'express';

const router = Router();

function renderLanding(input: { title: string; body: string; tone: 'success' | 'error' }): string {
  const accent = input.tone === 'success' ? '#10b981' : '#ef4444';
  const icon = input.tone === 'success' ? '✓' : '⚠';
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${input.title}</title>
<style>
  body { margin:0; padding:0; background:#F8F7F4; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',sans-serif; color:#252528; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border:1px solid #E7E5E1; border-radius:20px; padding:40px 28px; max-width:380px; width:100%; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
  .icon { width:64px; height:64px; border-radius:50%; background:${accent}15; color:${accent}; display:inline-flex; align-items:center; justify-content:center; font-size:32px; font-weight:700; margin-bottom:20px; }
  h1 { margin:0 0 12px; font-size:20px; font-weight:700; }
  p { margin:0 0 8px; font-size:15px; line-height:1.5; color:#5a575e; }
  .hint { margin-top:24px; font-size:13px; color:#a3a0a6; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${input.title}</h1>
    <p>${input.body}</p>
    <p class="hint">Bu sekmeyi kapatıp Kedy uygulamasına dönebilirsin.</p>
  </div>
</body>
</html>`;
}

router.get('/e/:token', async (req: any, res: any) => {
  try {
    const { consumeMagicLink } = await import('../services/onboardingService.js');
    const result = await consumeMagicLink(String(req.params.token || ''));
    if (!result || result.side !== 'email') {
      return res
        .status(400)
        .type('html')
        .send(
          renderLanding({
            title: 'Bağlantı geçersiz',
            body: 'Bu doğrulama bağlantısı süresi dolmuş veya daha önce kullanılmış olabilir. Lütfen uygulamadan yeni bir bağlantı iste.',
            tone: 'error',
          }),
        );
    }
    return res.status(200).type('html').send(
      renderLanding({
        title: 'E-postan doğrulandı',
        body: 'Harika! E-posta adresini başarıyla doğruladık.',
        tone: 'success',
      }),
    );
  } catch (error: any) {
    console.error('Magic link email landing error:', error);
    return res.status(500).type('html').send(
      renderLanding({
        title: 'Bir şeyler ters gitti',
        body: 'Bağlantıyı işleyemedik. Lütfen uygulamadan tekrar dene.',
        tone: 'error',
      }),
    );
  }
});

router.get('/:token', async (req: any, res: any) => {
  try {
    const { consumeMagicLink } = await import('../services/onboardingService.js');
    const result = await consumeMagicLink(String(req.params.token || ''));
    if (!result || result.side !== 'phone') {
      return res
        .status(400)
        .type('html')
        .send(
          renderLanding({
            title: 'Bağlantı geçersiz',
            body: 'Bu doğrulama bağlantısı süresi dolmuş veya daha önce kullanılmış olabilir. Lütfen uygulamadan yeni bir kod iste.',
            tone: 'error',
          }),
        );
    }
    return res.status(200).type('html').send(
      renderLanding({
        title: 'Telefonun doğrulandı',
        body: 'WhatsApp numaranı başarıyla doğruladık.',
        tone: 'success',
      }),
    );
  } catch (error: any) {
    console.error('Magic link phone landing error:', error);
    return res.status(500).type('html').send(
      renderLanding({
        title: 'Bir şeyler ters gitti',
        body: 'Bağlantıyı işleyemedik. Lütfen uygulamadan tekrar dene.',
        tone: 'error',
      }),
    );
  }
});

export default router;
