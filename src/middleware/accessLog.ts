import type { Request, Response, NextFunction } from 'express';

const SKIP_PATTERNS: RegExp[] = [
  /^\/health$/,
  /^\/favicon\.ico$/,
  /^\/assets\//,
];

const isProduction = process.env.NODE_ENV === 'production';

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(path));
}

export function accessLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (shouldSkip(req.path)) {
    return next();
  }

  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode;
    const traceId = req.traceId ?? '-';
    const method = req.method;
    const path = req.originalUrl || req.url;
    const slow = durationMs > 500 ? '[slow]' : '';

    if (isProduction) {
      console.log(
        JSON.stringify({
          type: 'access',
          traceId,
          method,
          path,
          status,
          durationMs,
          slow: durationMs > 500,
          ip: req.ip,
        }),
      );
    } else {
      const statusColor = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
      const reset = '\x1b[0m';
      console.log(
        `[req ${traceId.slice(0, 8)}] ${method} ${path} → ${statusColor}${status}${reset} ${durationMs}ms ${slow}`.trim(),
      );
    }
  });

  next();
}
