// One-shot verification of the template_submission_state_and_global_customer
// migration. Reports row counts and obvious anomalies.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('▶ Verifying migration...\n');

  // 1. SalonMessageTemplate new columns
  const tmplCount = await prisma.salonMessageTemplate.count();
  const stateBreakdown = await prisma.$queryRawUnsafe(`
    SELECT "submissionState"::text AS state, COUNT(*)::int AS n
    FROM "SalonMessageTemplate"
    GROUP BY "submissionState"
    ORDER BY n DESC
  `);
  console.log(`SalonMessageTemplate: ${tmplCount} total rows`);
  console.log('  by submissionState:', stateBreakdown);

  // 2. GlobalCustomerIdentity table + backfill
  const giCount = await prisma.globalCustomerIdentity.count();
  console.log(`\nGlobalCustomerIdentity: ${giCount} rows`);

  // 3. Customer linkage
  const customerCount = await prisma.customer.count();
  const linkedCount = await prisma.customer.count({
    where: { globalIdentityId: { not: null } },
  });
  console.log(`\nCustomer: ${customerCount} total, ${linkedCount} linked to GlobalCustomerIdentity (${((linkedCount / Math.max(customerCount, 1)) * 100).toFixed(1)}%)`);

  // 4. firstAppointmentAt backfill
  const withFirstAppt = await prisma.customer.count({
    where: { firstAppointmentAt: { not: null } },
  });
  console.log(`Customer.firstAppointmentAt populated: ${withFirstAppt}`);

  // 5. Orphan check — any Customer with phone but no globalIdentityId?
  const orphans = await prisma.customer.count({
    where: {
      AND: [
        { phone: { not: '' } },
        { globalIdentityId: null },
      ],
    },
  });
  if (orphans > 0) {
    console.log(`\n⚠ ${orphans} customers have phone but no globalIdentityId link`);
  } else {
    console.log(`\n✓ All customers with phone are linked.`);
  }

  // 6. Duplicate global identity phones (shouldn't happen — unique constraint)
  const dupPhones = await prisma.$queryRawUnsafe(`
    SELECT "phoneE164", COUNT(*)::int AS n
    FROM "GlobalCustomerIdentity"
    GROUP BY "phoneE164"
    HAVING COUNT(*) > 1
    LIMIT 10
  `);
  if (Array.isArray(dupPhones) && dupPhones.length > 0) {
    console.log('⚠ Duplicate phones in GlobalCustomerIdentity:', dupPhones);
  } else {
    console.log('✓ No duplicate phones in GlobalCustomerIdentity.');
  }

  console.log('\nMigration verification complete.');
}

main()
  .catch((err) => {
    console.error('Verification failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
