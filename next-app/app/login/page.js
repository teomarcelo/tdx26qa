import styles from './login.module.css';

const ERROR_MESSAGES = {
  missing_params:        'Invalid login attempt. Please try again.',
  invalid_state:         'Security check failed. Please try again.',
  session_expired:       'Login session expired. Please try again.',
  token_exchange_failed: 'Could not complete sign-in. Please try again.',
  invalid_token:         'Sign-in verification failed. Please try again.',
  access_denied_domain:  'Only @salesforce.com accounts can access this app.',
  access_denied:         'Access denied.',
  session_write_failed:  'Could not start your session. Please try again.',
};

const FALLBACK_ERROR = 'Sign-in failed. Please try again.';

// searchParams is a Promise in Next 16; reading it without awaiting made every
// error message silently undefined.
export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const errorKey = sp?.error;
  const loggedOut = sp?.logged_out === '1';
  // The callback can put a raw Google error_description in ?error=, so only ever
  // render a message this map owns. hasOwn also keeps inherited keys
  // (?error=toString) from resolving to something non-renderable.
  const errorMsg = errorKey
    ? (Object.hasOwn(ERROR_MESSAGES, errorKey) ? ERROR_MESSAGES[errorKey] : FALLBACK_ERROR)
    : null;

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <rect width="36" height="36" rx="10" fill="#0070d2" />
            <path d="M10 22l6-8 4 5 3-3 3 4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className={styles.title}>Session Q&amp;A</h1>
        <p className={styles.subtitle}>Salesforce training workshops</p>

        {loggedOut && (
          <div className={styles.notice}>You have been signed out.</div>
        )}
        {errorMsg && (
          <div className={styles.error} role="alert">{errorMsg}</div>
        )}

        <a href="/api/auth/login" className={styles.signInButton}>
          <GoogleIcon />
          Sign in with Google
        </a>

        <p className={styles.restriction}>
          Access restricted to <strong>@{process.env.NEXT_PUBLIC_ALLOWED_DOMAIN || 'salesforce.com'}</strong> accounts.
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}
