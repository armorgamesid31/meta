import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import { hasPermission, normalizeRole } from '../services/accessControl.js';
import { BusinessError } from '../lib/errors.js';

interface AuthRequest extends Request {
  user?: {
    userId: number;
    identityId?: number;
    membershipId?: number;
    salonId: number;
    role: UserRole;
  };
}

export const authenticateToken = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const headerToken = authHeader && authHeader.split(' ')[1];
  const queryTokenRaw = req.query?.authToken ?? req.query?.token;
  const queryToken = typeof queryTokenRaw === 'string' ? queryTokenRaw.trim() : '';
  const token =
    headerToken ||
    (req.method === 'GET' && queryToken ? queryToken : null);
  const salonHeaderRaw = req.headers['x-salon-id'];

  if (token == null) {
    return next(new BusinessError('UNAUTHORIZED', 'Oturum açmanız gerekiyor.', 401));
  }

  const payload = verifyToken(token);

  if (!payload) {
    return next(new BusinessError('UNAUTHORIZED', 'Oturum süresi dolmuş veya geçersiz.', 401));
  }

  const salonHeader = Array.isArray(salonHeaderRaw) ? salonHeaderRaw[0] : salonHeaderRaw;
  const requestedSalonId =
    typeof salonHeader === 'string' && salonHeader.trim() ? Number(salonHeader.trim()) : null;

  if (requestedSalonId !== null && (!Number.isInteger(requestedSalonId) || requestedSalonId <= 0)) {
    return next(new BusinessError('VALIDATION_FAILED', 'x-salon-id pozitif tam sayı olmalı.', 400));
  }

  try {
    const membershipId = Number(payload.membershipId || 0);
    const identityId = Number(payload.identityId || 0);
    if (!membershipId || !identityId) {
      return next(new BusinessError('UNAUTHORIZED', 'Oturum bilgisi eksik.', 401));
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
      return next(new BusinessError('UNAUTHORIZED', 'Oturum doğrulanamadı.', 401));
    }
    if (!membership.isActive || !membership.identity.isActive) {
      return next(new BusinessError('ACCOUNT_INACTIVE', 'Hesap pasif durumda.', 403));
    }

    let resolvedSalonId = payload.salonId;

    if (requestedSalonId !== null) {
      if (resolvedSalonId && resolvedSalonId !== requestedSalonId) {
        return next(new BusinessError('SALON_SCOPE_MISMATCH', 'x-salon-id token kapsamıyla eşleşmiyor.', 403));
      }
      if (membership.salonId !== requestedSalonId) {
        return next(new BusinessError('SALON_SCOPE_MISMATCH', 'x-salon-id kullanıcı kapsamı dışında.', 403));
      }
      resolvedSalonId = requestedSalonId;
    }

    if (!resolvedSalonId) {
      return next(new BusinessError('SALON_SCOPE_MISMATCH', 'Salon kapsamı çözümlenemedi.', 403));
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
    return next(error);
  }
};

export const authorizeRoles = (roles: UserRole[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new BusinessError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403));
    }
    next();
  };
};

export const requirePermission = (permissionKey: string) => {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new BusinessError('UNAUTHORIZED', 'Oturum açmanız gerekiyor.', 401));
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
        return next(new BusinessError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403));
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      next(error);
    }
  };
};
