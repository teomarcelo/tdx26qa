/**
 * Env var checks for the OAuth gateway.
 *
 * These run at request time, not at boot: validateEnv() is called from
 * /api/auth/login, and requireEnv() from the other auth routes and helpers.
 * Deliberately not at module scope — Turbopack evaluates that during
 * `next build` page-data collection, which would break builds in any
 * environment without secrets (the same reason proxy.js fails closed on
 * missing config instead of throwing).
 *
 * Every caller is responsible for catching: a throw that escapes a route
 * handler becomes a bare 500 instead of a useful error.
 */

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
  'ALLOWED_DOMAIN',
  'APP_URL',
];

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Copy next-app/.env.example to next-app/.env.local and fill in values.`
    );
  }

  const secret = process.env.SESSION_SECRET;
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters long.');
  }

  const appUrl = process.env.APP_URL;
  try {
    new URL(appUrl);
  } catch {
    throw new Error(`APP_URL is not a valid URL: "${appUrl}"`);
  }
}

export function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Environment variable ${name} is not set.`);
  return val;
}

/**
 * Origin serving the Vite bundle that /instructor and /student iframe.
 *
 * The localhost default is dev-only on purpose. In production it pointed at the
 * end user's own machine, so the page returned 200, logged nothing, and showed a
 * blank iframe. Checked for truthiness rather than `??`, because an empty value
 * collapsed to a same-origin path that 404s inside the frame.
 *
 * Kept out of REQUIRED so a local checkout relying on the default does not get a
 * 500 from /api/auth/login.
 */
export function getViteOrigin() {
  const origin = process.env.VITE_APP_ORIGIN;
  if (origin) return origin;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:5173';
  throw new Error('Environment variable VITE_APP_ORIGIN is not set.');
}
