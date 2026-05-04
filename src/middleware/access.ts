import { Response, NextFunction } from 'express';
import { getEffectivePermissionSet, hasPermission, mapAdminRouteToPermission } from '../services/accessControl.js';

interface AccessRequest {
  user?: {
    userId: number;
    membershipId?: number;
    salonId: number;
    role: string;
  };
  effectivePermissions?: string[];
  path: string;
  method: string;
}

const RBAC_ENFORCEMENT_MODE = (process.env.RBAC_ENFORCEMENT_MODE || 'enforce').trim().toLowerCase();

function denyOrReport(
  res: Response,
  detail: { permissionKey: string; path: string; method: string; userId: number; salonId: number },
) {
  if (RBAC_ENFORCEMENT_MODE === 'report') {
    console.warn('[RBAC report-only] denied candidate', detail);
    return false;
  }
  res.status(403).json({ message: 'Insufficient permissions', permissionKey: detail.permissionKey });
  return true;
}

export function requirePermissionKey(permissionKey: string) {
  return async (req: AccessRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const allowed = await hasPermission({
      salonId: req.user.salonId,
      membershipId: Number(req.user.membershipId || req.user.userId),
      role: req.user.role,
      permissionKey,
    });

    if (!allowed) {
      const blocked = denyOrReport(res, {
        permissionKey,
        path: req.path,
        method: req.method,
        userId: req.user.userId,
        salonId: req.user.salonId,
      });
      if (blocked) return;
    }

    next();
  };
}

export async function attachEffectivePermissions(req: AccessRequest, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next();
  }
  const set = await getEffectivePermissionSet({
    salonId: req.user.salonId,
    membershipId: Number(req.user.membershipId || req.user.userId),
    role: req.user.role,
  });
  req.effectivePermissions = Array.from(set).sort();
  next();
}

export async function requireAdminRoutePermission(req: AccessRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const permissionKey = mapAdminRouteToPermission(req.path || '', req.method || 'GET');
  if (!permissionKey) {
    return next();
  }

  const allowed = await hasPermission({
    salonId: req.user.salonId,
    membershipId: Number(req.user.membershipId || req.user.userId),
    role: req.user.role,
    permissionKey,
  });

  if (!allowed) {
    const blocked = denyOrReport(res, {
      permissionKey,
      path: req.path,
      method: req.method,
      userId: req.user.userId,
      salonId: req.user.salonId,
    });
    if (blocked) return;
  }

  next();
}
