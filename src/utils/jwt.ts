import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey'; // Fallback for dev
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

interface TokenPayload {
  userId: number;
  salonId: number;
  role: 'OWNER' | 'STAFF';
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload as any, JWT_SECRET as any, { expiresIn: JWT_EXPIRES_IN as any });
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET as string) as TokenPayload;
  } catch {
    return null;
  }
};
