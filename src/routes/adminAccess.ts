import { Router } from 'express';
import bcrypt from 'bcrypt';
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

const router = Router();

function getAuth(req: any, res: any) {
  if (!req.user?.salonId || !req.user?.userId) {
    res.status(401).json({ message: 'Unauthorized.' });
    return null;
  }
  return {
    salonId: Number(req.user.salonId),
    userId: Number(req.user.userId),
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

function resolveStaffDisplayName(input: { displayName?: string | null; email?: string | null }, fallback?: string | null): string {
  const fromDisplayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (fromDisplayName) return fromDisplayName;
  const fromEmail = typeof input.email === 'string' ? input.email.trim() : '';
  if (fromEmail) {
    const local = fromEmail.split('@')[0]?.trim();
    if (local) return local;
  }
  return (fallback || '').trim() || 'Ekip Üyesi';
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
    return res.status(500).json({ message: 'Internal server error.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/users', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  try {
    const users = await prisma.salonUser.findMany({
      where: { salonId: auth.salonId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        secondaryRoles: true,
        isActive: true,
        passwordResetRequired: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const staff = await prisma.staff.findMany({
      where: { salonId: auth.salonId, userId: { not: null } },
      select: { id: true, name: true, userId: true },
    });
    const staffByUserId = new Map<number, { id: number; name: string }>();
    for (const row of staff) {
      if (typeof row.userId === 'number') {
        staffByUserId.set(row.userId, { id: row.id, name: row.name });
      }
    }

    return res.status(200).json({
      items: users.map((user) => ({
        ...user,
        role: normalizeRole(user.role),
        roles: Array.from(new Set([normalizeRole(user.role), ...normalizeRoles(user.secondaryRoles)])).sort(),
        linkedStaff: staffByUserId.get(user.id) || null,
      })),
    });
  } catch (error) {
    console.error('Access users list error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/users', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const requestedRoles = Array.isArray(req.body?.roles) ? normalizeRoles(req.body.roles) : [];
  const role = requestedRoles[0] || normalizeRole(req.body?.role);
  const secondaryRoles = requestedRoles.slice(1);
  const staffId = Number.isInteger(Number(req.body?.staffId)) && Number(req.body.staffId) > 0 ? Number(req.body.staffId) : null;
  const rawPassword = typeof req.body?.password === 'string' && req.body.password.trim() ? req.body.password.trim() : randomTempPassword();

  if (!email || !rawPassword) {
    return res.status(400).json({ message: 'email and password are required.' });
  }

  try {
    const existing = await prisma.salonUser.findFirst({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: 'Email is already in use.' });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const created = await prisma.$transaction(async (tx) => {
      if (staffId) {
        const staff = await tx.staff.findFirst({ where: { id: staffId, salonId: auth.salonId } });
        if (!staff) throw new Error('STAFF_NOT_FOUND');
      }

      const user = await tx.salonUser.create({
        data: {
          salonId: auth.salonId,
          email,
          displayName: displayName || null,
          role,
          secondaryRoles: secondaryRoles as any,
          passwordHash,
          isActive: true,
          passwordResetRequired: true,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          displayName: true,
          role: true,
          secondaryRoles: true,
          isActive: true,
          passwordResetRequired: true,
          createdAt: true,
        },
      });

      if (staffId) {
        const staff = await tx.staff.findFirst({ where: { id: staffId, salonId: auth.salonId } });
        if (!staff) throw new Error('STAFF_NOT_FOUND');
        await tx.staff.update({
          where: { id: staffId },
          data: {
            userId: user.id,
            name: resolveStaffDisplayName({ displayName: user.displayName, email: user.email }, staff.name),
            phone: user.phone || staff.phone || null,
          },
        });
      }

      return user;
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: String(created.id),
      metadata: { role, secondaryRoles, staffId },
    });

    return res.status(201).json({ item: created, temporaryPassword: rawPassword });
  } catch (error: any) {
    if (error?.message === 'STAFF_NOT_FOUND') {
      return res.status(404).json({ message: 'Linked staff not found.' });
    }
    console.error('Access user create error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/users/:id', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid user id.' });
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
      const user = await tx.salonUser.findFirst({ where: { id: targetUserId, salonId: auth.salonId } });
      if (!user) throw new Error('USER_NOT_FOUND');

      await tx.salonUser.update({
        where: { id: targetUserId },
        data: {
          role,
          secondaryRoles: secondaryRoles as any,
          isActive,
          ...(displayName !== undefined ? { displayName: displayName || null } : {}),
        },
      });

      if (staffId !== undefined) {
        await tx.staff.updateMany({ where: { salonId: auth.salonId, userId: targetUserId }, data: { userId: null } });
        if (staffId !== null) {
          const staff = await tx.staff.findFirst({ where: { id: staffId, salonId: auth.salonId } });
          if (!staff) throw new Error('STAFF_NOT_FOUND');
          await tx.staff.update({
            where: { id: staffId },
            data: {
              userId: targetUserId,
              name: resolveStaffDisplayName({ displayName, email: user.email }, staff.name),
              phone: user.phone || staff.phone || null,
            },
          });
        }
      }

      if (!isActive) {
        await tx.mobileAuthSession.updateMany({
          where: { userId: targetUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return tx.salonUser.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          secondaryRoles: true,
          isActive: true,
          passwordResetRequired: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_UPDATED',
      targetType: 'USER',
      targetId: String(targetUserId),
      metadata: { role, secondaryRoles, isActive, staffId: staffId === undefined ? 'unchanged' : staffId },
    });

    return res.status(200).json({ item: updated });
  } catch (error: any) {
    if (error?.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (error?.message === 'STAFF_NOT_FOUND') {
      return res.status(404).json({ message: 'Linked staff not found.' });
    }
    console.error('Access user update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.put('/users/:id/overrides', authenticateToken, requirePermissionKey('access.permission_overrides.edit'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid user id.' });
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
      await tx.userPermissionOverride.deleteMany({ where: { salonId: auth.salonId, userId: targetUserId } });

      if (overrides.length > 0) {
        await tx.userPermissionOverride.createMany({
          data: overrides
            .map((item: any) => {
              const permissionId = idByKey.get(item.permissionKey);
              if (!permissionId) return null;
              return {
                salonId: auth.salonId,
                userId: targetUserId,
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
      targetId: String(targetUserId),
      metadata: { count: overrides.length },
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Access user overrides update error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.post('/users/:id/reset-password', authenticateToken, requirePermissionKey('access.users.manage'), async (req: any, res: any) => {
  const auth = getAuth(req, res);
  if (!auth) return;

  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }

  const rawPassword = typeof req.body?.password === 'string' && req.body.password.trim() ? req.body.password.trim() : randomTempPassword();

  try {
    const target = await prisma.salonUser.findFirst({ where: { id: targetUserId, salonId: auth.salonId } });
    if (!target) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);
    await prisma.salonUser.update({
      where: { id: targetUserId },
      data: {
        passwordHash,
        passwordResetRequired: true,
      },
    });

    await prisma.mobileAuthSession.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAccessAudit({
      salonId: auth.salonId,
      actorUserId: auth.userId,
      action: 'USER_PASSWORD_RESET',
      targetType: 'USER',
      targetId: String(targetUserId),
      metadata: {},
    });

    return res.status(200).json({ ok: true, temporaryPassword: rawPassword });
  } catch (error) {
    console.error('Access user reset-password error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
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
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

router.get('/default-catalog', authenticateToken, async (_req: any, res: any) => {
  return res.status(200).json({ items: PERMISSION_CATALOG });
});

export default router;
