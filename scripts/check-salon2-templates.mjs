import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SALON_ID = 2;

const rows = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID },
  orderBy: [{ id: 'asc' }],
  select: {
    id: true, templateName: true, templateKey: true, tone: true, variantSlot: true,
    submissionState: true, metaStatus: true, scheduledSubmitAt: true, eventType: true,
  },
});

console.log(`Total rows: ${rows.length}`);
for (const r of rows) {
  console.log(`  #${r.id} ${r.templateName} | event=${r.eventType} key=${r.templateKey} tone=${r.tone} slot=${r.variantSlot} | state=${r.submissionState} meta=${r.metaStatus} | sched=${r.scheduledSubmitAt?.toISOString() ?? 'NULL'}`);
}

// Check Prisma DB constraints
const constraints = await prisma.$queryRawUnsafe(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = '"SalonMessageTemplate"'::regclass
    AND contype IN ('u', 'p')
  ORDER BY conname
`);
console.log('\nUnique/PK constraints on SalonMessageTemplate:');
console.log(constraints);

await prisma.$disconnect();
