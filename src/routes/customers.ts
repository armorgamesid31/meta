import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

interface RegisterRequest {
  fullName: string;
  phone: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  acceptMarketing: boolean;
  salonId: number;
}

router.post('/register', async (req: any, res: any) => {
  const { fullName, phone, gender, birthDate, acceptMarketing, salonId } = req.body as RegisterRequest;

  if (!fullName || !phone || typeof acceptMarketing !== 'boolean' || !salonId) {
    return res.status(400).json({ message: 'fullName, phone, acceptMarketing, and salonId are required' });
  }

  const salonIdNum = typeof salonId === 'string' ? parseInt(salonId, 10) : salonId;
  if (isNaN(salonIdNum)) {
    return res.status(400).json({ message: 'salonId must be a valid number' });
  }

  try {
    const existing = await prisma.customer.findFirst({
      where: {
        phone: phone.trim(),
        salonId: salonIdNum
      }
    });

    if (existing) {
      return res.status(200).json({
        customerId: existing.id,
        isNew: false
      });
    }

    const birthDateVal = birthDate ? new Date(birthDate) : null;
    if (birthDate && isNaN(birthDateVal!.getTime())) {
      return res.status(400).json({ message: 'birthDate must be a valid ISO date' });
    }

    const genderVal = gender && ['male', 'female', 'other'].includes(gender) ? gender : null;

    const customer = await prisma.customer.create({
      data: {
        name: fullName.trim(),
        phone: phone.trim(),
        gender: genderVal,
        birthDate: birthDateVal,
        acceptMarketing,
        salonId: salonIdNum
      }
    });

    await prisma.customerRiskProfile.create({
      data: {
        customerId: customer.id,
        salonId: salonIdNum,
        riskScore: 0,
        riskLevel: null
      }
    });

    return res.status(201).json({
      customerId: customer.id,
      isNew: true
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === 'P2002') {
      const existing = await prisma.customer.findFirst({
        where: { phone: phone.trim(), salonId: salonIdNum }
      });
      if (existing) {
        return res.status(200).json({
          customerId: existing.id,
          isNew: false
        });
      }
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
