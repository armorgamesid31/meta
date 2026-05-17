import { prisma } from '../src/prisma.js';

const u: any[] = await prisma.$queryRawUnsafe(
  `SELECT id, email, role, "salonId", "firstName", "lastName", "isActive" FROM "SalonUser" WHERE id = 10`,
);
console.log('user=10 :', u[0] || '(not found)');

const all8: any[] = await prisma.$queryRawUnsafe(
  `SELECT id, email, role, "isActive" FROM "SalonUser" WHERE "salonId" = 8 ORDER BY id`,
);
console.log('salon 8 users:', all8);

const allDel: any[] = await prisma.$queryRawUnsafe(
  `SELECT id, "notificationId", "salonId", "userId", channel, status, "failureReason" FROM "AppNotificationDelivery" WHERE "notificationId" = 367`,
);
console.log('delivery rows for notif 367:', allDel);

// user=10 hangi salonda push tokenı var?
const tokens10: any[] = await prisma.$queryRawUnsafe(
  `SELECT id, "salonId", platform, "isActive", "lastSeenAt" FROM "PushDeviceToken" WHERE "userId" = 10`,
);
console.log('user=10 push tokens (any salon):', tokens10);

await prisma.$disconnect();
