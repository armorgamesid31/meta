import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { traceMiddleware } from '../src/middleware/trace.js';
import { errorMiddleware } from '../src/middleware/error.js';
import { validate } from '../src/middleware/validate.js';
import { BusinessError } from '../src/lib/errors.js';

function buildApp(handler: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  app.use(traceMiddleware);
  handler(app);
  app.use(errorMiddleware);
  return app;
}

describe('traceMiddleware', () => {
  it('generates a UUID-shaped traceId when none is sent', async () => {
    const app = buildApp((a) => a.get('/x', (req, res) => res.json({ traceId: req.traceId })));
    const res = await request(app).get('/x');
    expect(res.status).toBe(200);
    expect(res.body.traceId).toMatch(/^[0-9a-f-]{20,}$/i);
    expect(res.headers['x-trace-id']).toBe(res.body.traceId);
  });

  it('echoes a client-supplied X-Trace-Id', async () => {
    const app = buildApp((a) => a.get('/x', (req, res) => res.json({ traceId: req.traceId })));
    const res = await request(app).get('/x').set('X-Trace-Id', 'caller-supplied-id-123');
    expect(res.body.traceId).toBe('caller-supplied-id-123');
    expect(res.headers['x-trace-id']).toBe('caller-supplied-id-123');
  });

  it('rejects an absurdly long X-Trace-Id and falls back to a generated one', async () => {
    const app = buildApp((a) => a.get('/x', (req, res) => res.json({ traceId: req.traceId })));
    const long = 'a'.repeat(200);
    const res = await request(app).get('/x').set('X-Trace-Id', long);
    expect(res.body.traceId).not.toBe(long);
    expect(res.body.traceId).toMatch(/^[0-9a-f-]{20,}$/i);
  });
});

describe('errorMiddleware', () => {
  it('serializes BusinessError into the standard envelope', async () => {
    const app = buildApp((a) =>
      a.get('/boom', (_req, _res, next) => {
        next(new BusinessError('CUSTOM_CODE', 'Bir şey yanlış gitti.', 418, { reason: 'teapot' }));
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(418);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.code).toBe('CUSTOM_CODE');
    expect(res.body.message).toBe('Bir şey yanlış gitti.');
    expect(res.body.details).toEqual({ reason: 'teapot' });
    expect(res.body.traceId).toBeTruthy();
  });

  it('infers code from numeric status for non-BusinessError errors', async () => {
    const app = buildApp((a) =>
      a.get('/boom', (_req, _res, next) => {
        const err: any = new Error('forbidden');
        err.status = 403;
        next(err);
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 500 INTERNAL_ERROR for raw thrown errors', async () => {
    const app = buildApp((a) =>
      a.get('/boom', (_req, _res, next) => {
        next(new Error('unexpected'));
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.traceId).toBeTruthy();
  });

  it('preserves the trace id through the response body', async () => {
    const app = buildApp((a) =>
      a.get('/boom', (_req, _res, next) => {
        next(new BusinessError('NOT_FOUND', 'Yok.', 404));
      }),
    );
    const res = await request(app).get('/boom').set('X-Trace-Id', 'fixed-trace-abc');
    expect(res.body.traceId).toBe('fixed-trace-abc');
    expect(res.headers['x-trace-id']).toBe('fixed-trace-abc');
  });
});

describe('validate middleware', () => {
  const BodySchema = z.object({
    name: z.string().min(2),
    age: z.number().int().nonnegative(),
  });

  it('passes valid bodies through and exposes parsed data on req.validated', async () => {
    const app = buildApp((a) =>
      a.post('/x', validate({ body: BodySchema }), (req, res) => {
        res.json({ got: (req as any).validated.body });
      }),
    );
    const res = await request(app).post('/x').send({ name: 'Ali', age: 30 });
    expect(res.status).toBe(200);
    expect(res.body.got).toEqual({ name: 'Ali', age: 30 });
  });

  it('returns VALIDATION_FAILED with field-level details for bad bodies', async () => {
    const app = buildApp((a) =>
      a.post('/x', validate({ body: BodySchema }), (_req, res) => res.json({ ok: true })),
    );
    const res = await request(app).post('/x').send({ name: 'A', age: -1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.message).toMatch(/alan/i); // "field" in Turkish
    expect(res.body.traceId).toBeTruthy();
  });

  it('validates query params when configured', async () => {
    const QuerySchema = z.object({
      limit: z.string().regex(/^\d+$/),
    });
    const app = buildApp((a) =>
      a.get('/x', validate({ query: QuerySchema }), (_req, res) => res.json({ ok: true })),
    );
    const ok = await request(app).get('/x?limit=10');
    expect(ok.status).toBe(200);
    const bad = await request(app).get('/x?limit=abc');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });
});
