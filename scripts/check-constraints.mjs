import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const indexes = await prisma.$queryRawUnsafe(`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'SalonMessageTemplate'
  ORDER BY indexname
`);
console.log('All indexes:');
for (const i of indexes) console.log(`  ${i.indexname}: ${i.indexdef}`);

const constraints = await prisma.$queryRawUnsafe(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = '"SalonMessageTemplate"'::regclass
`);
console.log('\nAll constraints:');
for (const c of constraints) console.log(`  ${c.conname}: ${c.def}`);

await prisma.$disconnect();
