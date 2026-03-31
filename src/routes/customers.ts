import { ChannelType } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  normalizeInstagramIdentity,
  resolveIdentity,
  upsertIdentityBinding,
  upsertIdentitySession,
} from '../services/identityService.js';

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
  magicToken?: string;
}

function normalizeDigits(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '');
}

function asChannel(value: unknown): ChannelType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'WHATSAPP' || normalized === 'INSTAGRAM') {
    return normalized as ChannelType;
  }
  return null;
}

function asObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

router.post('/register', async (req: any, res: any) => {
  const {
    fullName,
    phone,
    gender,
    birthDate,
    acceptMarketing,
    originChannel,
    originPhone,
    instagramId,
    magicToken,
  } = req.body as RegisterRequest;
  const salonIdNum = req.salon?.id;

  if (!fullName || !phone || typeof acceptMarketing !== 'boolean' || !salonIdNum) {
    return res
      .status(400)
      .json({ message: 'fullName, phone, and acceptMarketing are required, and must be in a tenant subdomain' });
  }

  try {
    const normalizedInputPhone = normalizeDigits(phone.trim());
    const normalizedOriginPhone = normalizeDigits(originPhone || '');
    const originChannelTyped = asChannel(originChannel);
    const isWhatsappOrigin = originChannelTyped === 'WHATSAPP';
    const isPhoneMatch = Boolean(normalizedInputPhone && normalizedOriginPhone && normalizedInputPhone === normalizedOriginPhone);
    const shouldVerify = isWhatsappOrigin && isPhoneMatch;

    let resolvedInstagramId = normalizeInstagramIdentity(instagramId || '') || null;
    let magicLink: {
      token: string;
      channel: ChannelType;
      subjectType: 'PHONE' | 'INSTAGRAM_ID';
      phone: string;
      subjectNormalized: string;
      identitySessionId: string;
      expiresAt: Date;
      status: string;
      context: unknown;
    } | null = null;

    if (typeof magicToken === 'string' && magicToken.trim()) {
      const fetched = await prisma.magicLink.findUnique({
        where: { token: magicToken.trim() },
        select: {
          token: true,
          channel: true,
          subjectType: true,
          phone: true,
          subjectNormalized: true,
          identitySessionId: true,
          expiresAt: true,
          status: true,
          context: true,
          salonId: true,
        },
      });

      if (fetched && fetched.salonId === salonIdNum && fetched.expiresAt > new Date() && fetched.status === 'ACTIVE') {
        magicLink = fetched;
        if (!resolvedInstagramId && fetched.subjectType === 'INSTAGRAM_ID') {
          const fromToken = normalizeInstagramIdentity(fetched.phone);
          resolvedInstagramId = fromToken || null;
        }
      }
    }

    const birthDateVal = birthDate ? new Date(birthDate) : null;
    if (birthDate && Number.isNaN(birthDateVal!.getTime())) {
      return res.status(400).json({ message: 'birthDate must be a valid ISO date' });
    }

    const genderVal = gender && ['male', 'female', 'other'].includes(gender) ? gender : null;
    const trimmedName = fullName?.trim() || '';
    const trimmedPhone = phone.trim();

    const existing = await prisma.customer.findFirst({
      where: {
        phone: trimmedPhone,
        salonId: salonIdNum,
      },
    });

    const identity =
      (magicLink
        ? {
            channel: magicLink.channel,
            subjectType: magicLink.subjectType,
            subjectRaw: magicLink.phone,
            subjectNormalized: magicLink.subjectNormalized,
          }
        : resolveIdentity({
            channel: originChannelTyped,
            phone: isWhatsappOrigin ? originPhone || trimmedPhone : null,
            customerKey: originChannelTyped === 'INSTAGRAM' ? resolvedInstagramId : null,
          })) || null;

    const upsertCustomer = async () => {
      if (existing) {
        const updates: Record<string, any> = {};

        if (shouldVerify && existing.registrationStatus !== 'VERIFIED') {
          updates.registrationStatus = 'VERIFIED';
        }
        if (trimmedName && (!existing.name || existing.name.trim().length === 0)) {
          updates.name = trimmedName;
        }
        if (genderVal && !existing.gender) {
          updates.gender = genderVal;
        }
        if (birthDateVal && !existing.birthDate) {
          updates.birthDate = birthDateVal;
        }
        if (typeof acceptMarketing === 'boolean' && existing.acceptMarketing !== acceptMarketing) {
          updates.acceptMarketing = acceptMarketing;
        }
        if (resolvedInstagramId && (!existing.instagram || existing.instagram.trim().length === 0)) {
          updates.instagram = resolvedInstagramId;
        }

        if (!Object.keys(updates).length) return existing;
        return prisma.customer.update({
          where: { id: existing.id },
          data: updates,
        });
      }

      const customer = await prisma.customer.create({
        data: {
          name: trimmedName || null,
          phone: trimmedPhone,
          gender: genderVal,
          birthDate: birthDateVal,
          acceptMarketing,
          salonId: salonIdNum,
          registrationStatus: shouldVerify ? 'VERIFIED' : 'PENDING',
          instagram: resolvedInstagramId,
        },
      });

      await prisma.customerRiskProfile.create({
        data: {
          customerId: customer.id,
          salonId: salonIdNum,
          riskScore: 0,
          riskLevel: null,
        },
      });

      return customer;
    };

    const customer = await upsertCustomer();

    if (identity) {
      const context = asObject(magicLink?.context);
      const session = await upsertIdentitySession({
        salonId: salonIdNum,
        identity,
        conversationKey: typeof context.conversationKey === 'string' ? context.conversationKey : null,
        canonicalUserId: `customer:${customer.id}`,
        customerId: customer.id,
        status: 'LINKED',
      });

      await upsertIdentityBinding({
        salonId: salonIdNum,
        channel: identity.channel,
        subjectNormalized: identity.subjectNormalized,
        subjectRaw: identity.subjectRaw,
        customerId: customer.id,
        sessionId: session.id,
        source: 'MAGIC_LINK_REGISTER',
      });

      if (!resolvedInstagramId && identity.channel === 'INSTAGRAM') {
        const normalizedIg = normalizeInstagramIdentity(identity.subjectRaw);
        if (normalizedIg) {
          resolvedInstagramId = normalizedIg;
          await prisma.customer.update({
            where: { id: customer.id },
            data: { instagram: normalizedIg },
          });
        }
      }

      if (magicLink) {
        const currentContext = asObject(magicLink.context);
        await prisma.magicLink.update({
          where: { token: magicLink.token },
          data: {
            usedByCustomerId: customer.id,
            identitySessionId: session.id,
            context: {
              ...currentContext,
              customerId: customer.id,
              canonicalUserId: `customer:${customer.id}`,
            },
          },
        });
      }
    }

    return res.status(existing ? 200 : 201).json({
      customerId: customer.id,
      isNew: !existing,
      registrationStatus: customer.registrationStatus,
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === 'P2002') {
      const existing = await prisma.customer.findFirst({
        where: { phone: phone.trim(), salonId: salonIdNum },
      });
      if (existing) {
        return res.status(200).json({
          customerId: existing.id,
          isNew: false,
        });
      }
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
