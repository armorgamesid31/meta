import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';
import { hasPermission, normalizeRole } from '../services/accessControl.js';
import {
  getActivePlatformRole,
  resolveEnterableSalon,
  PLATFORM_EFFECTIVE_ROLE,
} from '../services/platformAccess.js';
import { BusinessError } from '../lib/errors.js';

interface AuthRequest extends Request {
  user?: {
    userId: number;
    identityId?: number;
    membershipId?: number;
    salonId: number;
    role: UserRole;
    // Set only for cross-tenant platform operators (admin / support); their
    // effective `role` is OWNER and `membershipId` is undefined.
    platformRole?: string;
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

    // ── Platform operator path (cross-tenant admin / support) ─────────────
    // A platform token carries platformRole + salonId but NO membershipId.
    // Authorization is NOT taken from the token claim: getActivePlatformRole
    // re-reads the live UserIdentity, so revoking the flag (or deactivating
    // the account) kills access on the very next request. The operator may
    // retarget any ACTIVE salon via x-salon-id and assumes the OWNER
    // effective role, which the existing RBAC already treats as all-access.
    if (payload.platformRole && !membershipId) {
      if (!identityId) {
        return next(new BusinessError('UNAUTHORIZED', 'Oturum bilgisi eksik.', 401));
      }
      const platformRole = await getActivePlatformRole(identityId);
      if (!platformRole) {
        return next(new BusinessError('FORBIDDEN', 'Platform yetkisi bulunamadı veya kaldırılmış.', 403));
      }

      // Salon scope is FIXED to the token — it was chosen AND audited at
      // /platform/enter-salon time. We deliberately do NOT let x-salon-id
      // silently retarget another salon: otherwise an operator could read
      // salon B using a token minted (and logged) for salon A with no audit
      // trail. A mismatching header is rejected; switching salons means
      // calling /platform/enter-salon again, which writes a fresh audit row.
      const tokenSalonId = Number(payload.salonId || 0);
      if (requestedSalonId !== null && requestedSalonId !== tokenSalonId) {
        return next(new BusinessError('SALON_SCOPE_MISMATCH', 'x-salon-id token kapsamıyla eşleşmiyor.', 403));
      }
      const salon = await resolveEnterableSalon(tokenSalonId);
      if (!salon) {
        return next(new BusinessError('SALON_SCOPE_MISMATCH', 'Salon erişilebilir değil.', 403));
      }

      req.user = {
        ...payload,
        userId: 0,
        identityId,
        membershipId: undefined,
        role: PLATFORM_EFFECTIVE_ROLE as UserRole,
        salonId: salon.id,
        platformRole,
      } as any;
      return next();
    }

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

// Lightweight auth for endpoints that only need a verified identity
// (no salon scope). Used by /api/salons (create), /api/auth/invites/redeem,
// /api/me, and similar pre-salon flows. Tokens from createIdentityTokens()
// carry identityId but no membershipId/salonId — the full authenticateToken
// rejects them; this middleware accepts them.
interface IdentityRequest extends Request {
  identity?: {
    identityId: number;
    email: string | null;
    phone: string | null;
  };
}

export const authenticateIdentity = async (
  req: IdentityRequest,
  _res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return next(new BusinessError('UNAUTHORIZED', 'Oturum açmanız gerekiyor.', 401));
  }
  const payload = verifyToken(token);
  if (!payload) {
    return next(new BusinessError('UNAUTHORIZED', 'Oturum süresi dolmuş veya geçersiz.', 401));
  }
  const identityId = Number((payload as any).identityId || 0);
  if (!identityId) {
    return next(new BusinessError('UNAUTHORIZED', 'Kimlik bilgisi eksik.', 401));
  }
  try {
    const identity = await prisma.userIdentity.findUnique({
      where: { id: identityId },
      select: { id: true, email: true, phone: true, isActive: true },
    });
    if (!identity || !identity.isActive) {
      return next(new BusinessError('UNAUTHORIZED', 'Hesap pasif veya bulunamadı.', 401));
    }
    req.identity = {
      identityId: identity.id,
      email: identity.email,
      phone: identity.phone,
    };
    next();
  } catch (error) {
    console.error('authenticateIdentity error:', error);
    next(error);
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
