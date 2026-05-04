import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import { hasPermission, normalizeRole } from '../services/accessControl.js';

interface AuthRequest extends Request {
  user?: {
    userId: number;
    identityId?: number;
    membershipId?: number;
    salonId: number;
    role: UserRole;
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const queryTokenRaw = req.query?.authToken ?? req.query?.token;
  const queryToken = typeof queryTokenRaw === 'string' ? queryTokenRaw.trim() : '';
  const token =
    headerToken ||
    (req.method === 'GET' && queryToken ? queryToken : null);
  const salonHeaderRaw = req.headers['x-salon-id'];

  if (token == null) return res.sendStatus(401); // No token

  const payload = verifyToken(token);

  if (!payload) return res.sendStatus(401); // Invalid or expired token

  const salonHeader = Array.isArray(salonHeaderRaw) ? salonHeaderRaw[0] : salonHeaderRaw;
  const requestedSalonId =
    typeof salonHeader === 'string' && salonHeader.trim() ? Number(salonHeader.trim()) : null;

  if (requestedSalonId !== null && (!Number.isInteger(requestedSalonId) || requestedSalonId <= 0)) {
    return res.status(400).json({ message: 'x-salon-id must be a positive integer.' });
  }

  try {
    const membershipId = Number(payload.membershipId || 0);
    const identityId = Number(payload.identityId || 0);
    if (!membershipId || !identityId) {
      return res.sendStatus(401);
    }

    const membership = await prisma.salonMembership.findUnique({
      where: { id: membershipId },
      select: {
        salonId: true,
        role: true,
        isActive: true,
        identityId: true,
        legacySalonUserId: true,
        identity: { select: { isActive: true } },
      },
    });

    if (!membership || membership.identityId !== identityId) {
      return res.sendStatus(401);
    }
    if (!membership.isActive || !membership.identity.isActive) {
      return res.status(403).json({ message: 'Account is inactive.' });
    }

    let resolvedSalonId = payload.salonId;

    if (requestedSalonId !== null) {
      if (resolvedSalonId && resolvedSalonId !== requestedSalonId) {
        return res.status(403).json({ message: 'x-salon-id does not match token scope.' });
      }
      if (membership.salonId !== requestedSalonId) {
        return res.status(403).json({ message: 'x-salon-id is outside user scope.' });
      }
      resolvedSalonId = requestedSalonId;
    }

    if (!resolvedSalonId) {
      return res.status(403).json({ message: 'Salon scope could not be resolved.' });
    }

    req.user = {
      ...payload,
      userId: Number(membership.legacySalonUserId || payload.userId),
      identityId,
      membershipId,
      role: normalizeRole(membership.role),
      salonId: resolvedSalonId,
    };
    next();
  } catch (error) {
    console.error('authenticateToken error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

export const authorizeRoles = (roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.sendStatus(403); // Forbidden
    }
    next();
  };
};

export const requirePermission = (permissionKey: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { membershipId, salonId, role } = req.user;

    try {
      const allowed = await hasPermission({
        salonId,
        membershipId: Number(membershipId || 0),
        role,
        permissionKey,
      });
      if (!allowed) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
};
