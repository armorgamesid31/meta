import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { PrismaClient, UserRole } from '@prisma/client';

interface AuthRequest extends Request {
  user?: {
    userId: number;
    salonId: number;
    role: UserRole;
  };
}

const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401); // No token

  const payload = verifyToken(token);

  if (!payload) return res.sendStatus(403); // Invalid token

  req.user = payload;
  next();
};

const authorizeRoles = (roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.sendStatus(403); // Forbidden
    }
    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles
};
