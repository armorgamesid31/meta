import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to enforce X-Internal-API-Key validation for server-to-server or n8n communications.
 * If INTERNAL_API_KEY is not defined in environment, it logs a warning but allows traffic
 * to avoid breaking deployments during migration. In production, this key MUST be set.
 */
export function requireInternalApiKey(req: Request, res: Response, next: NextFunction) {
  const configuredKey = process.env.INTERNAL_API_KEY;

  if (!configuredKey) {
    console.warn('[SECURITY WARNING] INTERNAL_API_KEY is not set. Internal routes are currently unprotected!');
    return next();
  }

  const incomingKey = req.headers['x-internal-api-key'];

  if (!incomingKey || typeof incomingKey !== 'string' || incomingKey !== configuredKey) {
    console.error(`[SECURITY] Unauthorized internal access attempt from ${req.ip}`);
    return res.status(401).json({ 
      ok: false, 
      message: 'Unauthorized: Missing or invalid internal API key.' 
    });
  }

  next();
}
