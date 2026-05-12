import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const SALON_ID = 2;

const salon = await prisma.salon.findUnique({
  where: { id: SALON_ID },
  select: {
    id: true, name: true, communicationTone: true,
    chakraPluginId: true, chakraPhoneNumberId: true,
    updatedAt: true,
  },
});
console.log('Salon:', salon);

const rows = await prisma.salonMessageTemplate.findMany({
  where: { salonId: SALON_ID },
  orderBy: [{ templateKey: 'asc' }, { tone: 'asc' }, { variantSlot: 'asc' }],
  select: {
    id: true, templateName: true, templateKey: true, tone: true, variantSlot: true,
    submissionState: true, metaStatus: true, expectedCategory: true, actualCategory: true,
    submissionAttempts: true, scheduledSubmitAt: true, lastSubmittedAt: true,
    approvedAt: true, rejectedAt: true, rejectionReason: true, createdAt: true,
  },
});

console.log(`\nTotal rows: ${rows.length}`);
const byState = {};
for (const r of rows) byState[r.submissionState] = (byState[r.submissionState] || 0) + 1;
console.log('By state:', byState);

const byKey = {};
for (const r of rows) {
  const k = r.templateKey || r.templateName || 'unknown';
  byKey[k] = (byKey[k] || 0) + 1;
}
console.log('By templateKey:', byKey);

console.log('\nFirst 5 rows:');
for (const r of rows.slice(0, 5)) {
  console.log(`  #${r.id} ${r.templateName} | key=${r.templateKey} tone=${r.tone} slot=${r.variantSlot} | state=${r.submissionState} meta=${r.metaStatus} | sched=${r.scheduledSubmitAt?.toISOString()} created=${r.createdAt?.toISOString()}`);
}

console.log('\nMost recent rows:');
const recent = [...rows].sort((a,b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)).slice(0, 5);
for (const r of recent) {
  console.log(`  #${r.id} ${r.templateName} | state=${r.submissionState} | created=${r.createdAt?.toISOString()} sched=${r.scheduledSubmitAt?.toISOString()}`);
}

console.log('\nQueued (NOT_QUEUED) ready to submit now:');
const now = new Date();
const ready = rows.filter(r => r.submissionState === 'NOT_QUEUED' && r.scheduledSubmitAt && r.scheduledSubmitAt <= now);
console.log(`  Count: ${ready.length}`);
for (const r of ready.slice(0, 3)) {
  console.log(`  #${r.id} ${r.templateName} | sched=${r.scheduledSubmitAt?.toISOString()}`);
}

console.log('\nQueued (NOT_QUEUED) future:');
const future = rows.filter(r => r.submissionState === 'NOT_QUEUED' && r.scheduledSubmitAt && r.scheduledSubmitAt > now);
console.log(`  Count: ${future.length}`);
if (future.length > 0) {
  const earliest = future.reduce((a,b) => a.scheduledSubmitAt < b.scheduledSubmitAt ? a : b);
  const latest = future.reduce((a,b) => a.scheduledSubmitAt > b.scheduledSubmitAt ? a : b);
  console.log(`  Earliest: ${earliest.scheduledSubmitAt?.toISOString()}`);
  console.log(`  Latest:   ${latest.scheduledSubmitAt?.toISOString()}`);
}

await prisma.$disconnect();
