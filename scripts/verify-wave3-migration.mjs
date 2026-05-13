import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const p = new PrismaClient();
try {
  // Yeni index var mı?
  const idx = await p.$queryRaw`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'Customer'
      AND indexname = 'idx_customer_salon_registration_status'
  `;
  console.log('Customer composite index:', idx.length > 0 ? '✅ exists' : '❌ missing');

  // Drift catchup'tan beklenen tablolar (örnek kontrol)
  const tables = await p.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('salon_journey_tasks', 'service_templates', 'VerificationLink', 'GlobalCustomerIdentity')
    ORDER BY table_name
  `;
  console.log('\nKey tables present:', tables.map(t => t.table_name).join(', '));

  // Migration history
  const migrations = await p.$queryRaw`
    SELECT migration_name, finished_at IS NOT NULL as applied
    FROM "_prisma_migrations"
    ORDER BY finished_at DESC NULLS LAST
    LIMIT 5
  `;
  console.log('\nRecent migrations:');
  for (const m of migrations) {
    console.log(`  ${m.applied ? '✅' : '⏸️ '} ${m.migration_name}`);
  }
} finally {
  await p.$disconnect();
}
