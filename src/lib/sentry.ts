import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Sentry initializasyonu — DSN env yoksa hiçbir şey yapma.
// Bu sayede production deploy'una env eklenmeden patlamaz.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
  });
}

export { Sentry };
