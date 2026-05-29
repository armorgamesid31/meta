import jwt from 'jsonwebtoken';
import { createPublicKey } from 'node:crypto';

// Apple's JWKS endpoint and issuer. Public, no auth required.
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

// Apple tokens have two flavors of audience depending on the client:
//   - iOS / macOS native:  the app's bundle id  (e.g. com.kedyapp.salonmanagement)
//   - Web / Android via Apple JS: the Service ID (e.g. com.kedyapp.salonmanagement.web)
// We accept both so a single endpoint covers all clients.
const AUDIENCES = [
  process.env.APPLE_BUNDLE_ID,
  process.env.APPLE_SERVICE_ID,
].filter((v): v is string => typeof v === 'string' && v.length > 0);

type AppleJwk = {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
};

// Apple rotates JWKS keys infrequently (months apart) but we still
// keep a 24h cache + automatic refetch on cache miss to avoid hot
// reading the network on every login.
let cache: { keys: AppleJwk[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJwks(force = false): Promise<AppleJwk[]> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.keys;
  }
  const res = await fetch(APPLE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`Apple JWKS fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as { keys: AppleJwk[] };
  if (!Array.isArray(json?.keys) || !json.keys.length) {
    throw new Error('Apple JWKS response had no keys.');
  }
  cache = { keys: json.keys, expiresAt: Date.now() + CACHE_TTL_MS };
  return json.keys;
}

function jwkToPem(jwk: AppleJwk): string {
  const key = createPublicKey({ key: jwk as any, format: 'jwk' });
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

export type AppleIdentity = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
};

export async function verifyAppleIdToken(idToken: string): Promise<AppleIdentity> {
  if (!AUDIENCES.length) {
    throw new Error('APPLE_BUNDLE_ID / APPLE_SERVICE_ID env not set');
  }
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded !== 'object' || !decoded.header?.kid) {
    throw new Error('Apple ID token is malformed (missing kid).');
  }

  let keys = await fetchJwks();
  let key = keys.find((k) => k.kid === decoded.header.kid);
  // kid mismatch usually means Apple rotated keys — bust the cache
  // and try once more before giving up.
  if (!key) {
    keys = await fetchJwks(true);
    key = keys.find((k) => k.kid === decoded.header.kid);
  }
  if (!key) {
    throw new Error('Apple JWKS does not contain matching kid.');
  }

  const pem = jwkToPem(key);
  const payload = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    // jsonwebtoken types insist on a non-empty tuple for the multi-aud
    // form; we've already asserted AUDIENCES.length > 0 above.
    audience: AUDIENCES as [string, ...string[]],
  }) as jwt.JwtPayload;

  if (!payload.sub) {
    throw new Error('Apple ID token has no subject.');
  }

  // Apple's `email_verified` arrives as either a boolean or the string
  // "true" / "false" depending on the client SDK version — normalise.
  const ev = payload.email_verified;
  const emailVerified = ev === true || ev === 'true';

  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerified,
  };
}
