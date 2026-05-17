import { prisma } from '../src/prisma.js';

const USER_ID = 10;
const SALON_ID = 8;

// 1) Salon 8 admin/owner kim?
const users: any[] = await prisma.$queryRawUnsafe(`
  SELECT u.id, u.email, u.role, u."salonId", u."firstName", u."lastName"
  FROM "SalonUser" u
  WHERE u."salonId" = ${SALON_ID}
  ORDER BY u.id
`);
console.log(`\n[1] Salon ${SALON_ID} kullanıcıları:`);
for (const u of users) {
  console.log(`  user=${u.id}  ${u.email}  role=${u.role}  ${u.firstName || ''} ${u.lastName || ''}`);
}

// 2) PushDeviceToken — salon 8'in tüm aktif tokenları
const tokens: any[] = await prisma.$queryRawUnsafe(`
  SELECT id, "userId", platform, "isActive", "lastSeenAt", "createdAt",
         LENGTH(token) AS token_len, LEFT(token, 12) AS token_prefix
  FROM "PushDeviceToken"
  WHERE "salonId" = ${SALON_ID}
  ORDER BY "userId", "lastSeenAt" DESC NULLS LAST
`);
console.log(`\n[2] PushDeviceToken (salon=${SALON_ID}):`);
if (!tokens.length) {
  console.log('  (HİÇ TOKEN YOK — mobil app push iznini hiç vermemiş ya da kayıt başarısız)');
} else {
  for (const t of tokens) {
    console.log(`  user=${t.userId}  platform=${t.platform.padEnd(8)}  active=${t.isActive}  lastSeen=${t.lastSeenAt?.toISOString() || '-'}  len=${t.token_len}  pref=${t.token_prefix}...`);
  }
}

// 3) UserNotificationPreference — handover bildirimi push devre dışı mı?
const prefs: any[] = await prisma.$queryRawUnsafe(`
  SELECT p."userId", p."eventType", p."inAppEnabled", p."pushEnabled", p."emailEnabled"
  FROM "UserNotificationPreference" p
  WHERE p."salonId" = ${SALON_ID}
    AND p."eventType" = 'HANDOVER_REQUIRED'
`);
console.log(`\n[3] UserNotificationPreference (HANDOVER_REQUIRED):`);
if (!prefs.length) console.log('  (özel tercih yok — default davranış uygulanır)');
for (const p of prefs) {
  console.log(`  user=${p.userId}  inApp=${p.inAppEnabled}  push=${p.pushEnabled}  email=${p.emailEnabled}`);
}

// 4) Push provider config (env)
console.log(`\n[4] Push provider env:`);
console.log(`  FCM_*: ${process.env.FCM_SERVER_KEY ? 'set' : '❌ missing'} / ${process.env.FCM_PROJECT_ID ? 'set' : '❌ missing'} / ${process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'JSON set' : process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'path set' : '❌ missing'}`);
console.log(`  EXPO_*: ${process.env.EXPO_ACCESS_TOKEN ? 'set' : '❌ missing'}`);

await prisma.$disconnect();
