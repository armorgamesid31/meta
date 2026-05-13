/**
 * One-shot backfill: any salon that existed before the wizard shipped is
 * treated as COMPLETED so the gate doesn't trap them.
 *
 * Heuristic: salon was created more than 1 hour ago. Pre-wizard salons —
 * including ones that exist but never had services/staff added — are
 * treated as COMPLETED so the gate doesn't trap them. Brand-new salons
 * created via Stripe checkout in the last hour stay NOT_STARTED so they
 * enter the wizard.
 *
 * Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

try {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Identify candidate salons: NOT_STARTED and created more than an hour
  // ago. Brand-new (Stripe checkout in the last hour) salons stay
  // NOT_STARTED so the wizard kicks in for them.
  const candidates = await prisma.$queryRaw`
    SELECT s.id
    FROM "Salon" s
    WHERE s."onboardingStep" = 'NOT_STARTED'
      AND (s."createdAt" IS NULL OR s."createdAt" < ${oneHourAgo})
  `;

  const ids = candidates.map((r) => r.id);
  if (ids.length === 0) {
    console.log('No salons to backfill — nothing changed.');
  } else {
    console.log(`Backfilling ${ids.length} salon(s): ${ids.join(', ')}`);
    const result = await prisma.salon.updateMany({
      where: { id: { in: ids } },
      data: {
        onboardingStep: 'COMPLETED',
        onboardingStatus: 'COMPLETED',
        onboardingCompletedAt: new Date(),
      },
    });
    console.log(`Updated ${result.count} salon(s).`);
  }

  // Sanity: report current distribution.
  const counts = await prisma.$queryRaw`
    SELECT "onboardingStep"::text AS step, COUNT(*)::int AS c
    FROM "Salon"
    GROUP BY "onboardingStep"
    ORDER BY c DESC
  `;
  console.log('\nCurrent distribution of Salon.onboardingStep:');
  for (const row of counts) {
    console.log(`  ${row.step.padEnd(15)} ${row.c}`);
  }
} finally {
  await prisma.$disconnect();
}
