import { getSession } from './session.js';

/**
 * Read the session in a Server Component (App Router).
 * Returns the session user object, or null if not authenticated.
 */
export async function getServerSession() {
  try {
    const session = await getSession();
    return session?.user ?? null;
  } catch (err) {
    // cookies() throws this during prerendering to tell Next the route is
    // dynamic. It is control flow, not a failure, so let it through.
    if (err?.digest === 'DYNAMIC_SERVER_USAGE') throw err;

    // Otherwise still return null so public pages degrade instead of 500ing,
    // but log it: silence here makes a broken session layer indistinguishable
    // from an ordinary anonymous request.
    console.error('[getServerSession]', err);
    return null;
  }
}
