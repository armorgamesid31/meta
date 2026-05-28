// Pin server timezone before any other module reads Date.
// All Date operations in the availability engine + appointment storage
// currently target a single salon-local timezone. Multi-tenant timezone
// (yurt dışı salonlar) is a future iteration; per-salon override will be
// driven by SalonSettings.timezone.
//
// This must be the very first import in server.ts so the TZ is set
// before sentry/prisma/route modules pull in Date.
process.env.TZ = 'Europe/Istanbul';

const resolvedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (resolvedTimezone !== 'Europe/Istanbul') {
  console.warn(
    `[bootstrap] Requested TZ=Europe/Istanbul but runtime reports "${resolvedTimezone}". ` +
      'If this is a long-running server, restart with TZ=Europe/Istanbul in the environment.',
  );
} else {
  console.log(`[bootstrap] Server timezone pinned to ${resolvedTimezone}`);
}
