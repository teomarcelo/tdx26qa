import { requireEnv } from './env.js';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Scopes required — openid gives id_token, email + profile for display name */
export const OAUTH_SCOPES = ['openid', 'email', 'profile'];

/** Build the Google OAuth authorization URL with state + nonce */
export function buildAuthUrl({ state, nonce }) {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const appUrl = requireEnv('APP_URL');
  const allowedDomain = requireEnv('ALLOWED_DOMAIN');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/auth/callback`,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state,
    nonce,
    // Restrict picker to allowed domain; Google still validates hd on the token
    hd: allowedDomain,
    access_type: 'online',
    prompt: 'select_account',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code for tokens */
export async function exchangeCode(code) {
  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
  const appUrl = requireEnv('APP_URL');

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appUrl}/api/auth/callback`,
      grant_type: 'authorization_code',
    }).toString(),
    // undici applies no overall request timeout, so a stalled Google response
    // would outlive the serverless invocation budget and kill the function
    // before the caller's catch can render a friendly error. The abort rejects
    // with a TimeoutError instead, which that catch already handles. (The JWKS
    // fetch is covered by jose's 5000ms default timeoutDuration.)
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Fetch Google's public JWKS and validate the id_token JWT.
 *
 * Validates:
 *   - Signature against Google's current public keys
 *   - iss = https://accounts.google.com
 *   - aud = GOOGLE_CLIENT_ID
 *   - exp (not expired)
 *   - nonce matches stored nonce
 *   - email_verified = true
 *   - hd = ALLOWED_DOMAIN (hosted domain claim)
 *   - email ends with @ALLOWED_DOMAIN
 *
 * Returns the decoded payload on success; throws on any failure.
 */
/**
 * Google's JWKS, created once per process. createRemoteJWKSet caches and
 * rotates keys internally, so rebuilding it per sign-in would refetch the
 * certs every time.
 */
let jwksPromise = null;
function getJwks() {
  if (!jwksPromise) {
    jwksPromise = import('jose').then(({ createRemoteJWKSet }) =>
      createRemoteJWKSet(new URL(GOOGLE_CERTS_URL))
    );
  }
  return jwksPromise;
}

export async function validateIdToken(idToken, expectedNonce) {
  const { jwtVerify } = await import('jose');

  const clientId = requireEnv('GOOGLE_CLIENT_ID');
  const allowedDomain = requireEnv('ALLOWED_DOMAIN');

  const JWKS = await getJwks();

  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: GOOGLE_ISSUER,
    audience: clientId,
  });

  // Nonce check — prevents replay attacks
  if (payload.nonce !== expectedNonce) {
    throw new Error('Nonce mismatch — possible replay attack.');
  }

  // Email must be verified by Google
  if (!payload.email_verified) {
    throw new Error('Google account email is not verified.');
  }

  // hd claim — Google Workspace hosted domain
  if (payload.hd !== allowedDomain) {
    throw new Error(
      `Account domain "${payload.hd}" is not allowed. ` +
      `Only @${allowedDomain} accounts may sign in.`
    );
  }

  // Belt-and-suspenders: check email suffix too
  const email = String(payload.email || '');
  if (!email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
    throw new Error(`Email "${email}" is not a @${allowedDomain} account.`);
  }

  return payload;
}

/** Generate a cryptographically random URL-safe string */
export function generateRandom(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Buffer.from(arr).toString('base64url');
}
