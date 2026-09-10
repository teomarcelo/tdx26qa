import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, validateIdToken } from '../../../../lib/oauth.js';
import { getSession } from '../../../../lib/session.js';
import { requireEnv } from '../../../../lib/env.js';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'sqa_oauth_state';
const NONCE_COOKIE = 'sqa_oauth_nonce';

export async function GET(request) {
  // Every redirect below is request-relative, so APP_URL is not read here — but
  // an unconfigured gateway should still answer with the same clean JSON error as
  // /api/auth/login rather than a bare 500. (lib/oauth.js still builds
  // redirect_uri from APP_URL, which OAuth requires to match exactly.)
  try {
    requireEnv('APP_URL');
  } catch (err) {
    console.error('[auth/callback] env validation failed:', err.message);
    return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);

  // --- 1. Check for OAuth error response ---
  const oauthError = searchParams.get('error');
  if (oauthError) {
    const desc = searchParams.get('error_description') || oauthError;
    console.warn('[auth/callback] OAuth provider error:', desc);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(desc)}`, request.url)
    );
  }

  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');

  if (!code || !returnedState) {
    return NextResponse.redirect(new URL('/login?error=missing_params', request.url));
  }

  // --- 2. Validate CSRF state ---
  // await: cookies() is a Promise in Next 16, and .get()/.delete() live on the
  // resolved store. Optional chaining on .get(...) does not cover this, because
  // what is missing is the method, not the cookie.
  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE)?.value;
  const storedNonce = cookieStore.get(NONCE_COOKIE)?.value;

  if (!storedState || !storedNonce) {
    console.warn('[auth/callback] Missing state/nonce cookies — session likely expired.');
    return NextResponse.redirect(new URL('/login?error=session_expired', request.url));
  }

  if (returnedState !== storedState) {
    console.warn('[auth/callback] State mismatch — possible CSRF attempt.');
    return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
  }

  // --- 3. Exchange code for tokens ---
  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error('[auth/callback] Token exchange error:', err.message);
    return NextResponse.redirect(new URL('/login?error=token_exchange_failed', request.url));
  }

  // --- 4. Validate id_token (iss, aud, exp, nonce, email_verified, hd, email) ---
  let payload;
  try {
    payload = await validateIdToken(tokens.id_token, storedNonce);
  } catch (err) {
    console.warn('[auth/callback] Token validation failed:', err.message);
    // Use a user-friendly message for domain restriction
    const userMsg = err.message.includes('not allowed') || err.message.includes('not a @')
      ? 'access_denied_domain'
      : 'invalid_token';
    return NextResponse.redirect(new URL(`/login?error=${userMsg}`, request.url));
  }

  // --- 5. Write session, then clear the short-lived OAuth cookies ---
  // Guarded because the authorization code has already been redeemed at Google
  // and is single-use: an unhandled throw here (iron-session rejects a sealed
  // cookie over 4096 bytes, and the payload carries a Google CDN picture URL)
  // would strand the user on a bare 500 with nothing left to retry.
  try {
    const session = await getSession();
    session.user = {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || null,
      issuedAt: Math.floor(Date.now() / 1000),
    };
    await session.save();

    cookieStore.delete(STATE_COOKIE);
    cookieStore.delete(NONCE_COOKIE);
  } catch (err) {
    console.error('[auth/callback] Session write failed:', err);
    return NextResponse.redirect(new URL('/login?error=session_write_failed', request.url));
  }

  // Sign-in only happens to reach the gated instructor app, so land there.
  return NextResponse.redirect(new URL('/instructor', request.url));
}
