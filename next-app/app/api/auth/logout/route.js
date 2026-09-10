import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session.js';
import { requireEnv } from '../../../../lib/env.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  // The redirect below is request-relative, so APP_URL is not read here — but an
  // unconfigured gateway should still answer with the same clean JSON error as
  // /api/auth/login rather than a bare 500.
  try {
    requireEnv('APP_URL');
  } catch (err) {
    console.error('[auth/logout] env validation failed:', err.message);
    return NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 });
  }

  const session = await getSession();
  session.destroy();

  return NextResponse.redirect(new URL('/login?logged_out=1', request.url));
}

// Support POST logout (e.g. from a form) as well
export const POST = GET;
