import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const p = new PrismaClient();
try {
  // Check tables exist
  const tasks = await p.$queryRaw`SELECT COUNT(*)::int as c FROM salon_journey_tasks`;
  const templates = await p.$queryRaw`SELECT COUNT(*)::int as c FROM service_templates`;
  // Check Salon columns
  const cols = await p.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Salon' AND column_name IN ('category','kurulumScore','kurulumStage','onboardingStep','onboardingSkipped','onboardingStatus','onboardingCompletedAt')
    ORDER BY column_name`;
  // Check FKs
  const fks = await p.$queryRaw`
    SELECT conname FROM pg_constraint
    WHERE conname IN ('salon_journey_tasks_salonId_fkey','service_templates_serviceCategoryId_fkey')`;
  // Check activation code column
  const activationCol = await p.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'StripeCheckoutAttempt' AND column_name = 'activationCode'`;
  console.log('salon_journey_tasks rows:', tasks);
  console.log('service_templates rows:', templates);
  console.log('Salon new cols:', cols);
  console.log('FKs present:', fks);
  console.log('StripeCheckoutAttempt.activationCode:', activationCol);
} finally {
  await p.$disconnect();
}
