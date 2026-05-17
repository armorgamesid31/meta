// Multi-step team-invite onboarding orchestrator.
//
// The legacy /auth/invites/* endpoints collected everything (name,
// phone, email, password) in one POST. The new flow walks the user
// through ad → soyad → cinsiyet → telefon → telefon doğrulama →
// e-posta → e-posta doğrulama → fotoğraf → şifre, persisting partial
// state in OnboardingSession so a phone-app switch or app restart
// doesn't lose progress.

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { validateInvite, activateInvite } from './inviteService.js';
import { sendKedyEkipTemplate } from './whatsappCentralSender.js';
import { sendVerificationEmail, isEmailConfigured } from './emailService.js';

const ONBOARDING_TTL_HOURS = 24;
const PHONE_LINK_TTL_MINUTES = 15;
const EMAIL_LINK_TTL_MINUTES = 30;

const VERIFICATION_BASE_URL =
  (process.env.VERIFICATION_BASE_URL_KEDY || process.env.FRONTEND_URL || 'https://app.berkai.shop').trim().replace(/\/+$/, '');

function generateToken(): string {
  // url-safe, ~22 chars
  return crypto.randomBytes(16).toString('base64url');
}

export async function startOnboarding(input: { code?: string; token?: string }): Promise<{
  sessionId: string;
  salon: { id: number; name: string; slug: string | null; logoUrl: string | null };
  invite: { id: number; role: string };
}> {
  const validated = await validateInvite({ code: input.code, token: input.token });
  if (!validated) throw new Error('INVITE_INVALID');

  const session = await prisma.onboardingSession.create({
    data: {
      inviteId: validated.inviteId,
      expiresAt: new Date(Date.now() + ONBOARDING_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  const [salonRow, inviteRow] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: validated.salon.id },
      select: { id: true, name: true, slug: true, logoUrl: true },
    }),
    prisma.invite.findUnique({
      where: { id: validated.inviteId },
      include: { invitedMembership: { select: { role: true } } },
    }),
  ]);

  return {
    sessionId: session.id,
    salon: {
      id: validated.salon.id,
      name: salonRow?.name || validated.salon.name || 'Salon',
      slug: salonRow?.slug || null,
      logoUrl: salonRow?.logoUrl || null,
    },
    invite: {
      id: validated.inviteId,
      role: inviteRow?.invitedMembership?.role || 'STAFF',
    },
  };
}

export interface OnboardingPatch {
  firstName?: string;
  lastName?: string;
  gender?: 'female' | 'male' | 'other';
  photoUrl?: string;
}

export async function patchOnboarding(sessionId: string, patch: OnboardingPatch) {
  const session = await getActiveSession(sessionId);
  await prisma.onboardingSession.update({
    where: { id: session.id },
    data: {
      firstName: patch.firstName ?? session.firstName,
      lastName: patch.lastName ?? session.lastName,
      gender: patch.gender ?? session.gender,
      photoUrl: patch.photoUrl ?? session.photoUrl,
    },
  });
}

async function getActiveSession(sessionId: string) {
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (session.activatedAt) throw new Error('SESSION_ALREADY_ACTIVATED');
  if (session.expiresAt.getTime() < Date.now()) throw new Error('SESSION_EXPIRED');
  return session;
}

export async function sendPhoneMagicLink(input: { sessionId: string; phone: string }): Promise<void> {
  const session = await getActiveSession(input.sessionId);
  const normalizedPhone = String(input.phone || '').trim();
  if (!normalizedPhone || normalizedPhone.length < 8) {
    throw new Error('PHONE_INVALID');
  }

  const token = generateToken();
  await prisma.onboardingSession.update({
    where: { id: session.id },
    data: {
      phone: normalizedPhone,
      phoneToken: token,
      phoneTokenSentAt: new Date(),
      phoneVerifiedAt: null,
    },
  });

  const result = await sendKedyEkipTemplate({ phone: normalizedPhone, token });
  if (!result.ok) {
    throw new Error(`WHATSAPP_SEND_FAILED:${result.error || 'unknown'}`);
  }
}

export async function sendEmailMagicLink(input: { sessionId: string; email: string }): Promise<void> {
  const session = await getActiveSession(input.sessionId);
  const email = String(input.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('EMAIL_INVALID');
  }
  if (!isEmailConfigured()) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');

  const token = generateToken();
  await prisma.onboardingSession.update({
    where: { id: session.id },
    data: {
      email,
      emailToken: token,
      emailTokenSentAt: new Date(),
      emailVerifiedAt: null,
    },
  });

  const link = `${VERIFICATION_BASE_URL}/v/e/${token}`;
  await sendVerificationEmail({
    to: email,
    name: session.firstName || null,
    actionLabel: 'e-posta doğrulama',
    link,
    ttlMinutes: EMAIL_LINK_TTL_MINUTES,
  });
}

export async function getOnboardingStatus(sessionId: string) {
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  return {
    sessionId: session.id,
    firstName: session.firstName,
    lastName: session.lastName,
    gender: session.gender,
    phone: session.phone,
    email: session.email,
    photoUrl: session.photoUrl,
    phoneVerified: Boolean(session.phoneVerifiedAt),
    emailVerified: Boolean(session.emailVerifiedAt),
    activated: Boolean(session.activatedAt),
    expiresAt: session.expiresAt.toISOString(),
  };
}

/**
 * Called when the user taps the magic-link button. Marks the session's
 * phone or email as verified depending on which token matched. Returns
 * which side was verified so the landing page can render the right
 * "you can go back to the app" copy.
 */
export async function consumeMagicLink(token: string): Promise<{ side: 'phone' | 'email'; sessionId: string } | null> {
  if (!token) return null;

  const phoneSession = await prisma.onboardingSession.findUnique({ where: { phoneToken: token } });
  if (phoneSession) {
    if (phoneSession.activatedAt) return null;
    const ttlOk =
      !phoneSession.phoneTokenSentAt ||
      Date.now() - phoneSession.phoneTokenSentAt.getTime() <= PHONE_LINK_TTL_MINUTES * 60 * 1000;
    if (!ttlOk) return null;

    await prisma.onboardingSession.update({
      where: { id: phoneSession.id },
      data: { phoneVerifiedAt: new Date(), phoneToken: null },
    });
    return { side: 'phone', sessionId: phoneSession.id };
  }

  const emailSession = await prisma.onboardingSession.findUnique({ where: { emailToken: token } });
  if (emailSession) {
    if (emailSession.activatedAt) return null;
    const ttlOk =
      !emailSession.emailTokenSentAt ||
      Date.now() - emailSession.emailTokenSentAt.getTime() <= EMAIL_LINK_TTL_MINUTES * 60 * 1000;
    if (!ttlOk) return null;

    await prisma.onboardingSession.update({
      where: { id: emailSession.id },
      data: { emailVerifiedAt: new Date(), emailToken: null },
    });
    return { side: 'email', sessionId: emailSession.id };
  }

  return null;
}

export async function activateOnboarding(input: {
  sessionId: string;
  password: string;
}): Promise<Awaited<ReturnType<typeof activateInvite>>> {
  const session = await getActiveSession(input.sessionId);

  if (!session.firstName || !session.lastName) throw new Error('NAME_REQUIRED');
  if (!session.phone || !session.phoneVerifiedAt) throw new Error('PHONE_NOT_VERIFIED');
  if (!session.email || !session.emailVerifiedAt) throw new Error('EMAIL_NOT_VERIFIED');
  if (!input.password || input.password.length < 8) throw new Error('PASSWORD_TOO_SHORT');

  const invite = await prisma.invite.findUnique({ where: { id: session.inviteId } });
  if (!invite) throw new Error('INVITE_INVALID');

  // Re-use the legacy activateInvite() so identity merge + legacy
  // SalonUser bridging keep working. We pass the invite's tokenHash
  // by looking up the raw code… actually activateInvite re-validates
  // off the code/token, so we need to keep one of them around. The
  // simplest path: pass invite.id-derived shortcut.
  // For now, look up the invite raw code via direct DB read isn't
  // possible (we only stored a hash). So we require the original code
  // to have been preserved in session payload — TODO: cleaner story.
  // Workaround: temporarily emit a one-shot token on the invite that
  // matches the existing hash. Easier: extend activateInvite to take
  // a pre-resolved membershipId.
  //
  // For this iteration we shortcut by trusting the session and going
  // straight to the membership update path inline.

  const targetMembership = await prisma.salonMembership.findUnique({
    where: { id: invite.invitedMembershipId || -1 },
    include: { identity: true },
  });
  if (!targetMembership) throw new Error('MEMBERSHIP_NOT_FOUND');

  const firstName = session.firstName.trim();
  const lastName = session.lastName.trim();
  const displayName = `${firstName} ${lastName}`.trim();
  const passwordHash = await bcrypt.hash(input.password, 10);

  const result = await prisma.$transaction(async (tx) => {
    await tx.userIdentity.update({
      where: { id: targetMembership.identityId },
      data: {
        firstName,
        lastName,
        displayName,
        phone: session.phone,
        email: session.email,
        passwordHash,
        isActive: true,
      },
    });

    const membership = await tx.salonMembership.update({
      where: { id: targetMembership.id },
      data: { isActive: true, passwordResetRequired: false },
    });

    const legacy = membership.legacySalonUserId
      ? await tx.salonUser.update({
          where: { id: membership.legacySalonUserId },
          data: {
            firstName,
            lastName,
            displayName,
            phone: session.phone,
            email: session.email,
            passwordHash,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
            role: membership.role,
          },
        })
      : await tx.salonUser.create({
          data: {
            salonId: membership.salonId,
            email: session.email!,
            phone: session.phone,
            firstName,
            lastName,
            displayName,
            role: membership.role,
            isActive: true,
            passwordResetRequired: false,
            activationCompletedAt: new Date(),
            passwordHash,
          },
        });

    await tx.salonMembership.update({
      where: { id: membership.id },
      data: { legacySalonUserId: legacy.id },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });

    await tx.onboardingSession.update({
      where: { id: session.id },
      data: { activatedAt: new Date(), passwordHash },
    });

    return {
      salonId: membership.salonId,
      identityId: targetMembership.identityId,
      membershipId: membership.id,
      legacyUserId: legacy.id,
      role: membership.role,
      email: session.email,
    };
  });

  return result;
}
