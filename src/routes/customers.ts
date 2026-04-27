import { ChannelType, CustomerPhoneVerificationPurpose } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../prisma.js';
import {
  normalizeInstagramIdentity,
  resolveIdentity,
  upsertIdentityBinding,
  upsertIdentitySession,
} from '../services/identityService.js';
import { validateMobilePhone, normalizeDigitsOnly } from '../services/phoneValidation.js';
import {
  createPhoneVerification,
  resendPhoneVerification,
  verifyPhoneCode,
} from '../services/phoneVerification.js';

const router = Router();

interface RegisterRequest {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  rawPhone: string;
  normalizedPhone?: string;
  countryIso: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  acceptMarketing: boolean;
  originChannel?: string;
  originPhone?: string;
  instagramId?: string;
  magicToken?: string;
  confirmDifferentWhatsappNumber?: boolean;
}

function normalizeNamePart(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const normalized = normalizeNamePart(fullName);
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }
  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function composeCustomerName(input: { firstName?: string; lastName?: string; fullName?: string }): {
  firstName: string;
  lastName: string;
  fullName: string;
} {
  const rawFirstName = normalizeNamePart(input.firstName);
  const rawLastName = normalizeNamePart(input.lastName);
  const fallbackFullName = normalizeNamePart(input.fullName);
  const parsed = !rawFirstName && !rawLastName ? splitFullName(fallbackFullName) : { firstName: '', lastName: '' };
  const firstName = rawFirstName || parsed.firstName;
  const lastName = rawLastName || parsed.lastName;
  const fullName = `${firstName} ${lastName}`.trim() || fallbackFullName;
  return { firstName, lastName, fullName };
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

async function findOriginProfileName(input: {
  salonId: number;
  channel: ChannelType | null;
  subjectNormalized: string | null;
  conversationKey: string | null;
}) {
  if (input.channel && input.subjectNormalized) {
    const cached = await prisma.channelProfileCache.findUnique({
      where: {
        salonId_channel_subjectNormalized: {
          salonId: input.salonId,
          channel: input.channel,
          subjectNormalized: input.subjectNormalized,
        },
      },
      select: { profileName: true },
    });
    if (cached?.profileName?.trim()) return cached.profileName.trim();
  }

  if (input.channel && input.conversationKey) {
    const conversation = await prisma.conversationState.findUnique({
      where: {
        salonId_channel_conversationKey: {
          salonId: input.salonId,
          channel: input.channel,
          conversationKey: input.conversationKey,
        },
      },
      select: { profileName: true },
    });
    if (conversation?.profileName?.trim()) return conversation.profileName.trim();
  }

  return null;
}

async function resolveMagicLinkContext(input: { salonId: number; magicToken?: string | null }) {
  if (typeof input.magicToken !== 'string' || !input.magicToken.trim()) {
    return { magicLink: null, originProfileName: null };
  }

  const magicLink = await prisma.magicLink.findUnique({
    where: { token: input.magicToken.trim() },
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
      usedByCustomerId: true,
    },
  });

  if (!magicLink || magicLink.salonId !== input.salonId || magicLink.expiresAt <= new Date() || magicLink.status !== 'ACTIVE') {
    return { magicLink: null, originProfileName: null };
  }

  const context = asObject(magicLink.context);
  const originProfileName = await findOriginProfileName({
    salonId: input.salonId,
    channel: magicLink.channel,
    subjectNormalized: magicLink.subjectNormalized,
    conversationKey: typeof context.conversationKey === 'string' ? context.conversationKey : null,
  });

  return { magicLink, originProfileName };
}

async function upsertRegisteredCustomer(input: {
  salonId: number;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phoneDigits: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  acceptMarketing: boolean;
  registrationStatus: 'PENDING' | 'VERIFIED';
  instagramId?: string | null;
  identity:
    | {
        channel: ChannelType;
        subjectType: 'PHONE' | 'INSTAGRAM_ID';
        subjectRaw: string;
        subjectNormalized: string;
      }
    | null;
  magicLink:
    | {
        token: string;
        context: unknown;
      }
    | null;
}) {
  const birthDateVal = input.birthDate ? new Date(input.birthDate) : null;
  if (input.birthDate && Number.isNaN(birthDateVal!.getTime())) {
    throw new Error('birthDate must be a valid ISO date');
  }

  const genderVal = input.gender && ['male', 'female', 'other'].includes(input.gender) ? input.gender : null;
  const normalizedName = composeCustomerName({
    firstName: input.firstName,
    lastName: input.lastName,
    fullName: input.fullName,
  });
  const resolvedInstagramId = normalizeInstagramIdentity(input.instagramId || '') || null;

  const existing = await prisma.customer.findFirst({
    where: {
      phone: input.phoneDigits,
      salonId: input.salonId,
    },
  });

  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          ...(normalizedName.fullName ? { name: normalizedName.fullName } : {}),
          ...(normalizedName.firstName ? { firstName: normalizedName.firstName } : {}),
          ...(normalizedName.lastName ? { lastName: normalizedName.lastName } : {}),
          ...(genderVal ? { gender: genderVal } : {}),
          ...(birthDateVal ? { birthDate: birthDateVal } : {}),
          acceptMarketing: input.acceptMarketing,
          ...(resolvedInstagramId ? { instagram: resolvedInstagramId } : {}),
          registrationStatus: input.registrationStatus,
        },
      })
    : await prisma.customer.create({
        data: {
          name: normalizedName.fullName || null,
          firstName: normalizedName.firstName || null,
          lastName: normalizedName.lastName || null,
          phone: input.phoneDigits,
          gender: genderVal,
          birthDate: birthDateVal,
          acceptMarketing: input.acceptMarketing,
          salonId: input.salonId,
          registrationStatus: input.registrationStatus,
          instagram: resolvedInstagramId,
        },
      });

  if (!existing) {
    await prisma.customerRiskProfile.create({
      data: {
        customerId: customer.id,
        salonId: input.salonId,
        riskScore: 0,
        riskLevel: null,
      },
    });
  }

  if (input.identity) {
    const context = asObject(input.magicLink?.context);
    const session = await upsertIdentitySession({
      salonId: input.salonId,
      identity: input.identity,
      conversationKey: typeof context.conversationKey === 'string' ? context.conversationKey : null,
      canonicalUserId: `customer:${customer.id}`,
      customerId: customer.id,
      status: 'LINKED',
    });

    await upsertIdentityBinding({
      salonId: input.salonId,
      channel: input.identity.channel,
      subjectNormalized: input.identity.subjectNormalized,
      subjectRaw: input.identity.subjectRaw,
      customerId: customer.id,
      sessionId: session.id,
      source: 'MAGIC_LINK_REGISTER',
    });

    if (input.magicLink) {
      const currentContext = asObject(input.magicLink.context);
      await prisma.magicLink.update({
        where: { token: input.magicLink.token },
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

  return { customer, isNew: !existing };
}

router.post('/register', async (req: any, res: any) => {
  const body = req.body as RegisterRequest;
  const salonIdNum = req.salon?.id;
  const normalizedName = composeCustomerName({
    firstName: body.firstName,
    lastName: body.lastName,
    fullName: body.fullName,
  });

  if (
    !normalizedName.firstName ||
    !normalizedName.lastName ||
    !body.rawPhone ||
    !body.countryIso ||
    typeof body.acceptMarketing !== 'boolean' ||
    !salonIdNum
  ) {
    return res.status(400).json({
      message: 'firstName, lastName, rawPhone, countryIso and acceptMarketing are required.',
    });
  }

  try {
    const validatedPhone = validateMobilePhone({
      rawPhone: body.rawPhone,
      countryIso: body.countryIso,
      normalizedPhone: body.normalizedPhone,
    });

    const originChannelTyped = asChannel(body.originChannel);
    const { magicLink, originProfileName } = await resolveMagicLinkContext({
      salonId: salonIdNum,
      magicToken: body.magicToken,
    });

    let resolvedInstagramId = normalizeInstagramIdentity(body.instagramId || '') || null;
    if (!resolvedInstagramId && magicLink?.subjectType === 'INSTAGRAM_ID') {
      resolvedInstagramId = normalizeInstagramIdentity(magicLink.phone) || null;
    }

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
            phone: originChannelTyped === 'WHATSAPP' ? body.originPhone || validatedPhone.digits : null,
            customerKey: originChannelTyped === 'INSTAGRAM' ? resolvedInstagramId : null,
          })) || null;

    const normalizedOriginPhone = normalizeDigitsOnly(body.originPhone || magicLink?.phone || '');
    const isWhatsappOrigin = (magicLink?.channel || originChannelTyped) === ChannelType.WHATSAPP;
    const isInstagramOrigin = (magicLink?.channel || originChannelTyped) === ChannelType.INSTAGRAM;
    const isPhoneMatch = Boolean(
      validatedPhone.digits &&
      normalizedOriginPhone &&
      validatedPhone.digits === normalizedOriginPhone,
    );

    if (isWhatsappOrigin && !isPhoneMatch && !body.confirmDifferentWhatsappNumber) {
      return res.status(409).json({
        status: 'requires_whatsapp_confirmation',
        message: 'WhatsApp numarasiyla farkli bir numara girdiniz.',
        whatsappPhone: normalizedOriginPhone || null,
        originProfileName,
        enteredPhone: validatedPhone.digits,
      });
    }

    if (isInstagramOrigin) {
      if (!resolvedInstagramId && !magicLink) {
        return res.status(400).json({
          message: 'Instagram kimligi dogrulanamadi. Lutfen size gonderilen son baglantiyi kullanin.',
        });
      }

      if (identity) {
        const existingBinding = await prisma.identityBinding.findUnique({
          where: {
            salonId_channel_subjectNormalized: {
              salonId: salonIdNum,
              channel: identity.channel,
              subjectNormalized: identity.subjectNormalized,
            },
          },
          select: { customerId: true },
        });

        if (existingBinding?.customerId) {
          const existingCustomer = await prisma.customer.findFirst({
            where: { id: existingBinding.customerId, salonId: salonIdNum },
          });
          if (existingCustomer && existingCustomer.phone === validatedPhone.digits) {
            return res.status(200).json({
              status: 'registered',
              customerId: existingCustomer.id,
              isNew: false,
              registrationStatus: existingCustomer.registrationStatus,
            });
          }
        }
      }

      const verification = await createPhoneVerification({
        salonId: salonIdNum,
        phone: validatedPhone.digits,
        countryIso: validatedPhone.countryIso,
        purpose: CustomerPhoneVerificationPurpose.BOOKING_REGISTER,
        payload: {
          firstName: normalizedName.firstName,
          lastName: normalizedName.lastName || null,
          fullName: normalizedName.fullName,
          gender: body.gender || null,
          birthDate: body.birthDate || null,
          acceptMarketing: body.acceptMarketing,
          instagramId: resolvedInstagramId,
          magicToken: body.magicToken || null,
          originChannel: magicLink?.channel || originChannelTyped,
          originPhone: body.originPhone || magicLink?.phone || null,
        },
      });

      return res.status(202).json({
        status: 'verification_code_sent',
        verificationId: verification.id,
        message: 'Telefon dogrulama kodu WhatsApp uzerinden gonderildi.',
      });
    }

    const registered = await upsertRegisteredCustomer({
      salonId: salonIdNum,
      firstName: normalizedName.firstName,
      lastName: normalizedName.lastName,
      fullName: normalizedName.fullName,
      phoneDigits: validatedPhone.digits,
      gender: body.gender,
      birthDate: body.birthDate,
      acceptMarketing: body.acceptMarketing,
      registrationStatus: isWhatsappOrigin && isPhoneMatch ? 'VERIFIED' : 'PENDING',
      instagramId: resolvedInstagramId,
      identity,
      magicLink: magicLink ? { token: magicLink.token, context: magicLink.context } : null,
    });

    return res.status(registered.isNew ? 201 : 200).json({
      status: 'registered',
      customerId: registered.customer.id,
      isNew: registered.isNew,
      registrationStatus: registered.customer.registrationStatus,
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    const status = /unsupported_country|phone_required|invalid_phone|mobile_phone_required|phone_normalization_mismatch|birthDate/.test(message)
      ? 400
      : 500;
    if (status === 500) {
      console.error('Customer register error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.post('/verify-phone/request', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const verificationId = typeof req.body?.verificationId === 'string' ? req.body.verificationId.trim() : '';
  if (!salonId || !verificationId) {
    return res.status(400).json({ message: 'verificationId is required.' });
  }

  try {
    const verification = await resendPhoneVerification({ verificationId, salonId });
    return res.status(200).json({
      status: 'verification_code_sent',
      verificationId: verification.id,
      message: 'Yeni dogrulama kodu gonderildi.',
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    const status = /not_found/.test(message) ? 404 : /not_pending|limit|expired/.test(message) ? 409 : 500;
    if (status === 500) {
      console.error('Phone verification resend error:', error);
    }
    return res.status(status).json({ message });
  }
});

router.post('/verify-phone/confirm', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  const verificationId = typeof req.body?.verificationId === 'string' ? req.body.verificationId.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!salonId || !verificationId || !code) {
    return res.status(400).json({ message: 'verificationId and code are required.' });
  }

  try {
    const verification = await verifyPhoneCode({ verificationId, salonId, code });
    const payload = asObject(verification.payload);
    const normalizedPayloadName = composeCustomerName({
      firstName: typeof payload.firstName === 'string' ? payload.firstName : undefined,
      lastName: typeof payload.lastName === 'string' ? payload.lastName : undefined,
      fullName: typeof payload.fullName === 'string' ? payload.fullName : undefined,
    });
    if (!normalizedPayloadName.firstName || !normalizedPayloadName.lastName) {
      return res.status(400).json({ message: 'firstName and lastName are required.' });
    }
    const { magicLink } = await resolveMagicLinkContext({
      salonId,
      magicToken: typeof payload.magicToken === 'string' ? payload.magicToken : null,
    });

    const originChannelTyped = asChannel(payload.originChannel);
    const resolvedInstagramId = normalizeInstagramIdentity(String(payload.instagramId || '')) || null;
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
            phone: originChannelTyped === 'WHATSAPP' ? payload.originPhone as string : null,
            customerKey: originChannelTyped === 'INSTAGRAM' ? resolvedInstagramId : null,
          })) || null;

    const registered = await upsertRegisteredCustomer({
      salonId,
      firstName: normalizedPayloadName.firstName,
      lastName: normalizedPayloadName.lastName,
      fullName: normalizedPayloadName.fullName,
      phoneDigits: verification.phone,
      gender: payload.gender as 'male' | 'female' | 'other' | undefined,
      birthDate: typeof payload.birthDate === 'string' ? payload.birthDate : undefined,
      acceptMarketing: Boolean(payload.acceptMarketing),
      registrationStatus: 'VERIFIED',
      instagramId: resolvedInstagramId,
      identity,
      magicLink: magicLink ? { token: magicLink.token, context: magicLink.context } : null,
    });

    await prisma.customerPhoneVerification.update({
      where: { id: verification.id },
      data: { customerId: registered.customer.id },
    });

    return res.status(200).json({
      status: 'registered',
      customerId: registered.customer.id,
      isNew: registered.isNew,
      registrationStatus: registered.customer.registrationStatus,
    });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    const status = /not_found/.test(message)
      ? 404
      : /expired|attempt|invalid|not_pending/.test(message)
        ? 409
        : 500;
    if (status === 500) {
      console.error('Phone verification confirm error:', error);
    }
    return res.status(status).json({ message });
  }
});

export default router;
