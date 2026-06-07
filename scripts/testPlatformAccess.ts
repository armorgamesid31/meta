import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import {
  getActivePlatformRole,
  resolveEnterableSalon,
  PLATFORM_EFFECTIVE_ROLE,
} from '../src/services/platformAccess.js';
import { createPlatformAccessTokens } from '../src/services/mobileAuth.js';
import { verifyToken } from '../src/utils/jwt.js';

// Isolated end-to-end check of the platform-access core logic against the
// live DB. Imports ONLY the building blocks (no server.ts) so no cron/timer
// or webhook listener starts. Run with: npx tsx scripts/testPlatformAccess.ts

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`, extra ?? '');
  }
}

async function main() {
  const PLATFORM_EMAIL = 'platform@kedyapp.com';

  const platform = await prisma.userIdentity.findFirst({
    where: { email: PLATFORM_EMAIL },
    select: { id: true },
  });
  if (!platform) throw new Error(`${PLATFORM_EMAIL} bulunamadi — once grantPlatformRole calistir.`);

  const normal = await prisma.userIdentity.findFirst({
    where: { platformRole: null, isActive: true, NOT: { id: platform.id } },
    select: { id: true },
  });
  const activeSalon = await prisma.salon.findFirst({
    where: { status: 'ACTIVE', deletionScheduledAt: null },
    select: { id: true, name: true },
  });
  if (!activeSalon) throw new Error('Aktif salon bulunamadi.');

  console.log(
    `\nplatform id=${platform.id}, normal id=${normal?.id ?? 'yok'}, salon id=${activeSalon.id} (${activeSalon.name})\n`,
  );

  // 1. Platform role recognised from the live DB
  const role = await getActivePlatformRole(platform.id);
  check('getActivePlatformRole(platform) === PLATFORM_ADMIN', role === 'PLATFORM_ADMIN', role);

  // 2. Ordinary account is NOT a platform operator
  if (normal) {
    const r2 = await getActivePlatformRole(normal.id);
    check('getActivePlatformRole(normal) === null', r2 === null, r2);
  }

  // 3. Non-existent identity → null (no crash)
  check('getActivePlatformRole(0) === null', (await getActivePlatformRole(0)) === null);

  // 4. Enterable salon resolves; junk id does not
  const salon = await resolveEnterableSalon(activeSalon.id);
  check('resolveEnterableSalon(active) returns the salon', !!salon && salon.id === activeSalon.id);
  check('resolveEnterableSalon(999999) === null', (await resolveEnterableSalon(999999)) === null);

  // 5. Token mint → verify shape: platformRole + salonId + OWNER, NO membershipId
  const { accessToken } = await createPlatformAccessTokens({
    identityId: platform.id,
    salonId: activeSalon.id,
    platformRole: 'PLATFORM_ADMIN',
  });
  const payload = verifyToken(accessToken) as any;
  check('token verifies', !!payload, payload);
  check('token.platformRole === PLATFORM_ADMIN', payload?.platformRole === 'PLATFORM_ADMIN', payload?.platformRole);
  check('token.salonId === salon', payload?.salonId === activeSalon.id, payload?.salonId);
  check('token.identityId === platform', payload?.identityId === platform.id, payload?.identityId);
  check('token has NO membershipId', !payload?.membershipId, payload?.membershipId);
  check('token.role === OWNER (effective)', payload?.role === PLATFORM_EFFECTIVE_ROLE, payload?.role);

  // 6. Session row: membership-less, salon-scoped
  const session = await prisma.mobileAuthSession.findFirst({
    where: { identityId: platform.id, salonId: activeSalon.id, revokedAt: null },
    orderBy: { id: 'desc' },
    select: { id: true, membershipId: true, salonId: true, userId: true },
  });
  check('session: salonId set', session?.salonId === activeSalon.id, session?.salonId);
  check('session: membershipId null', session?.membershipId === null, session?.membershipId);

  // Cleanup: revoke the test session so we don't leave a live refresh token.
  if (session) {
    await prisma.mobileAuthSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    console.log('\n  (test refresh session revoked)');
  }

  console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
