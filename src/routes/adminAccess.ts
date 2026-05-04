import { Router } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { requirePermissionKey } from '../middleware/access.js';
import {
  FIXED_ROLES,
  PERMISSION_CATALOG,
  ensureSalonAccessSeed,
  getPermissionCatalogWithGrants,
  normalizeRole,
  normalizeRoles,
  writeAccessAudit,
} from '../services/accessControl.js';
import { hashPlainToken } from '../services/inviteService.js';

const router = Router();

function getAuth(req: any, res: any) {
  if (!req.user?.salonId || !req.user?.userId || !req.user?.membershipId) {
    res.status(401).json({ message: 'Yetkisiz erisim.' });
    return null;
  }
  return {
    salonId: Number(req.user.salonId),
    userId: Number(req.user.userId),
    membershipId: Number(req.user.membershipId),
    identityId: Number(req.user.identityId || 0),
  };
}

function randomTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$';
  let value = '';
  for (let i = 0; i < 14; i += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function buildSystemEmail(input: { salonId: number; role: string }): string {
  const nonce = randomBytes(4).toString('hex');
  return `team-${input.salonId}-${String(input.role || 'staff').toLowerCase()}-${Date.now()}-${nonce}@kedy.local`;
}

function resolveStaffDisplayName(input: { displayName?: string | null; email?: string | null }, fallback?: string | null): string {
  const fromDisplayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (fromDisplayName) return fromDisplayName;
  const fromEmail = typeof input.email === 'string' ? input.email.trim() : '';
  if (fromEmail) {
    const local = fromEmail.split('@')[0]?.trim();
    if (local) return local;
  }
  return (fallback || '').trim() || 'Ekip Ãœyesi';
}

async function generateDefaultTeamMemberName(salonId: number): Promise<string> {
  const users = await prisma.salonUser.findMany({
    where: {
      salonId,
      displayName: { startsWith: 'Ekip Üyesi' },
    },
    select: { displayName: true },
  });

  let maxIndex = 0;
  for (const user of users) {
    const value = String(user.displayName || '').trim();
    const match = value.match(/^Ekip Üyesi\s+(\d+)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > maxIndex) maxIndex = index;
  }

  return `Ekip Üyesi ${maxIndex + 1}`;
}

router.get('/permissions', authenticateToken, requirePermissionKey('access.roles.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  try {
    const data = await getPermissionCatalogWithGrants(auth.salonId);
    return res.status(200).json({
      permissions: data.permissions,
      rolePermissions: data.rolePermissions,
      roles: FIXED_ROLES,
    });
  } catch (error) {
    console.error('Access permissions list error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.put('/roles/:role/permissions', authenticateToken, requirePermissionKey('access.roles.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const role = normalizeRole(req.params.role);
  const permissionKeys = Array.isArray(req.body?.permissionKeys)
    ? req.body.permissionKeys.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];

  try {
    await ensureSalonAccessSeed(auth.salonId);
    const definitions = await prisma.permissionDefinition.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });

    const definitionIds = definitions.map((item) => item.id);

    await prisma.$transaction(async (tx) => {
      await tx.salonRolePermission.deleteMany({
        where: {
          salonId: auth.salonId,
          role,
        },
      });

      if (definitionIds.length > 0) {
        await tx.salonRolePermission.createMany({
          data: definitionIds.map((permissionId) => ({
            salonId: auth.salonId,
            role,
            permissionId,
            granted: true,
            updatedByUserId: auth.userId,
          })),
          skipDuplicates: true,
        });
      }
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'ROLE_PERMISSIONS_UPDATED',
      targetType: 'ROLE',
      targetId: role,
      metadata: { permissionKeys: definitions.map((item) => item.key).sort() },
    });

    return res.status(200).json({ ok: true, role, permissionKeys: definitions.map((item) => item.key).sort() });
  } catch (error) {
    console.error('Access role permissions update error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.get('/users', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  try {
    const users = await prisma.salonMembership.findMany({
      where: { salonId: auth.salonId },
      include: {
        identity: {
          select: {
            id: true,
            email: true,
            phone: true,
            displayName: true,
            firstName: true,
            lastName: true,
            isActive: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const staff = await prisma.staff.findMany({
      where: { salonId: auth.salonId, membershipId: { not: null } },
      select: { id: true, name: true, membershipId: true },
    });
    const staffByMembershipId = new Map<number, { id: number; name: string }>();
    for (const row of staff) {
      if (typeof row.membershipId === 'number') {
        staffByMembershipId.set(row.membershipId, { id: row.id, name: row.name });
      }
    }

    return res.status(200).json({
      items: users.map((membership) => ({
        id: membership.id,
        identityId: membership.identity.id,
        email: membership.identity.email || '',
        displayName: membership.identity.displayName,
        role: normalizeRole(membership.role),
        roles: Array.from(new Set([normalizeRole(membership.role), ...normalizeRoles(membership.secondaryRoles)])).sort(),
        isActive: membership.isActive && membership.identity.isActive,
        passwordResetRequired: membership.passwordResetRequired,
        lastLoginAt: membership.lastLoginAt,
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
        linkedStaff: staffByMembershipId.get(membership.id) || null,
      })),
    });
  } catch (error) {
    console.error('Access users list error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.post('/users', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const emailInput = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const displayNameInput = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const requestedRoles = Array.isArray(req.body?.roles) ? normalizeRoles(req.body.roles) : [];
  const role = requestedRoles[0] || normalizeRole(req.body?.role);
  const secondaryRoles = requestedRoles.slice(1);
  const staffId = Number.isInteger(Number(req.body?.staffId)) && Number(req.body.staffId) > 0 ? Number(req.body.staffId) : null;
  const rawPassword = typeof req.body?.password === 'string' && req.body.password.trim() ? req.body.password.trim() : randomTempPassword();

  try {
    const email = emailInput || null;
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const inviteCode = randomBytes(4).toString('hex').toUpperCase();
    const inviteToken = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const hintPhone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';

    const created = await prisma.$transaction(async (tx) => {
      if (staffId) {
        const staff = await tx.staff.findFirst({ where: { id: staffId, salonId: auth.salonId } });
        if (!staff) throw new Error('STAFF_NOT_FOUND');
      }

      const resolvedDisplayName = displayNameInput || (await generateDefaultTeamMemberName(auth.salonId));

      const identity = await tx.userIdentity.create({
        data: {
          email,
          phone: hintPhone || null,
          displayName: resolvedDisplayName,
          passwordHash,
          isActive: true,
        },
      });
      const legacyUser = await tx.salonUser.create({
        data: {
          salonId: auth.salonId,
          email: email || buildSystemEmail({ salonId: auth.salonId, role }),
          phone: hintPhone || null,
          displayName: resolvedDisplayName,
          role,
          secondaryRoles: secondaryRoles as any,
          passwordHash,
          isActive: true,
          passwordResetRequired: true,
        },
      });
      const membership = await tx.salonMembership.create({
        data: {
          salonId: auth.salonId,
          identityId: identity.id,
          role,
          secondaryRoles: secondaryRoles as any,
          isActive: true,
          passwordResetRequired: true,
          legacySalonUserId: legacyUser.id,
        },
      });

      await tx.invite.create({
        data: {
          salonId: auth.salonId,
          invitedUserId: legacyUser.id,
          invitedMembershipId: membership.id,
          invitedIdentityPhone: hintPhone || null,
          invitedIdentityEmail: email,
          inviteCodeHash: hashPlainToken(inviteCode),
          inviteTokenHash: hashPlainToken(inviteToken),
          expiresAt,
          createdBy: auth.userId || null,
        },
      });

      if (staffId) {
        const staff = await tx.staff.findFirst({ where: { id: staffId, salonId: auth.salonId } });
        if (!staff) throw new Error('STAFF_NOT_FOUND');
        await tx.staff.update({
            where: { id: staffId },
            data: {
            membershipId: membership.id,
            userId: legacyUser.id,
            name: resolveStaffDisplayName({ displayName: identity.displayName, email: identity.email }, staff.name),
            phone: identity.phone || staff.phone || null,
          },
        });
      }

      return {
        id: membership.id,
        identityId: identity.id,
        email: identity.email,
        displayName: identity.displayName,
        role: membership.role,
        secondaryRoles: membership.secondaryRoles,
        isActive: membership.isActive,
        passwordResetRequired: membership.passwordResetRequired,
        createdAt: membership.createdAt,
      };
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: String(created.id),
      metadata: { role, secondaryRoles, staffId },
    });

    return res.status(201).json({
      item: created,
      invite: {
        code: inviteCode,
        token: inviteToken,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error?.message === 'STAFF_NOT_FOUND') {
      return res.status(404).json({ message: 'Bagli uzman bulunamadi.' });
    }
    console.error('Access user create error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.put('/users/:id', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const targetMembershipId = Number(req.params.id);
  if (!Number.isInteger(targetMembershipId) || targetMembershipId <= 0) {
    return res.status(400).json({ message: 'Gecersiz kullanici kimligi.' });
  }

  const requestedRoles = Array.isArray(req.body?.roles) ? normalizeRoles(req.body.roles) : [];
  const role = requestedRoles[0] || normalizeRole(req.body?.role);
  const secondaryRoles = requestedRoles.slice(1);
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : undefined;
  const isActive = req.body?.isActive !== false;
  const staffIdRaw = req.body?.staffId;
  const staffId = staffIdRaw === null ? null : Number.isInteger(Number(staffIdRaw)) && Number(staffIdRaw) > 0 ? Number(staffIdRaw) : undefined;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const membership = await tx.salonMembership.findFirst({ where: { id: targetMembershipId, salonId: auth.salonId } });
      if (!membership) throw new Error('USER_NOT_FOUND');
      const identity = await tx.userIdentity.findUnique({ where: { id: membership.identityId } });
      if (!identity) throw new Error('USER_NOT_FOUND');

      await tx.salonMembership.update({
        where: { id: targetMembershipId },
        data: {
          role,
          secondaryRoles: secondaryRoles as any,
          isActive,
          ...(displayName !== undefined ? { } : {}),
        },
      });
      if (displayName !== undefined) {
        await tx.userIdentity.update({ where: { id: identity.id }, data: { displayName: displayName || null } });
      }
      if (membership.legacySalonUserId) {
        await tx.salonUser.update({
          where: { id: membership.legacySalonUserId },
          data: {
            role,
            secondaryRoles: secondaryRoles as any,
            isActive,
            ...(displayName !== undefined ? { displayName: displayName || null } : {}),
          },
        });
      }

      if (staffId !== undefined) {
        await tx.staff.updateMany({
          where: { salonId: auth.salonId, OR: [{ membershipId: targetMembershipId }, { userId: membership.legacySalonUserId || 0 }] },
          data: { userId: null, membershipId: null },
        });
        if (staffId !== null) {
          const staff = await tx.staff.findFirst({ where: { id: staffId, salonId: auth.salonId } });
          if (!staff) throw new Error('STAFF_NOT_FOUND');
          await tx.staff.update({
            where: { id: staffId },
            data: {
              membershipId: targetMembershipId,
              userId: membership.legacySalonUserId || null,
              name: resolveStaffDisplayName({ displayName: displayName ?? identity.displayName, email: identity.email }, staff.name),
              phone: identity.phone || staff.phone || null,
            },
          });
        }
      }

      if (!isActive) {
        await tx.mobileAuthSession.updateMany({
          where: { membershipId: targetMembershipId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      const nextMembership = await tx.salonMembership.findUnique({
        where: { id: targetMembershipId },
        include: { identity: { select: { email: true, displayName: true } } },
      });
      return nextMembership
        ? {
            id: nextMembership.id,
            email: nextMembership.identity.email || '',
            displayName: nextMembership.identity.displayName,
            role: nextMembership.role,
            secondaryRoles: nextMembership.secondaryRoles,
            isActive: nextMembership.isActive,
            passwordResetRequired: nextMembership.passwordResetRequired,
            lastLoginAt: nextMembership.lastLoginAt,
            createdAt: nextMembership.createdAt,
            updatedAt: nextMembership.updatedAt,
          }
        : null;
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_UPDATED',
      targetType: 'USER',
      targetId: String(targetMembershipId),
      metadata: { role, secondaryRoles, isActive, staffId: staffId === undefined ? 'unchanged' : staffId },
    });

    return res.status(200).json({ item: updated });
  } catch (error: any) {
    if (error?.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'Kullanici bulunamadi.' });
    }
    if (error?.message === 'STAFF_NOT_FOUND') {
      return res.status(404).json({ message: 'Bagli uzman bulunamadi.' });
    }
    console.error('Access user update error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.put('/users/:id/overrides', authenticateToken, requirePermissionKey('access.permission_overrides.edit'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const targetMembershipId = Number(req.params.id);
  if (!Number.isInteger(targetMembershipId) || targetMembershipId <= 0) {
    return res.status(400).json({ message: 'Gecersiz kullanici kimligi.' });
  }

  const overrides = Array.isArray(req.body?.overrides)
    ? req.body.overrides
        .map((item: any) => ({
          permissionKey: String(item?.permissionKey || '').trim(),
          granted: item?.granted === true,
          reason: typeof item?.reason === 'string' ? item.reason.trim() : null,
          expiresAt:
            typeof item?.expiresAt === 'string' && item.expiresAt.trim()
              ? new Date(item.expiresAt)
              : null,
        }))
        .filter((item: any) => item.permissionKey)
    : [];

  try {
    const permissions = await prisma.permissionDefinition.findMany({
      where: { key: { in: overrides.map((item: any) => item.permissionKey) } },
      select: { id: true, key: true },
    });
    const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

    await prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({ where: { salonId: auth.salonId, membershipId: targetMembershipId } });

      if (overrides.length > 0) {
        await tx.userPermissionOverride.createMany({
          data: overrides
            .map((item: any) => {
              const permissionId = idByKey.get(item.permissionKey);
              if (!permissionId) return null;
              return {
                salonId: auth.salonId,
                userId: targetMembershipId,
                membershipId: targetMembershipId,
                permissionId,
                granted: item.granted,
                reason: item.reason,
                expiresAt: item.expiresAt && !Number.isNaN(item.expiresAt.getTime()) ? item.expiresAt : null,
                updatedByUserId: auth.userId,
              };
            })
            .filter(Boolean) as any,
          skipDuplicates: true,
        });
      }
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_OVERRIDES_UPDATED',
      targetType: 'USER',
      targetId: String(targetMembershipId),
      metadata: { count: overrides.length },
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Access user overrides update error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.post('/users/:id/reset-password', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const targetMembershipId = Number(req.params.id);
  if (!Number.isInteger(targetMembershipId) || targetMembershipId <= 0) {
    return res.status(400).json({ message: 'Gecersiz kullanici kimligi.' });
  }

  const rawPassword = typeof req.body?.password === 'string' && req.body.password.trim() ? req.body.password.trim() : randomTempPassword();

  try {
    const target = await prisma.salonMembership.findFirst({ where: { id: targetMembershipId, salonId: auth.salonId } });
    if (!target) {
      return res.status(404).json({ message: 'Kullanici bulunamadi.' });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const identityId = target.identityId;
    await prisma.userIdentity.update({ where: { id: identityId }, data: { passwordHash } });
    await prisma.salonMembership.update({ where: { id: targetMembershipId }, data: { passwordResetRequired: true } });
    if (target.legacySalonUserId) {
      await prisma.salonUser.update({
        where: { id: target.legacySalonUserId },
        data: {
          passwordHash,
          passwordResetRequired: true,
        },
      });
    }

    await prisma.mobileAuthSession.updateMany({
      where: { membershipId: targetMembershipId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_PASSWORD_RESET',
      targetType: 'USER',
      targetId: String(targetMembershipId),
      metadata: {},
    });

    return res.status(200).json({ ok: true, temporaryPassword: rawPassword });
  } catch (error) {
    console.error('Access user reset-password error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.get('/audit', authenticateToken, requirePermissionKey('access.audit.view'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));

  try {
    const rows = await prisma.accessAuditLog.findMany({
      where: { salonId: auth.salonId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        actorUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
      },
    });

    return res.status(200).json({ items: rows });
  } catch (error) {
    console.error('Access audit list error:', error);
    return res.status(500).json({ message: 'Sunucu hatasi.' });
  }
});

router.get('/default-catalog', authenticateToken, async (_req: any, res: any) => {
  return res.status(200).json({ items: PERMISSION_CATALOG });
});

export default router;

