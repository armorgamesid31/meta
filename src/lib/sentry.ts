import * as Sentry from '@sentry/node';

// Sentry initializasyonu — DSN env yoksa hiçbir şey yapma.
// Profiling ve yüksek trace örnekleme küçük instance'larda event loop'u
// blokladığı için kapatıldı; sadece error capture açık.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    enabled: true,
    tracesSampleRate: 0.01,
  });
}

export { Sentry };
