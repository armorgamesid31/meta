import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { authenticateToken } from '../middleware/auth.js';
import { UserRole } from '@prisma/client';
import { createAuthTokens, revokeRefreshToken, rotateRefreshToken } from '../services/mobileAuth.js';

const router = Router();

// Test route to verify auth routes are loaded
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes working' });
});

// Test POST route
router.post('/test-post', (req, res) => {
  res.json({ message: 'POST routes working', body: req.body });
});

// POST /auth/register-salon - Register a new salon
router.post('/register-salon', async (req: any, res: any) => {
  const { email, password, salonName } = req.body;

  if (!email || !password || !salonName) {
    return res.status(400).json({ message: 'Email, password, and salonName are required.' });
  }

  try {
    const existingUser = await prisma.salonUser.findFirst({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: 'Bu email adresi ile zaten bir kullanıcı var.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const salon = await prisma.salon.create({
      data: {
        name: salonName,
        users: {
          create: {
            email,
            passwordHash: hashedPassword,
            role: UserRole.OWNER,
          },
        },
      },
      include: {
        users: true,
      },
    });

    const ownerUser = salon.users.find(user => user.role === UserRole.OWNER);

    if (!ownerUser) {
      return res.status(500).json({ message: 'Sahip kullanıcısı oluşturulamadı.' });
    }

    const { accessToken, refreshToken } = await createAuthTokens({
      id: ownerUser.id,
      salonId: salon.id,
      role: ownerUser.role as string,
    } as any);

    res.status(201).json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: { id: ownerUser.id, email: ownerUser.email, role: ownerUser.role, salonId: salon.id },
    });
  } catch (error) {
    console.error('Salon registration error:', error);
    res.status(500).json({ message: 'Sunucu hatası.' });
  }
});

// POST /auth/login - Login a user
router.post('/login', async (req: any, res: any) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const user = await prisma.salonUser.findFirst({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ message: 'Hatalı giriş bilgileri.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Hatalı giriş bilgileri.' });
    }

    const { accessToken, refreshToken } = await createAuthTokens({
      id: user.id,
      salonId: user.salonId,
      role: user.role as string,
    } as any);

    res.status(200).json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        salonId: user.salonId
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Sunucu hatası.' });
  }
});

// POST /auth/refresh - Rotate refresh token and issue new access token
router.post('/refresh', async (req: any, res: any) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ message: 'refreshToken is required.' });
  }

  try {
    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      return res.status(401).json({ message: 'Invalid refresh token.' });
    }

    return res.status(200).json({
      token: rotated.accessToken,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        role: rotated.user.role,
        salonId: rotated.user.salonId,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// POST /auth/logout - Revoke refresh token
router.post('/logout', async (req: any, res: any) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ message: 'refreshToken is required.' });
  }

  try {
    await revokeRefreshToken(refreshToken);
    return res.status(204).send();
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET /auth/me - Protected route to get authenticated user info
router.get('/me', authenticateToken, async (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }
  try {
    const user = await prisma.salonUser.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, role: true, salonId: true },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
