import styles from './app.module.css';
import { getViteOrigin } from '../../lib/env.js';

/**
 * Student app page — served protected behind auth middleware.
 *
 * Phase 1 embeds the existing Vite-built student app in an iframe.
 * This is the lowest-risk migration path: the existing app code is
 * unchanged; only the outer shell gains the auth gate.
 *
 * Phase 2 will inline the React components directly into this page.
 */
export default function StudentPage() {
  const viteOrigin = getViteOrigin();
  return (
    <div className={styles.wrapper}>
      {/* Query params are deliberately not forwarded: a ?code deep link is for
          the in-app instructor preview, not this public shell. */}
      <iframe
        src={`${viteOrigin}/student.html`}
        className={styles.frame}
        title="Session Q&A — Student"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
