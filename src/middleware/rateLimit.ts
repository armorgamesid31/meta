import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { BusinessError } from '../lib/errors.js';

/**
 * Strict limiter for auth-style endpoints (login, refresh, register,
 * password reset). Defends against credential stuffing and brute force.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
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
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip when a valid token is present + API is internal use; tune as
  // we collect real telemetry. For now we apply broadly to be safe.
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
