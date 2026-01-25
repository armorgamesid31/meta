import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../prisma.js';

interface AuthRequest extends Request {
  user?: {
    userId: number;
    salonId: number;
    role: UserRole;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401); // No token

  const payload = verifyToken(token);

  if (!payload) return res.sendStatus(403); // Invalid token

  req.user = payload;
  next();
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

    const { userId, salonId } = req.user;

    try {
      // Check if user has the permission through role assignments or overrides
      const userPermissions = await prisma.$queryRaw`
        SELECT DISTINCT p.key
        FROM permissions p
        LEFT JOIN role_permissions rp ON p.id = rp.permission_id
        LEFT JOIN user_role_assignments ura ON rp.role_id = ura.role_id AND ura.salon_id = ${salonId}
        LEFT JOIN user_permission_overrides upo ON p.id = upo.permission_id AND upo.salon_id = ${salonId} AND upo.user_id = ${userId}
        WHERE (
          (ura.user_id = ${userId} AND rp.granted = true) OR
          (upo.user_id = ${userId} AND upo.granted = true)
        )
        AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
      ` as Array<{ key: string }>;

      const permissionKeys = userPermissions.map(p => p.key);

      if (!permissionKeys.includes(permissionKey)) {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
};
