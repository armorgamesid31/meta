import { PrismaClient, UserRole } from '@prisma/client';
import 'dotenv/config';
const p = new PrismaClient();
try {
  const salonId = 8;
  // Find OWNER membership
  const owner = await p.salonMembership.findFirst({
    where: { salonId, role: UserRole.OWNER, isActive: true },
    include: { identity: true },
  });
  console.log('OWNER membership:', owner?.id, 'identity:', owner?.identityId, 'displayName:', owner?.identity?.displayName);
  if (!owner) { console.log('NO ACTIVE OWNER'); process.exit(1); }

  // Permission grants for OWNER role in this salon
  const grants = await p.salonRolePermission.findMany({
    where: { salonId, role: UserRole.OWNER, granted: true },
    include: { permission: { select: { key: true } } },
  });
  const keys = grants.map(g => g.permission.key).sort();
  console.log(`\nOWNER granted permissions (${keys.length}):`);
  console.log(' ', keys.join(', ') || '(none)');
  console.log(`\nHas access.users.manage? ${keys.includes('access.users.manage')}`);

  // Per-membership overrides
  const overrides = await p.salonMembershipPermission.findMany({
    where: { salonId, membershipId: owner.id },
    include: { permission: { select: { key: true } } },
  });
  console.log(`\nPer-membership overrides (${overrides.length}):`);
  for (const o of overrides) console.log(`  ${o.permission.key}: granted=${o.granted}`);
} catch (e) { console.error(e.message); }
finally { await p.$disconnect(); }
