import type { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

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
  next();
}
