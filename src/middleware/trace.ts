import type { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import * as Sentry from '@sentry/node';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-trace-id');
  const traceId = incoming && incoming.length <= 64 ? incoming : uuid();
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  // Tag the current Sentry scope with the traceId so any captured event
  // surfaced from this request is searchable by the same code that the
  // frontend shows to the user as "Kod: <traceId>".
  try {
    Sentry.getCurrentScope()?.setTag('traceId', traceId);
  } catch {
    // Sentry not initialized (no DSN) — ignore.
  }
  next();
}
