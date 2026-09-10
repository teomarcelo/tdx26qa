# Session Q&A — Auth Gateway (Next.js on Vercel)

This Next.js app is the **authentication gateway** in front of the existing Vite
Session Q&A app. It restricts the **instructor** experience to `@salesforce.com`
Google Workspace accounts using server-side OAuth (Authorization Code flow),
`iron-session` httpOnly cookies, and JWKS id_token validation.

Because Salesforce staff sign in with Google Workspace, "Google OAuth restricted
to `salesforce.com`" is effectively Salesforce SSO.

## What is gated vs public

- `/instructor` → **protected** (requires an `@salesforce.com` session).
- `/`, `/student`, `/login`, `/api/auth/*`, static assets → **public** (students
  are external customers and must never be forced to log in). See
  [`proxy.js`](proxy.js).

## Runbook

### 1. Create the Google OAuth credentials  (todo: oauth_creds)

1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → OAuth consent screen**: Internal (if this GCP project is
   inside the salesforce.com Workspace org) or External; add the app name.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type: **Web application**.
4. **Authorized redirect URIs** — add both:
   - `http://localhost:3000/api/auth/callback`
   - `https://<your-vercel-domain>/api/auth/callback`
5. Copy the **Client ID** and **Client secret**.

### 2. Fill environment variables  (todo: oauth_creds)

Copy the template and fill real values:

```bash
cd next-app
cp .env.example .env.local   # if you don't already have .env.local
```

Required (`.env.local` for local dev; Vercel Project → Settings → Environment
Variables for prod):

| Var | Value |
|-----|-------|
| `GOOGLE_CLIENT_ID` | from step 1 |
| `GOOGLE_CLIENT_SECRET` | from step 1 |
| `SESSION_SECRET` | 32+ random chars — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ALLOWED_DOMAIN` | `salesforce.com` |
| `NEXT_PUBLIC_ALLOWED_DOMAIN` | `salesforce.com` |
| `APP_URL` | `http://localhost:3000` locally / `https://<your-vercel-domain>` in prod |
| `VITE_APP_ORIGIN` | origin serving the Vite app (see step 3) |

`.env.local` is gitignored — never commit real secrets.

### 3. Decide production serving of the Vite app  (todo: prod_serving)

Phase 1 embeds the Vite app in an iframe at `VITE_APP_ORIGIN`
([`app/instructor/page.js`](app/instructor/page.js),
[`app/student/page.js`](app/student/page.js)).

> [!WARNING]
> **The instructor Vite bundle must NOT be served from a public origin
> (e.g. GitHub Pages).** If it is, anyone who knows that public URL can open the
> instructor app directly and bypass this OAuth gate entirely. The OAuth gate
> only protects pages served *through* this Next.js app.

Recommended options, most secure first:

1. **Inline the instructor React app into Next.js (Phase 2).** Move the Vite
   instructor components into `app/instructor/` so they render same-origin behind
   the proxy. Best security; most work.
2. **Serve the built instructor bundle from behind Next.js.** Copy the Vite
   `dist/` instructor assets into this app and serve them under the protected
   `/instructor` route so `proxy.js` gates them. Medium work.
3. **Student bundle only on a public origin.** The student app is public anyway,
   so it can stay on GitHub Pages / any static host. Point `VITE_APP_ORIGIN` at it
   for `/student`, but do **not** rely on that origin for `/instructor`.

The Vite instructor app no longer uses a PIN. It authenticates with Firebase Auth
Google sign-in and enforces access through `firestore.rules` (`ownerEmail` /
`instructorEmails`), so that is the real instructor check. This OAuth layer is the
org-restriction gate in front of it: it keeps the instructor surface reachable only
by `@salesforce.com` accounts. Until Phase 2 lands, both checks are independent.

### 4. Local dev

```bash
# terminal 1 — Vite app (repo root)
npm run dev            # http://localhost:5173

# terminal 2 — Next.js gateway (this folder)
cd next-app
npm install            # first time
npm run dev            # http://localhost:3000
```

Visit <http://localhost:3000/instructor> → you should be redirected to `/login`.
Visit <http://localhost:3000/student> → should load with no login.

### 5. Deploy to Vercel + verify  (todo: deploy_verify)

> Deploy only when you explicitly decide to — this app is production-adjacent.

1. Vercel → New Project → import this repo → set **Root Directory** to `next-app`.
2. Add all env vars from step 2 (use the Vercel domain for `APP_URL`, and the
   chosen `VITE_APP_ORIGIN`).
3. Add the prod `…/api/auth/callback` URL to the Google OAuth client (step 1.4).
4. Deploy.

**Verification checklist:**

- [ ] `@salesforce.com` Google account signs in and reaches `/instructor`.
- [ ] A non-salesforce Google account is rejected with "Only @salesforce.com
      accounts can access this app."
- [ ] Visiting `/student` (and `/`) works with **no** login prompt.
- [ ] `Sign out` (`/api/auth/logout`) clears the session and returns to `/login`.
- [ ] The instructor Vite bundle is **not** reachable via a public URL that
      skips this gate (see step 3 warning).
