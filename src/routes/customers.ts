import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

interface RegisterRequest {
  fullName: string;
  phone: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  acceptMarketing: boolean;
  originChannel?: string;
  originPhone?: string;
  instagramId?: string;
}

router.post('/register', async (req: any, res: any) => {
  const { fullName, phone, gender, birthDate, acceptMarketing, originChannel, originPhone, instagramId } =
    req.body as RegisterRequest;
  const salonIdNum = req.salon?.id;

  if (!fullName || !phone || typeof acceptMarketing !== 'boolean' || !salonIdNum) {
    return res.status(400).json({ message: 'fullName, phone, and acceptMarketing are required, and must be in a tenant subdomain' });
  }

  try {
    const normalizeDigits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');
    const normalizedInputPhone = normalizeDigits(phone.trim());
    const normalizedOriginPhone = normalizeDigits(originPhone || '');
    const isWhatsappOrigin = typeof originChannel === 'string' && originChannel.toUpperCase() === 'WHATSAPP';
    const isPhoneMatch = Boolean(normalizedInputPhone && normalizedOriginPhone && normalizedInputPhone === normalizedOriginPhone);
    const shouldVerify = isWhatsappOrigin && isPhoneMatch;

    const existing = await prisma.customer.findFirst({
      where: {
        phone: phone.trim(),
        salonId: salonIdNum
      }
    });

    if (existing) {
      const updates: Record<string, any> = {};
      if (shouldVerify && existing.registrationStatus !== 'VERIFIED') {
        updates.registrationStatus = 'VERIFIED';
      }
      const trimmedName = fullName?.trim() || '';
      if (trimmedName && (!existing.name || existing.name.trim().length === 0)) {
        updates.name = trimmedName;
      }
      if (gender && !existing.gender && ['male', 'female', 'other'].includes(gender)) {
        updates.gender = gender;
      }
      if (birthDate && !existing.birthDate) {
        const birthDateVal = new Date(birthDate);
        if (!isNaN(birthDateVal.getTime())) {
          updates.birthDate = birthDateVal;
        }
      }
      if (typeof acceptMarketing === 'boolean' && existing.acceptMarketing !== acceptMarketing) {
        updates.acceptMarketing = acceptMarketing;
      }
      const ig = typeof instagramId === 'string' ? instagramId.trim() : '';
      if (ig && (!existing.instagram || existing.instagram.trim().length === 0)) {
        updates.instagram = ig;
      }
      const updated = Object.keys(updates).length > 0
        ? await prisma.customer.update({
            where: { id: existing.id },
            data: updates
          })
        : existing;
      return res.status(200).json({
        customerId: existing.id,
        isNew: false,
        registrationStatus: updated.registrationStatus
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
        salonId: salonIdNum,
        registrationStatus: shouldVerify ? 'VERIFIED' : 'PENDING',
        instagram: typeof instagramId === 'string' && instagramId.trim().length > 0 ? instagramId.trim() : null
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
      isNew: true,
      registrationStatus: customer.registrationStatus
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
