import type { Request, Response, NextFunction } from 'express';
import { BusinessError, ErrorCodes, type ApiErrorBody } from '../lib/errors.js';

const isProduction = process.env.NODE_ENV === 'production';

function inferCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION_FAILED;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}

export function errorMiddleware(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  const traceId = req.traceId;

  if (err instanceof BusinessError) {
    const body: ApiErrorBody = {
      code: err.code,
      message: err.message,
      details: err.details,
      traceId,
    };
    return res.status(err.status).json(body);
  }

  const status = typeof err?.status === 'number' ? err.status : 500;
  const fallbackCode = err?.code && typeof err.code === 'string' ? err.code : inferCodeFromStatus(status);
  const fallbackMessage =
    typeof err?.message === 'string' && err.message.length > 0
      ? err.message
      : 'Beklenmeyen bir hata oluştu.';

  if (status >= 500) {
    console.error(`[error ${traceId}] ${req.method} ${req.originalUrl}:`, err);
  }

  const body: ApiErrorBody = {
    code: fallbackCode,
    message: status >= 500 && isProduction ? 'Beklenmeyen bir sunucu hatası oluştu.' : fallbackMessage,
    traceId,
  };

  if (!isProduction && err?.stack) {
    body.details = { stack: String(err.stack).split('\n').slice(0, 6) };
  }

  res.status(status).json(body);
}
