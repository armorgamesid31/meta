// Salon-NEUTRAL customer profile portal API ("Bilgilerim").
//
// Mounted BEFORE the multi-tenant middleware (no salon scope): the portal is
// platform-wide and authenticates with its own short-lived session JWT, NOT a
// salon login. Entry is always via a magic link the AI tool sends to a
// channel-proven address; this exchanges that single-use token for a session.
//
// Security: the session JWT carries the globalIdentityId; every handler acts
// ONLY on req.portalIdentityId (never an id from the request body) — no IDOR.

import { Router } from 'express';
import {
  consumePortalToken,
  signPortalSession,
  verifyPortalSession,
  getPortalProfile,
  updatePortalProfile,
} from '../services/profilePortalService.js';
import { removeIdentityChannel } from '../services/globalCustomerIdentity.js';

const router = Router();

// Exchange a single-use magic token for a short-lived portal session.
router.post('/session', async (req: any, res: any) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'token_required' });
    const consumed = await consumePortalToken(token);
    if (!consumed) return res.status(401).json({ error: 'invalid_or_expired' });
    const session = signPortalSession(consumed.globalIdentityId);
    const profile = await getPortalProfile(consumed.globalIdentityId);
    return res.status(200).json({ ...session, profile });
  } catch (error: any) {
    console.error('Portal session error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Portal session guard: Bearer portal-JWT -> req.portalIdentityId.
function requirePortalSession(req: any, res: any, next: any) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const session = token ? verifyPortalSession(token) : null;
  if (!session) return res.status(401).json({ error: 'unauthenticated' });
  req.portalIdentityId = session.globalIdentityId;
  next();
}

router.get('/profile', requirePortalSession, async (req: any, res: any) => {
  try {
    const profile = await getPortalProfile(req.portalIdentityId);
    if (!profile) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json(profile);
  } catch (error: any) {
    console.error('Portal profile read error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.patch('/profile', requirePortalSession, async (req: any, res: any) => {
  try {
    const body = req.body || {};
    const patch: {
      firstName?: string | null;
      lastName?: string | null;
      gender?: any;
      birthDate?: Date | null;
      photoUrl?: string | null;
      acceptMarketing?: boolean;
    } = {};
    if ('firstName' in body) patch.firstName = body.firstName == null ? null : String(body.firstName).trim();
    if ('lastName' in body) patch.lastName = body.lastName == null ? null : String(body.lastName).trim();
    if ('gender' in body) patch.gender = body.gender == null ? null : body.gender;
    if ('photoUrl' in body) patch.photoUrl = body.photoUrl == null ? null : String(body.photoUrl);
    if ('acceptMarketing' in body) patch.acceptMarketing = Boolean(body.acceptMarketing);
    if ('birthDate' in body) {
      if (body.birthDate == null || body.birthDate === '') {
        patch.birthDate = null;
      } else {
        const d = new Date(body.birthDate);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'invalid_birthDate' });
        patch.birthDate = d;
      }
    }
    const result = await updatePortalProfile(req.portalIdentityId, patch);
    if (result.status === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (result.status === 'birthday_locked') {
      return res.status(409).json({ error: 'birthday_locked', nextAllowedAt: result.nextAllowedAt });
    }
    const profile = await getPortalProfile(req.portalIdentityId);
    return res.status(200).json(profile);
  } catch (error: any) {
    console.error('Portal profile update error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Detach a linked channel (old number / Instagram). Service guards prevent
// removing the primary phone or the last remaining channel. Never deletes
// salon-side data — only the platform reach.
router.delete('/channels/:rowId', requirePortalSession, async (req: any, res: any) => {
  try {
    const result = await removeIdentityChannel({
      globalIdentityId: req.portalIdentityId,
      channelRowId: String(req.params.rowId || ''),
    });
    if (result.status === 'removed') return res.status(200).json({ ok: true });
    if (result.status === 'not_found') return res.status(404).json({ error: 'not_found' });
    return res.status(409).json({ error: result.status });
  } catch (error: any) {
    console.error('Portal channel remove error:', error);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
