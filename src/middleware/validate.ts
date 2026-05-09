import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { BusinessError } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

declare global {
  namespace Express {
    interface Request {
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

interface ValidateOptions {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function describeIssue(source: Source, path: PropertyKey[], message: string): string {
  const fieldPath = path.length ? path.map(String).join('.') : source;
  return `${fieldPath}: ${message}`;
}

export function validate(options: ValidateOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.validated = req.validated ?? {};
    const errors: string[] = [];
    const details: Record<string, unknown> = {};

    for (const source of ['body', 'query', 'params'] as const) {
      const schema = options[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push(describeIssue(source, issue.path, issue.message));
        }
        details[source] = result.error.issues;
        continue;
      }
      req.validated[source] = result.data;
    }

    if (errors.length) {
      return next(
        new BusinessError(
          'VALIDATION_FAILED',
          errors.length === 1 ? errors[0] : `${errors.length} alan geçersiz: ${errors.join('; ')}`,
          400,
          details,
        ),
      );
    }

    next();
  };
}

export type ValidatedBody<S extends ZodTypeAny> = ZodInfer<S>;
