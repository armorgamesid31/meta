// Instagram account verification by code-DM.
//
// Flow: registration shows a short code (KEDY-XXXXX). The customer DMs it from
// their own Instagram to the Kedy-central (or a salon's) IG account. The IG
// webhook calls tryConsumeInstagramVerifyCode with the message text + the
// sender IGSID — if the text carries a pending code we mark it USED, capture the
// IGSID, and (once the person's global identity exists) bind that IGSID to them.
// This is the ONLY synchronous proof of IG-account ownership the platform allows
// (graph.instagram.com has no username→IGSID lookup).

import { prisma } from '../prisma.js';
import { upsertGlobalIdentityChannel } from './globalCustomerIdentity.js';

const CODE_TTL_MINUTES = 15;
// Confusable-free alphabet (no 0/O/1/I) so the code is easy to read + type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /KEDY-([A-Z0-9]{5})/i;

/** The IG @username the customer should DM the code to. Kedy-central account
 *  (set once Berkay connects it). Salon-specific targets can be added later —
 *  the webhook matches the code from ANY IG account regardless of target. */
export function resolveInstagramVerifyTarget(): string | null {
  const env = (process.env.KEDY_INSTAGRAM_USERNAME || '').trim().replace(/^@/, '');
  return env || null;
}

function generateCode(): string {
  let s = '';
  for (let i = 0; i < 5; i += 1) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `KEDY-${s}`;
}

export async function startInstagramVerification(input: {
  salonId: number;
  phoneE164: string | null;
}): Promise<{ code: string; targetUsername: string | null }> {
  // Supersede any still-pending codes for this phone+salon.
  if (input.phoneE164) {
    await prisma.instagramVerificationCode.updateMany({
      where: { salonId: input.salonId, phoneE164: input.phoneE164, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
  }

  let code = generateCode();
  for (let i = 0; i < 4; i += 1) {
    const clash = await prisma.instagramVerificationCode.findUnique({ where: { code }, select: { id: true } });
    if (!clash) break;
    code = generateCode();
  }

  const targetUsername = resolveInstagramVerifyTarget();
  await prisma.instagramVerificationCode.create({
    data: {
      code,
      salonId: input.salonId,
      phoneE164: input.phoneE164,
      targetUsername,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    },
  });
  return { code, targetUsername };
}

/**
 * Called from the IG webhook for every inbound DM. If the message text carries a
 * pending verification code, mark it USED, capture the sender IGSID, and bind it
 * to the person's global identity (if it already exists). Idempotent + safe.
 * Returns true if a code was consumed.
 */
export async function tryConsumeInstagramVerifyCode(input: {
  igsid: string;
  username: string | null;
  text: string;
}): Promise<boolean> {
  const match = (input.text || '').match(CODE_RE);
  if (!match) return false;
  const code = `KEDY-${match[1].toUpperCase()}`;
  const igsid = (input.igsid || '').trim();
  if (!igsid) return false;

  const rec = await prisma.instagramVerificationCode.findUnique({ where: { code } });
  if (!rec || rec.status !== 'PENDING' || rec.expiresAt < new Date()) return false;

  await prisma.instagramVerificationCode.update({
    where: { id: rec.id },
    data: {
      status: 'USED',
      boundIgsid: igsid,
      boundUsername: input.username,
      usedAt: new Date(),
    },
  });

  // If the person already has a global identity (phone registered), bind now.
  // Otherwise registration finalize (finalizeInstagramBindForPhone) does it.
  if (rec.phoneE164) {
    const gi = await prisma.globalCustomerIdentity.findUnique({
      where: { phoneE164: rec.phoneE164 },
      select: { id: true },
    });
    if (gi) {
      await upsertGlobalIdentityChannel({
        globalIdentityId: gi.id,
        channel: 'INSTAGRAM',
        subjectType: 'INSTAGRAM_ID',
        subjectNormalized: igsid,
        subjectRaw: igsid,
        profileUsername: input.username,
        verified: true,
      }).catch(() => {});
    }
  }
  return true;
}

/** Poll target for the frontend. */
export async function getInstagramVerifyStatus(
  code: string,
): Promise<{ status: 'verified' | 'pending' | 'expired' | 'not_found'; username?: string | null }> {
  const rec = await prisma.instagramVerificationCode.findUnique({
    where: { code },
    select: { status: true, boundUsername: true, expiresAt: true },
  });
  if (!rec) return { status: 'not_found' };
  if (rec.status === 'USED') return { status: 'verified', username: rec.boundUsername };
  if (rec.status === 'EXPIRED' || rec.expiresAt < new Date()) return { status: 'expired' };
  return { status: 'pending' };
}

/**
 * Called at the end of /register: if the customer messaged their IG code BEFORE
 * finishing registration (so the webhook captured the IGSID but couldn't bind —
 * no identity yet), bind it now to the freshly-created global identity.
 */
export async function finalizeInstagramBindForPhone(input: {
  phoneE164: string;
  globalIdentityId: string;
}): Promise<void> {
  try {
    const rec = await prisma.instagramVerificationCode.findFirst({
      where: { phoneE164: input.phoneE164, status: 'USED', boundIgsid: { not: null } },
      orderBy: { usedAt: 'desc' },
      select: { boundIgsid: true, boundUsername: true },
    });
    if (rec?.boundIgsid) {
      await upsertGlobalIdentityChannel({
        globalIdentityId: input.globalIdentityId,
        channel: 'INSTAGRAM',
        subjectType: 'INSTAGRAM_ID',
        subjectNormalized: rec.boundIgsid,
        subjectRaw: rec.boundIgsid,
        profileUsername: rec.boundUsername,
        verified: true,
      });
    }
  } catch (e) {
    console.warn('finalizeInstagramBindForPhone failed:', (e as any)?.message || e);
  }
}
