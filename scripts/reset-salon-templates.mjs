// Hard-reset all tone-varied template rows for a salon. After the
// template body rewrites for Meta-bumped slots and the cascade-promote
// fix, the cleanest path is to delete every existing row so a fresh
// sync re-enqueues the 9 primary variations from scratch and only
// promotes reserves when valid+inFlight drops below 3.
//
// Usage: node scripts/reset-salon-templates.mjs <salonId>
//
// Only deletes rows that have templateKey set (i.e. our tone-varied
// pipeline rows). Legacy rows without templateKey are left alone.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SALON_ID = Number(process.argv[2] || 2);

const before = await prisma.salonMessageTemplate.count({
  where: { salonId: SALON_ID, templateKey: { not: null } },
});

const deleted = await prisma.salonMessageTemplate.deleteMany({
  where: { salonId: SALON_ID, templateKey: { not: null } },
});

console.log(`Salon ${SALON_ID}: had ${before} tone-varied rows, deleted ${deleted.count}.`);
console.log('Now trigger a fresh sync from the admin UI — the submitter will enqueue 9 primaries (3 keys not yet covered × 3 tones, scaled to all 9 logical keys = 27 primaries) and back off on reserves.');
await prisma.$disconnect();
