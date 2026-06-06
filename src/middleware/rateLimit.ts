import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { BusinessError } from '../lib/errors.js';

/**
 * Strict limiter for auth-style endpoints (login, refresh, register,
 * password reset). Defends against credential stuffing and brute force.
 *
 * Onboarding endpoints are *excluded* from this strict bucket — they
 * carry their own state (OnboardingSession id with a short TTL +
 * per-session send counts on magic-link senders) and the UI polls
 * /auth/onboarding/:id/status while waiting for the user to tap a
 * magic-link in WhatsApp/email. Rate-limiting that poll just makes
 * the screen flicker between "doğrulanıyor" and "rate limited" with
 * no security upside.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    // Express strips the mount prefix, so req.path here is relative
    // to /api/auth (e.g. "/onboarding/:id/status"). Accept either
    // shape for safety in case the mount changes.
    const p = req.path || req.originalUrl || '';
    return p.includes('/onboarding/');
  },
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new BusinessError(
        'RATE_LIMITED',
        'Çok fazla deneme yaptınız. 1 dakika sonra tekrar deneyin.',
        429,
      ),
    );
  },
});

/**
 * Looser limiter for general /api traffic. Applied after multiTenant so
 * authenticated users with valid tokens still hit it but the budget is
 * generous enough that normal usage never sees it.
 *
 * Booking pricing-preview YUKARI bumped: kullanıcı hizmet ekle/çıkar
 * yaptıkça frontend hem sepet hem catalog her hizmet için ayrı preview
 * çağırıyor. 4 hizmetli katalog + hızlı tıklama = 100+/min normal.
 * Önceki 240 limit 12 tıklamada 78 × 429 üretiyordu, "Kampanyalar
 * hesaplanamadı" banner spamına yol açıyordu. Catalog preview frontend'de
 * 3'erli batch + 300ms debounce'a alındı, server-side de daha gevşek bir
 * tavan: 1200/min (20 req/sec ortalama, burst-friendly).
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  // Read-only "preview" endpoint'leri için ayrı bucket olabilir; şimdilik
  // tek tavan yeterli. Telemetry topladıkça bölümlere ayır.
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new BusinessError(
        'RATE_LIMITED',
        'İstek limiti aşıldı, lütfen yavaşlatın.',
        429,
      ),
    );
  },
});
