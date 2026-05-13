import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to enforce X-Internal-API-Key validation for server-to-server or n8n communications.
 * If INTERNAL_API_KEY is not defined in environment, it logs a warning but allows traffic
 * to avoid breaking deployments during migration. In production, this key MUST be set.
 */
export function requireInternalApiKey(req: Request, res: Response, next: NextFunction) {
  const acceptedKeys = [
    String(process.env.INTERNAL_API_KEY || '').trim(),
    String(process.env.N8N_INTERNAL_API_KEY || '').trim(),
  ].filter(Boolean);

  if (acceptedKeys.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[SECURITY] INTERNAL_API_KEY/N8N_INTERNAL_API_KEY missing in production — refusing internal request.');
      return res.status(503).json({
        ok: false,
        message: 'Internal API not configured.',
      });
    }
    console.warn('[SECURITY WARNING] INTERNAL_API_KEY/N8N_INTERNAL_API_KEY is not set. Internal routes are currently unprotected!');
    return next();
  }

  const incomingKey = String(req.headers['x-internal-api-key'] || '').trim();

  if (!incomingKey || !acceptedKeys.includes(incomingKey)) {
    console.error(`[SECURITY] Unauthorized internal access attempt from ${req.ip}`);
    return res.status(401).json({ 
      ok: false, 
      message: 'Unauthorized: Missing or invalid internal API key.' 
    });
  }

  next();
}
