import { OAuth2Client } from 'google-auth-library';

// Accept tokens issued for any of our OAuth clients so the same backend
// endpoint serves web, iOS, and Android. The Google client library
// matches the token's `aud` claim against this list. At least one must
// be set or verification fails fast with a clear config error.
const AUDIENCES = [
  process.env.GOOGLE_CLIENT_ID_WEB,
  process.env.GOOGLE_CLIENT_ID_IOS,
  process.env.GOOGLE_CLIENT_ID_ANDROID,
].filter((v): v is string => typeof v === 'string' && v.length > 0);

const client = new OAuth2Client();

export type GoogleIdentity = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  picture: string | null;
};

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!AUDIENCES.length) {
    throw new Error(
      'GOOGLE_CLIENT_ID_WEB / GOOGLE_CLIENT_ID_IOS / GOOGLE_CLIENT_ID_ANDROID env not set',
    );
  }
  const ticket = await client.verifyIdToken({
    idToken,
    audience: AUDIENCES,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub) {
    throw new Error('Google ID token has no subject.');
  }
  return {
    sub: payload.sub,
    email: payload.email ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    firstName: payload.given_name || null,
    lastName: payload.family_name || null,
    picture: payload.picture || null,
  };
}
