// Halt template submissions for a salon: deletes all NOT_QUEUED rows so
// the worker has nothing to send. Run before pushing template content
// fixes — then user re-presses "Senkronize Et" to seed fresh rows from
// the corrected templates.

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SALON_ID = Number(process.argv[2] || 2);

const deleted = await prisma.salonMessageTemplate.deleteMany({
  where: {
    salonId: SALON_ID,
    submissionState: 'NOT_QUEUED',
  },
});
console.log(`Salon ${SALON_ID}: deleted ${deleted.count} NOT_QUEUED rows`);

const remaining = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID },
  select: { templateName: true, submissionState: true, metaStatus: true },
});
console.log('Remaining:');
for (const r of remaining) console.log(`  ${r.templateName} | ${r.submissionState} | meta=${r.metaStatus}`);

await prisma.$disconnect();
