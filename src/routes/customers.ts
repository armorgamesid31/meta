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
import { BusinessError } from '../lib/errors.js';
import {
  VerificationChannel,
  VerificationPurpose,
} from '@prisma/client';
import {
  consumeVerificationLink,
  createVerificationLink,
  peekVerificationLink,
  VerificationError,
  VERIFICATION_TTL_MINUTES,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from '../services/verificationLinkService.js';
import {
  syncCustomerToGlobalIdentity,
  markGlobalIdentityVerified,
} from '../services/globalCustomerIdentity.js';
import {
  sendVerificationLinkTemplate,
} from '../services/whatsappTemplateSender.js';
import {
  findSalonLinksForPhone,
  linkCustomerToIdentity,
  upsertPhoneIdentity,
} from '../services/phoneIdentityService.js';

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

  // Existing-customer guardrails: a verified customer who re-runs the
  // registration form (e.g. clicked a referral link with the same
  // phone) must not have their identity overwritten by partial form
  // values. Specifically:
  //   • Never downgrade VERIFIED → PENDING.
  //   • Don't overwrite name fields that are already populated unless
  //     the form actually carries a non-empty value AND the existing
  //     record is blank. This kept Berkay's record reading "berkay kkk"
  //     after he hit the form again.
  // Gender, birthDate, acceptMarketing and Instagram id are preference
  // / contact fields where the latest value wins.
  const isExistingVerified = existing?.registrationStatus === 'VERIFIED';
  const protectNames = isExistingVerified && Boolean(existing?.firstName && existing?.lastName);
  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          ...(normalizedName.fullName && !protectNames ? { name: normalizedName.fullName } : {}),
          ...(normalizedName.firstName && !protectNames ? { firstName: normalizedName.firstName } : {}),
          ...(normalizedName.lastName && !protectNames ? { lastName: normalizedName.lastName } : {}),
          ...(genderVal ? { gender: genderVal } : {}),
          ...(birthDateVal ? { birthDate: birthDateVal } : {}),
          acceptMarketing: input.acceptMarketing,
          ...(resolvedInstagramId ? { instagram: resolvedInstagramId } : {}),
          // Promote PENDING → VERIFIED if the incoming request claims
          // verified, but never the other way round.
          ...(input.registrationStatus === 'VERIFIED' || !isExistingVerified
            ? { registrationStatus: input.registrationStatus }
            : {}),
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

  // Mirror PII to the platform-wide GlobalCustomerIdentity (phone-keyed).
  await syncCustomerToGlobalIdentity(customer.id).catch(err =>
    console.error('GlobalCustomerIdentity sync failed:', err)
  );

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

  // Normalize gender: frontend may submit an empty string when the user
  // skips the field. Pass it through Prisma's enum cast and we get a 500;
  // coerce anything outside the allowed set to `undefined` so downstream
  // helpers can treat it as "unset".
  const normalizedGender =
    body.gender && ['male', 'female', 'other'].includes(body.gender)
      ? (body.gender as 'male' | 'female' | 'other')
      : undefined;
  body.gender = normalizedGender;

  if (
    !normalizedName.firstName ||
    !normalizedName.lastName ||
    !body.rawPhone ||
    !body.countryIso ||
    typeof body.acceptMarketing !== 'boolean' ||
    !salonIdNum
  ) {
    throw new BusinessError(
      'VALIDATION_FAILED',
      'Ad, soyad, telefon, ülke ve pazarlama izni alanları zorunludur.',
      400,
      { missing: ['firstName', 'lastName', 'rawPhone', 'countryIso', 'acceptMarketing'] },
    );
  }

  try {
    const validatedPhone = validateMobilePhone({
      rawPhone: body.rawPhone,
      countryIso: body.countryIso,
      normalizedPhone: body.normalizedPhone,
    });

    // Already-verified short-circuit. A customer who is already
    // registered with this phone on this salon doesn't need to fill the
    // form again — clicking a referral link or refreshing the booking
    // page used to push them through registration and overwrite their
    // record. Now we acknowledge them and let the booking flow proceed.
    const existingVerified = await prisma.customer.findFirst({
      where: {
        salonId: salonIdNum,
        phone: validatedPhone.digits,
        registrationStatus: 'VERIFIED',
      },
      select: { id: true, registrationStatus: true },
    });
    if (existingVerified) {
      return res.status(200).json({
        status: 'registered',
        customerId: existingVerified.id,
        isNew: false,
        registrationStatus: existingVerified.registrationStatus,
      });
    }

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
        throw new BusinessError('VALIDATION_FAILED', 'Instagram kimligi dogrulanamadi. Lutfen size gonderilen son baglantiyi kullanin.', 400);
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
            // Do NOT echo customerId here. The Instagram registration path is
            // pre-auth and a numeric customerId in the response was a salon-
            // wide enumeration vector. The frontend fetches the authenticated
            // customer's id via a separate authenticated endpoint
            // (e.g. /api/customers/me) once the session is established.
            return res.status(200).json({
              status: 'registered',
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

    // FAST PATH: arrival via the salon's own WhatsApp link AND the
    // phone the customer typed matches the WhatsApp sender. We treat
    // that as proof of possession because the WABA inbound webhook
    // confirms both the channel and the number — no extra OTP needed.
    if (isWhatsappOrigin && isPhoneMatch) {
      const registered = await upsertRegisteredCustomer({
        salonId: salonIdNum,
        firstName: normalizedName.firstName,
        lastName: normalizedName.lastName,
        fullName: normalizedName.fullName,
        phoneDigits: validatedPhone.digits,
        gender: body.gender,
        birthDate: body.birthDate,
        acceptMarketing: body.acceptMarketing,
        registrationStatus: 'VERIFIED',
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
    }

    // VERIFICATION PATH: every other arrival (referral link, direct
    // booking URL, organic web, magic link with mismatched phone)
    // must prove possession of the phone before a Customer row is
    // created. We push a 6-digit code via the salon's WABA using the
    // same primitive Instagram uses. The Customer row only lands when
    // `/verify-phone/confirm` succeeds — eliminates the unverified
    // PENDING ghosts the old default branch was minting.
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
    throw new BusinessError('VALIDATION_FAILED', 'verificationId is required.', 400);
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
    throw new BusinessError('VALIDATION_FAILED', 'verificationId and code are required.', 400);
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
      throw new BusinessError('VALIDATION_FAILED', 'firstName and lastName are required.', 400);
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

// ─────────────────────────────────────────────────────────────────
// UTILITY-link based customer phone verification.
//
// Replaces the OTP code flow with a magic-link sent via the salon's
// own WABA using the kdy_dogrulama_link template. Two paths:
//
//   FAST PATH — phone has a PhoneIdentity AND is already linked to
//   this salon → return VERIFIED immediately, no message sent.
//
//   CONSENT PATH — phone has a PhoneIdentity (ecosystem-verified) but
//   not linked to THIS salon → short consent link (purpose=CUSTOMER_LINK_CONSENT).
//
//   FULL PATH — phone has no PhoneIdentity → full verification
//   (purpose=CUSTOMER_PHONE).
// ─────────────────────────────────────────────────────────────────

function clientReqInfo(req: any): { ipAddress: string | null; userAgent: string | null } {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    ipAddress: ip || req.ip || req.socket?.remoteAddress || null,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
  };
}

router.post('/verify-link/start', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon kontekstı bulunamadı.', 400);
  }

  const body = req.body || {};
  const rawPhone = String(body.rawPhone || body.phone || '').trim();
  const countryIso = String(body.countryIso || 'TR').trim().toUpperCase();
  const customerName = String(body.name || body.firstName || '').trim() || 'Müşteri';
  const source = String(body.source || 'BOOKING').toUpperCase() as
    | 'INSTAGRAM'
    | 'BOOKING'
    | 'ADMIN'
    | 'WHATSAPP_INBOUND'
    | 'WEB';

  if (!rawPhone) {
    throw new BusinessError('VALIDATION_FAILED', 'Telefon gereklidir.', 400);
  }

  let normalized;
  try {
    normalized = validateMobilePhone({ rawPhone, countryIso });
  } catch (e: any) {
    throw new BusinessError('VALIDATION_FAILED', e?.message || 'Geçersiz telefon.', 400);
  }

  // Resolve salon meta for WABA + display name.
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true, name: true, slug: true, chakraPluginId: true, chakraPhoneNumberId: true },
  });
  if (!salon?.chakraPluginId || !salon.chakraPhoneNumberId) {
    throw new BusinessError(
      'PRECONDITION_FAILED',
      'Bu salon için WhatsApp doğrulama servisi henüz hazır değil.',
      412,
    );
  }

  // FAST PATH: phone already linked to this salon.
  const ecoLinks = await findSalonLinksForPhone(normalized.digits);
  const alreadyLinked = ecoLinks.identity
    ? ecoLinks.links.some((l) => l.salonId === salonId)
    : false;

  if (alreadyLinked) {
    return res.status(200).json({
      state: 'already_verified',
      verifiedAt: ecoLinks.identity?.lastVerifiedAt?.toISOString(),
    });
  }

  const purpose = ecoLinks.identity
    ? VerificationPurpose.CUSTOMER_LINK_CONSENT
    : VerificationPurpose.CUSTOMER_PHONE;

  const { ipAddress, userAgent } = clientReqInfo(req);
  const link = await createVerificationLink({
    purpose,
    channel: VerificationChannel.WHATSAPP,
    targetSalonId: salonId,
    targetPhone: normalized.digits,
    payload: {
      salonName: salon.name,
      customerName,
      source,
      countryIso: normalized.countryIso,
      e164: normalized.e164,
    },
    salonSlug: salon.slug || null,
    ipAddress,
    userAgent,
  });

  const sendResult = await sendVerificationLinkTemplate({
    salonId,
    phone: normalized.digits,
    token: link.token,
    ttlMinutes: VERIFICATION_TTL_MINUTES,
  });

  if (!sendResult.ok) {
    throw new BusinessError('INTERNAL_ERROR', 'WhatsApp gönderimi başarısız.', 500, {
      reason: sendResult.error,
    });
  }

  return res.status(202).json({
    id: link.id,
    state: purpose === VerificationPurpose.CUSTOMER_LINK_CONSENT ? 'consent_required' : 'verification_required',
    channel: 'whatsapp',
    expiresAt: link.expiresAt.toISOString(),
    resendCooldownSeconds: VERIFICATION_RESEND_COOLDOWN_SECONDS,
  });
});

// GET /api/customers/verify-link/peek?token=...
// Read-only check used by the landing page to differentiate UI:
//   - CUSTOMER_LINK_CONSENT  → cross-salon, show "Tekrar hoş geldin" CTA
//   - CUSTOMER_PHONE         → new customer, standard verify UI
// Does not consume the token. Returns 404 if invalid/expired/used.
router.get('/verify-link/peek', async (req: any, res: any) => {
  const token = String(req.query?.token || '').trim();
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token gereklidir.', 400);
  }
  const peeked = await peekVerificationLink(token);
  if (!peeked) {
    return res.status(404).json({ code: 'VERIFICATION_LINK_NOT_FOUND' });
  }
  if (
    peeked.purpose !== VerificationPurpose.CUSTOMER_PHONE &&
    peeked.purpose !== VerificationPurpose.CUSTOMER_LINK_CONSENT
  ) {
    return res.status(400).json({ code: 'INVALID_PURPOSE' });
  }
  const payloadAny = peeked.payload as any;
  return res.status(200).json({
    purpose: peeked.purpose,
    isReturning: peeked.purpose === VerificationPurpose.CUSTOMER_LINK_CONSENT,
    salonName: (payloadAny?.salonName as string) || null,
    customerName: (payloadAny?.customerName as string) || null,
  });
});

router.post('/verify-link/confirm', async (req: any, res: any) => {
  const salonId = req.salon?.id;
  if (!salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Salon kontekstı bulunamadı.', 400);
  }

  const token = String(req.body?.token || '').trim();
  const consentAccepted = req.body?.consentAccepted === true;
  if (!token) {
    throw new BusinessError('VALIDATION_FAILED', 'token gereklidir.', 400);
  }
  if (!consentAccepted) {
    throw new BusinessError('VALIDATION_FAILED', 'KVKK onayı gereklidir.', 400);
  }

  const { ipAddress, userAgent } = clientReqInfo(req);

  let consumed;
  try {
    consumed = await consumeVerificationLink(token, { ipAddress, userAgent });
  } catch (error: any) {
    if (error instanceof VerificationError) {
      const status = error.code === 'VERIFICATION_LINK_EXPIRED' ? 410 : 400;
      throw new BusinessError(error.code, error.message, status);
    }
    throw error;
  }

  if (
    consumed.purpose !== VerificationPurpose.CUSTOMER_PHONE &&
    consumed.purpose !== VerificationPurpose.CUSTOMER_LINK_CONSENT
  ) {
    throw new BusinessError('VALIDATION_FAILED', 'Geçersiz doğrulama tipi.', 400);
  }
  if (consumed.targetSalonId !== salonId) {
    throw new BusinessError('VALIDATION_FAILED', 'Bu doğrulama bu salona ait değil.', 400);
  }

  const phone = consumed.targetPhone;
  if (!phone) {
    throw new BusinessError('INTERNAL_ERROR', 'Doğrulama eksik.', 500);
  }

  const payloadAny = consumed.payload as any;
  const customerName = (payloadAny?.customerName as string) || 'Müşteri';
  const source = ((payloadAny?.source as string) || 'BOOKING').toUpperCase() as
    | 'INSTAGRAM'
    | 'BOOKING'
    | 'ADMIN'
    | 'WHATSAPP_INBOUND'
    | 'WEB';

  // Upsert ecosystem PhoneIdentity.
  const phoneIdentity = await upsertPhoneIdentity({ phone });

  // Create or upgrade the salon's Customer row.
  const existing = await prisma.customer.findFirst({
    where: { phone, salonId },
  });

  let customer;
  if (existing) {
    customer = await prisma.customer.update({
      where: { id: existing.id },
      data: { registrationStatus: 'VERIFIED' },
    });
  } else {
    const splitName = customerName.split(' ');
    customer = await prisma.customer.create({
      data: {
        phone,
        salonId,
        name: customerName,
        firstName: splitName[0] || null,
        lastName: splitName.slice(1).join(' ') || null,
        registrationStatus: 'VERIFIED',
        acceptMarketing: false,
      },
    });
    await prisma.customerRiskProfile.create({
      data: {
        customerId: customer.id,
        salonId,
        riskScore: 0,
        riskLevel: null,
      },
    });
  }

  await linkCustomerToIdentity({
    salonId,
    phoneIdentityId: phoneIdentity.id,
    customerId: customer.id,
    consentSource: source,
    optInChannels: { whatsapp: true },
  });

  // Sync to platform-wide GlobalCustomerIdentity (so a future salon sees
  // this person as already-verified and can offer one-tap registration).
  await syncCustomerToGlobalIdentity(customer.id).catch(err =>
    console.error('GlobalCustomerIdentity sync failed:', err)
  );
  await markGlobalIdentityVerified(phone).catch(() => undefined);

  return res.status(200).json({
    state: 'verified',
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
    },
    salon: {
      id: salonId,
    },
  });
});

export default router;
