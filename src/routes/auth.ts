import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { generateToken } from '../utils/jwt.js';
import { authenticateToken } from '../middleware/auth.js';
import { UserRole } from '@prisma/client';

const router = Router();

// POST /auth/register-salon - Register a new salon
router.post('/register-salon', async (req: any, res: any) => {
  const { email, password, salonName } = req.body;

  if (!email || !password || !salonName) {
    return res.status(400).json({ message: 'Email, password, and salonName are required.' });
  }

  try {
    const existingUser = await prisma.salonUser.findUnique({ where: { email } });
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

    const token = generateToken({
      userId: ownerUser.id,
      salonId: salon.id,
      role: UserRole.OWNER,
    });

    res.status(201).json({ token, user: { id: ownerUser.id, email: ownerUser.email, role: ownerUser.role, salonId: salon.id } });
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
    const user = await prisma.salonUser.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ message: 'Hatalı giriş bilgileri.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Hatalı giriş bilgileri.' });
    }

    const token = generateToken({
      userId: user.id,
      salonId: user.salonId,
      role: user.role,
    });

    res.status(200).json({
      token,
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