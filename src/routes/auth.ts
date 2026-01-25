import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { generateToken } from '../utils/jwt.js';
import { authenticateToken } from '../middleware/auth.js';
import { UserRole } from '@prisma/client';

const router = Router();

// Simple test route
router.get('/test', (req, res) => {
  res.json({ message: 'Auth routes working' });
});

// POST /auth/register-salon - Register a new salon (alias for register)
router.post('/register-salon', async (req: any, res: any) => {
  // Reuse the same logic as /register
  const { email, password, salonName } = req.body as any;

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

export default router;
