import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { requireEnv } from './env.js';

export const SESSION_COOKIE_NAME = 'sqa_session';

/** 8-hour session lifetime */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function getSessionOptions() {
  return {
    cookieName: SESSION_COOKIE_NAME,
    password: requireEnv('SESSION_SECRET'),
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SECONDS,
      path: '/',
    },
  };
}

/**
 * Returns the iron-session backed by Next's cookie store, so save()/destroy()
 * persist through that store rather than a NextResponse object.
 *
 * cookies() must be awaited: since Next 16 it returns a Promise, and
 * iron-session calls .get() on whatever it is handed synchronously, so passing
 * the Promise throws "TypeError: e.get is not a function" on every call.
 *
 * proxy.js deliberately uses the getIronSession(request, response, options)
 * overload instead — it reads cookies off the request headers and is unaffected.
 */
export async function getSession() {
  return getIronSession(await cookies(), getSessionOptions());
}

/**
 * Shape of the stored session data.
 * @typedef {{ email: string, name: string, picture: string | null, issuedAt: number }} SessionUser
 */
