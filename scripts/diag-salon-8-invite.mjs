import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
const p = new PrismaClient();
try {
  const salonId = 8;
  const memberships = await p.salonMembership.findMany({
    where: { salonId, isActive: true },
    include: { identity: { select: { id: true, displayName: true, email: true, phone: true } } },
  });
  console.log(`Salon ${salonId} memberships:`);
  for (const m of memberships) {
    console.log(`  - membership=${m.id} identity=${m.identity?.id} role=${m.role} secondary=${JSON.stringify(m.secondaryRoles)} displayName="${m.identity?.displayName}"`);
  }
  const owner = memberships.find(m => m.role === 'OWNER');
  if (!owner) { console.log('NO OWNER FOUND'); }
  else {
    // Try the permissions resolver pattern
    const permList = await p.$queryRaw`
      SELECT DISTINCT p."key"
      FROM "SalonRolePermission" srp
      JOIN "PermissionDefinition" p ON p.id = srp."permissionId"
      WHERE srp."salonId" = ${salonId} AND srp.role = ${owner.role}::"UserRole" AND srp."granted" = true
    `;
    console.log(`\nOwner (membership ${owner.id}) granted permissions (${permList.length}):`);
    const keys = permList.map(r => r.key).sort();
    console.log(' ', keys.join(', ') || '(none)');
    console.log(`\nHas access.users.manage? ${keys.includes('access.users.manage')}`);
  }
  // Recent invites for salon 8
  const invites = await p.invite.findMany({
    where: { salonId },
    orderBy: { id: 'desc' },
    take: 5,
    select: { id: true, status: true, expiresAt: true, createdAt: true, invitedMembershipId: true },
  });
  console.log(`\nLast 5 invites for salon ${salonId}:`);
  for (const i of invites) {
    console.log(`  id=${i.id} status=${i.status} created=${i.createdAt?.toISOString()} expires=${i.expiresAt?.toISOString()} membership=${i.invitedMembershipId}`);
  }
} finally { await p.$disconnect(); }
