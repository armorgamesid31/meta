import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();
const stmts = [
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "category" "SalonCategory"`,
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "kurulumScore" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "kurulumStage" TEXT`,
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "onboardingSkipped" TEXT[] DEFAULT ARRAY[]::TEXT[]`,
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED'`,
  `ALTER TABLE "Salon" ADD COLUMN IF NOT EXISTS "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'NOT_STARTED'`,
  `CREATE TABLE IF NOT EXISTS "salon_journey_tasks" (
     "id" SERIAL NOT NULL,
     "salonId" INTEGER NOT NULL,
     "taskKey" TEXT NOT NULL,
     "completedAt" TIMESTAMP(3),
     "points" INTEGER NOT NULL,
     "metadata" JSONB,
     "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "salon_journey_tasks_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE TABLE IF NOT EXISTS "service_templates" (
     "id" SERIAL NOT NULL,
     "category" "SalonCategory" NOT NULL,
     "name" TEXT NOT NULL,
     "defaultDurationMin" INTEGER NOT NULL DEFAULT 30,
     "defaultPriceTRY" INTEGER,
     "serviceCategoryId" INTEGER,
     "displayOrder" INTEGER NOT NULL DEFAULT 0,
     "isActive" BOOLEAN NOT NULL DEFAULT true,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "service_templates_pkey" PRIMARY KEY ("id")
   )`,
];

let ok = 0, fail = 0;
for (const s of stmts) {
  const first = s.split('\n')[0].slice(0, 80);
  try {
    await prisma.$executeRawUnsafe(s);
    ok++;
    console.log(`OK   | ${first}`);
  } catch (e) {
    fail++;
    console.log(`FAIL | ${first} | ${String(e.message).split('\n')[0]}`);
  }
}

// FKs in DO blocks (separate calls)
const fks = [
  {
    name: 'salon_journey_tasks_salonId_fkey',
    sql: `ALTER TABLE "salon_journey_tasks" ADD CONSTRAINT "salon_journey_tasks_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE`,
  },
  {
    name: 'service_templates_serviceCategoryId_fkey',
    sql: `ALTER TABLE "service_templates" ADD CONSTRAINT "service_templates_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL`,
  },
];
for (const fk of fks) {
  try {
    await prisma.$executeRawUnsafe(fk.sql);
    ok++;
    console.log(`OK   | FK ${fk.name}`);
  } catch (e) {
    const msg = String(e.message).split('\n')[0];
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      ok++;
      console.log(`SKIP | FK ${fk.name} (already exists)`);
    } else {
      fail++;
      console.log(`FAIL | FK ${fk.name} | ${msg}`);
    }
  }
}

console.log(`\nTotal: ${ok} ok, ${fail} fail`);
await prisma.$disconnect();
