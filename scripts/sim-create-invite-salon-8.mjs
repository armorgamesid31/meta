import { PrismaClient, InviteStatus, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import 'dotenv/config';
const p = new PrismaClient();
const salonId = 8;
const role = 'STAFF';
const hashPlainToken = (s) => createHash('sha256').update(String(s)).digest('hex');
const buildSystemEmail = () => `team-${salonId}-staff-${Date.now()}-${randomBytes(4).toString('hex')}@kedy.local`;

try {
  const inviteCode = randomBytes(4).toString('hex').toUpperCase();
  const inviteToken = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const passwordHash = await bcrypt.hash(randomBytes(16).toString('hex'), 10);
  // Default display name pattern (closest replication)
  const existing = await p.salonMembership.count({ where: { salonId, isActive: true } });
  const displayName = `Ekip Üyesi ${existing}`;
  console.log('Will create with displayName:', displayName);

  const created = await p.$transaction(async (tx) => {
    const identity = await tx.userIdentity.create({
      data: {
        email: null,
        phone: null,
        displayName,
        passwordHash,
        isActive: true,
      },
    });
    console.log(' [tx] identity:', identity.id);
    const legacyUser = await tx.salonUser.create({
      data: {
        salonId,
        email: buildSystemEmail(),
        phone: null,
        displayName,
        role: UserRole.STAFF,
        secondaryRoles: [],
        passwordHash,
        isActive: true,
        passwordResetRequired: true,
      },
    });
    console.log(' [tx] legacyUser:', legacyUser.id);
    const membership = await tx.salonMembership.create({
      data: {
        salonId,
        identityId: identity.id,
        role: UserRole.STAFF,
        secondaryRoles: [],
        isActive: true,
        passwordResetRequired: true,
        legacySalonUserId: legacyUser.id,
      },
    });
    console.log(' [tx] membership:', membership.id);
    await tx.invite.create({
      data: {
        salonId,
        invitedUserId: legacyUser.id,
        invitedMembershipId: membership.id,
        invitedIdentityEmail: null,
        invitedIdentityPhone: null,
        inviteCodeHash: hashPlainToken(inviteCode),
        inviteTokenHash: hashPlainToken(inviteToken),
        expiresAt,
        createdBy: null,
      },
    });
    console.log(' [tx] invite created');
    return { id: membership.id, identityId: identity.id, role: membership.role };
  });

  console.log('\n✅ Full flow succeeded:', created);
  console.log('   inviteCode (plain):', inviteCode);

  // Cleanup test record
  await p.salonMembership.delete({ where: { id: created.id } });
  await p.userIdentity.delete({ where: { id: created.identityId } });
  console.log('✅ Cleanup done');
} catch (e) {
  console.error('\n❌ Flow failed at:', e.message);
  console.error(e);
} finally { await p.$disconnect(); }
