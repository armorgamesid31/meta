import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const p = new PrismaClient();
const s = await p.salon.findUnique({
  where: { id: 2 },
  select: { id: true, name: true, createdAt: true, onboardingStep: true, onboardingStatus: true,
    _count: { select: { services: true, staff: true, appointments: true, customers: true } } },
});
console.log(JSON.stringify(s, null, 2));
await p.$disconnect();
