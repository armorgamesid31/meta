// Activation-code retention job.
//
// Each row in StripeCheckoutAttempt carries a plaintext activationCode for
// the marketing success page to display once. We only need that plaintext
// alive long enough for the customer to copy it (and as a backup if the
// email/WhatsApp delivery failed). After 24 hours we wipe the plaintext —
// the underlying Invite row still has the hashed code, so activation in
// the mobile app continues to work via /auth/invites/activate.
//
// Scheduled via the simple setInterval helper in src/jobs/index.ts.

import { prisma } from '../prisma.js';

const RETENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function cleanupActivationCodes(): Promise<{ cleared: number }> {
  const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);

  const result = await prisma.stripeCheckoutAttempt.updateMany({
    where: {
      completedAt: { lt: cutoff },
      activationCode: { not: null },
    },
    data: {
      activationCode: null,
    },
  });

  return { cleared: result.count };
}
