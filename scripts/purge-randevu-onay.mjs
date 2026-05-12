// Delete all kdy_randevu_onay rows for a given salon. Used after
// removing this template from the system entirely.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const SALON_ID = Number(process.argv[2] || 2);

const deleted = await prisma.salonMessageTemplate.deleteMany({
  where: {
    salonId: SALON_ID,
    OR: [
      { templateKey: 'kdy_randevu_onay' },
      { templateName: { startsWith: 'kdy_randevu_onay' } },
    ],
  },
});
console.log(`Deleted ${deleted.count} kdy_randevu_onay rows for salon ${SALON_ID}`);
await prisma.$disconnect();
