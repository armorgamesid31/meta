import { PrismaClient, Prisma } from '@prisma/client';

let prisma: PrismaClient;

declare global {
  var __db: PrismaClient | undefined;
}

const LOG_QUERIES = process.env.PRISMA_LOG_QUERIES === 'true';
const SLOW_QUERY_MS = Number(process.env.PRISMA_SLOW_QUERY_MS || 500);

function buildClient(): PrismaClient {
  // DATABASE_URL must include ?connection_limit=N&pool_timeout=N for production.
  // Defaults: connection_limit=num_cpus, pool_timeout=10 — too tight for n8n
  // concurrency burst. See .env.example for recommended values.
  const client = new PrismaClient({
    log: LOG_QUERIES
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
    // Default transaction timeout: 5s is too tight for some batch ops.
    transactionOptions: {
      maxWait: 10_000, // wait up to 10s for a connection
      timeout: 30_000, // transaction must complete within 30s
    },
  });

  // Surface slow queries so we can tune indexes.
  (client as any).$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration >= SLOW_QUERY_MS) {
      console.warn('[prisma slow query]', {
        durationMs: e.duration,
        query: e.query.slice(0, 200),
      });
    }
  });

  (client as any).$on('warn', (e: Prisma.LogEvent) => {
    console.warn('[prisma warn]', e.message);
  });

  (client as any).$on('error', (e: Prisma.LogEvent) => {
    console.error('[prisma error]', e.message);
  });

  return client;
}

if (process.env.NODE_ENV === 'production') {
  prisma = buildClient();
  prisma.$connect().catch((err) => console.error('[prisma] initial connect failed', err));
} else {
  if (!global.__db) {
    global.__db = buildClient();
    global.__db.$connect().catch((err) => console.error('[prisma] initial connect failed', err));
  }
  prisma = global.__db;
}

export { prisma };
