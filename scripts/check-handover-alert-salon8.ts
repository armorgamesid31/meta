import { prisma } from '../src/prisma.js';

const SALON_ID = 8;

// 1) HandoverAlertState
const alerts: any[] = await prisma.$queryRawUnsafe(`
  SELECT "channel", "conversationKey", "state", "repeatCount",
         "firstTriggeredAt", "lastTriggeredAt", "stoppedAt", "updatedAt"
  FROM "HandoverAlertState"
  WHERE "salonId" = ${SALON_ID}
  ORDER BY "updatedAt" DESC LIMIT 5
`);
console.log('\n[1] HandoverAlertState (son 5):');
for (const a of alerts) {
  console.log(`  ${a.updatedAt.toISOString()}  ${a.channel.padEnd(10)} state=${a.state.padEnd(10)} repeat=${a.repeatCount}  conv=${a.conversationKey}`);
}

// 2) AppNotification (HANDOVER_REQUIRED)
const notifs: any[] = await prisma.$queryRawUnsafe(`
  SELECT n.id, n."eventType", n."title", n."body", n."createdAt"
  FROM "AppNotification" n
  WHERE n."salonId" = ${SALON_ID}
    AND n."eventType" = 'HANDOVER_REQUIRED'
  ORDER BY n."createdAt" DESC LIMIT 5
`);
console.log('\n[2] AppNotification (HANDOVER_REQUIRED, son 5):');
for (const n of notifs) {
  console.log(`  ${n.createdAt.toISOString()}  id=${n.id}  "${n.title}"`);
  console.log(`     body: ${n.body.replace(/\n/g, ' | ')}`);
}

// 3) AppNotificationDelivery (push / inApp dispatched mı)
if (notifs.length) {
  const ids = notifs.map((n) => n.id).join(',');
  const dels: any[] = await prisma.$queryRawUnsafe(`
    SELECT "notificationId", "userId", "channel", "status", "failureReason", "readAt", "createdAt"
    FROM "AppNotificationDelivery"
    WHERE "notificationId" IN (${ids})
    ORDER BY "createdAt" DESC LIMIT 20
  `);
  console.log('\n[3] AppNotificationDelivery (son handover bildirim teslimatları):');
  if (!dels.length) console.log('  (hiçbir teslimat kaydı yok — push provider yapılandırılmamış veya recipient yok)');
  for (const d of dels) {
    console.log(`  notif=${d.notificationId}  user=${d.userId}  channel=${d.channel.padEnd(8)}  status=${d.status.padEnd(12)}  read=${d.readAt ? '✅' : '❌'}  err=${d.failureReason || '-'}`);
  }
}

await prisma.$disconnect();
