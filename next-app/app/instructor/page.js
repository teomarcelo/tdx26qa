import styles from './app.module.css';
import { requireEnv, getViteOrigin } from '../../lib/env.js';

/**
 * Instructor app page — served protected behind auth middleware.
 *
 * Phase 1 embeds the existing Vite-built instructor app in an iframe. Identity
 * is not passed through the URL: the Vite app authenticates with Firebase Auth
 * Google sign-in and ignores any name/email query params, so sending them would
 * only leak a verified corporate email into logs and browser history.
 * Phase 2 will inline the React components directly.
 */

// Nothing on this page reads the request anymore, so it would otherwise be
// prerendered and freeze APP_URL / VITE_APP_ORIGIN at build time. Resolve them
// per request instead, and keep the gated surface out of any shared cache.
export const dynamic = 'force-dynamic';

export default async function InstructorPage() {
  const viteOrigin = getViteOrigin();
  const appUrl = requireEnv('APP_URL');

  const params = new URLSearchParams();
  // Absolute gateway logout URL so the iframe can navigate the top window to a real
  // sign-out (destroys the session cookie, then redirects to /login).
  params.set('sso_logout', `${appUrl}/api/auth/logout`);
  const qs = params.toString();
  const src = `${viteOrigin}/instructor.html${qs ? `?${qs}` : ''}`;

  return (
    <div className={styles.wrapper}>
      <iframe
        src={src}
        className={styles.frame}
        title="Session Q&A — Instructor"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
