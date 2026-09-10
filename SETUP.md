# Session Q&A App — Setup Guide

## What you got
- `student.html` / `instructor.html` — Page shells (**Fuse** from CDN; **Firebase** is bundled from `src/lib/firebaseCompat.js` with Vite; app logic in `src/`)
- `src/` — Bundled app logic, styles, and default Firebase config (`src/config/firebase.js`)

**Rich text (no extra Firebase setup):** Session **Instructor Notes** (student board: toggle on the filter row), questions, and answers support **Slack-style** markers in plain text (`*bold*`, `` `code` ``, fenced blocks, `https://` links). The app renders them in the browser; stored values are still normal strings on the session or question documents. **Copy** controls on rendered code and the **⋯** emoji grid are UI-only (no extra fields).

---

## Step 1: Firebase Setup (~15 minutes, free)

1. Go to https://console.firebase.google.com
2. Click **Add project** → pick a project id (the sample defaults in **`src/config/firebase.js`** use **`tdx-qa`**, or create any project and edit that file or set **`VITE_FIREBASE_*`** env vars before `npm run build`) → Create
3. Go to **Firestore Database** → Create database → Start in **test mode** → Choose a region → Done
4. Go to **Project Settings** (gear icon) → **Your apps** → click `</>` (Web)
5. Register the app (e.g. name: "Session Q&A"), skip Firebase Hosting
6. Copy the config object — it looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "tdx-qa.firebaseapp.com",
     projectId: "tdx-qa",
   };
   ```
7. Paste those values into **`src/config/firebase.js`** in the exported **`FIREBASE_CONFIG`** object (same shape as the Firebase snippet). For CI or one-off builds you can instead export **`VITE_FIREBASE_API_KEY`**, **`VITE_FIREBASE_AUTH_DOMAIN`**, **`VITE_FIREBASE_PROJECT_ID`**, **`VITE_FIREBASE_STORAGE_BUCKET`**, **`VITE_FIREBASE_MESSAGING_SENDER_ID`**, and **`VITE_FIREBASE_APP_ID`** before running **`npm run build`**.

---

## Step 2: Firestore Security Rules

**[`firestore.rules`](firestore.rules) in this repo is the only source of truth.** Do not hand-write rules for this app and do not copy a ruleset out of this guide — the real file is 631 lines (`wc -l firestore.rules`) and it is what the automated test suite is written against. Anything shorter that you paste into the console is a downgrade.

The rules require Firebase Auth: instructor writes need a **verified `@salesforce.com`** email, student edits are bound to the author's uid, and question moderation is scoped to instructors *of that session*. They are the app's only authorization layer, because App Check is registered but **not enforced** (see `CLAUDE.md`).

Pick one of these two ways to install them.

**Option A — deploy from the repo (preferred).** Nothing to copy, so nothing can go stale:

```bash
npx firebase-tools deploy --only firestore:rules --project <your-project-id>
```

The project id comes from `.firebaserc` or your own Firebase project. For this repo's production project that flag is `--project tdx-qa`, and the same command form appears in `.claude/skills/deploy-and-verify.md`.

**Option B — paste into the console.** Open **`firestore.rules`** in this repo, select the whole file, and paste it over the entire contents of Firebase Console → Firestore → **Rules**. Two things to watch:

1. Copy from the **file**, never from rendered Markdown — you would carry in backticks that Firebase rejects.
2. Paste the file *whole*, starting at `rules_version = '2';` on line 1. A partial paste that begins at `match /databases/...` fails with “Line 2: mismatched input `match`”.

Verify before you deploy. The rules have an emulator-backed test suite; run it against the throwaway `demo-session-qa` project, never against production:

```bash
npm run test:rules
```

> **Editing `firestore.rules` locally does nothing to production.** The file is inert until someone runs the deploy command above. A code-only deploy ships the app with the *old* rules still live.

### Instructor notes for students (Instructor Notes in the sidebar editor)

Optional fields on the same `sessions/{code}` document:

- `sessionNoteShow` (boolean — when `false`, **Instructor Notes** are hidden on the student board)
- `sessionNotes` (array, max **15** — preferred): each item `{ id, order, title, body, imageUrls[], links[], show }`. Order is the display order; `show: false` hides that card only. Title, body, image URLs, and **named links** (`links[]`) are stored per note for instructors; **students** see title, body, and images only (not the named link list). Each link is `{ url, label? }` with `https://` URLs only (max **12** links per note). Slack-style body text is rendered client-side; `imageUrls` must be `https://` only.

Legacy single-note fields (still read if `sessionNotes` is missing or empty):

- `sessionNoteTitle`, `sessionNoteBody`, `sessionNoteImageUrls` (same semantics as one note)

### OrgClaim & Survey buttons (student Session card)

Optional fields on `sessions/{code}` (set from **Instructor → Session settings**):

- **`studentOrgClaimUrl`** — **`http://…`** or **`https://…`**. New sessions (and saves with an empty link field) store **`http://sfdc.co/OrgClaim`** by default.
- **`studentOrgClaimCopyText`** — **OrgClaim code** (single-line plain text). If empty after save, the student Session card still shows **OrgClaim** with **OrgClaim Code:** and a blank value (nothing is inferred from the Survey ID).
- **`studentSurveyUrl`** — must be **`https://…`** if you want **SURVEY** to appear.
- **`studentSurveyCopyText`** — **Survey ID** (single-line plain text). Shown under **SURVEY** and copied on click.

The student **Session** sidebar always shows **OrgClaim** (above **SURVEY**); the OrgClaim URL defaults when unset. **SURVEY** appears only when the survey URL is **`https:`** and Survey ID is non-empty. Older sessions may still contain **`studentSurveyButtonLabel`** in Firestore; the app ignores it and the next **Save session info** removes that field.

### Question pagination

Questions are loaded with `orderBy('createdAt', 'desc')` and a page size of **10** (`QUESTIONS_PAGE_SIZE` in `src/constants/app.js`). If Firebase asks you to create an **index** the first time you run a session with questions, follow the link in the error dialog and create it.

### Student dashboard feedback

Students can submit **subject** + **body** from the sidebar footer. The app writes an **anonymous** document under **`sessions/{sessionCode}/sessionFeedback`** (subject, body, client timestamp — no student email, no mail app). Instructors see the same stream in the sidebar **Dashboard feedback** section (after Instructor notes) when that session is selected. Deploy **`firestore.rules`** from this repo or writes return **permission denied**. Older data may still exist under the retired top-level **`dashboardFeedback`** collection; migrate manually if needed. To get messages in an inbox, use a scheduled export, BigQuery, or a small **Cloud Function** + email provider (not included in this static app).

### Question fields (status badges)

No rule change is required for this UI-only flag:

- **`answeredVerbally`** (optional boolean on each question document): set to **`true`** when the instructor clicks **Answered verbally**; cleared to **`false`** when they click **Mark pending** or when the last saved answer is removed and the question returns to **pending**. Saving a written answer does **not** clear it, so the board can show **both** “Answered verbally” and “Answered” when applicable. Existing sessions without this field still behave sensibly (verbal-only answered rows infer one verbal-style badge).

### Firebase Storage (paste screenshots)

Pasting an image into the **student question** box or an **instructor answer** box uploads a JPEG to Cloud Storage. You must enable **Storage** in the Firebase console (same project as Firestore).

Actual upload paths, per [`storage.rules`](storage.rules):

- `sessions/{code}/question_paste/` for student question pastes (any signed-in identity)
- `sessions/{code}/answer_paste/` for instructor answer pastes (verified `@salesforce.com` only)
- `sessions/{code}/images/` for instructor session-note images (verified `@salesforce.com` only)

**[`storage.rules`](storage.rules) in this repo is the only source of truth for Storage**, exactly as `firestore.rules` is for Firestore. Do not paste a ruleset out of this guide. The real file requires an authenticated identity, caps uploads at **8 MB**, and requires `contentType == 'image/jpeg'` exactly.

Install it the same two ways:

```bash
npx firebase-tools deploy --only storage --project <your-project-id>
```

Or open **`storage.rules`** and paste the whole file over Firebase Console → Storage → **Rules**, starting at `rules_version = '2';` on line 1.

`npm run test:rules` covers this file too (`test/storage.rules.test.mjs`) alongside the Firestore suite. As with Firestore, **editing `storage.rules` locally changes nothing until it is deployed.**

If Storage is disabled or the rules deny the write, paste shows an error toast and nothing is stored.

### Storage CORS (fixes localhost / browser upload errors)

Browsers enforce **CORS** on your Firebase Storage bucket. If the console shows errors when **uploading** or **fetching** images from `http://127.0.0.1:…` or `http://localhost:…`, apply a CORS policy to the bucket.

1. Install the **Google Cloud SDK** so you have **`gsutil`** (it is not part of Node or Firebase CLI alone).

   **macOS (Homebrew)** — in Terminal:

   ```bash
   brew install --cask google-cloud-sdk
   ```

   Then start a **new** terminal tab, or load the SDK into your shell (path may differ slightly by Homebrew version):

   ```bash
   source "$(brew --prefix)/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/path.zsh.inc"
   ```

   If that file is missing, run the **`install.sh`** the `brew` output mentions, or follow the “Next steps” printed after the cask install.

   Confirm: `gsutil version`. First time, run `gcloud auth login` and pick the Google account that owns the Firebase project.

   **No local install?** Open [Google Cloud Shell](https://shell.cloud.google.com/) in the browser (has `gsutil` already). Upload **`storage-cors.json`** there (or paste it with the editor), `cd` to that folder, and run the `gsutil cors set …` command below. Use the same bucket name as in Firebase.

   Other platforms: [Cloud SDK install](https://cloud.google.com/sdk/docs/install).

2. In Firebase Console → **Project settings** → note your **Storage bucket** (e.g. `tdx-qa.firebasestorage.app` or `your-project.appspot.com`).
3. Edit **`storage-cors.json`** in this repo: it includes **Vite** dev defaults (`http://localhost:5173`, `http://127.0.0.1:5173`) and **`vite preview`** (`:4173`). Add any other dev ports you use and your **production** origin (e.g. `https://your-app.netlify.app`) — Storage CORS is **exact-origin** (scheme + host + port).
4. Run (replace `YOUR_BUCKET` with the bucket name from step 2):

```bash
gsutil cors set storage-cors.json gs://YOUR_BUCKET
```

5. Wait a minute and hard-refresh the app. Re-try paste / image question.

Without this step, uploads or `fetch()` to re-host images can fail even when Storage **rules** allow writes.

---

## Step 3: Production build (Vite)

The repo is a **Vite** multi-page app: page shells are `student.html` / `instructor.html`; logic lives in `src/` and is bundled into **`dist/`**.

1. Install Node.js 18+ (LTS recommended).
2. From the project root: `npm install`
3. Run **`npm run build`**. Output goes to **`dist/`** (`student.html`, `instructor.html`, and `./assets/…` JS/CSS). That folder is what you host (it is gitignored by default).
4. Optional: override Firebase values at build time with env vars `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` (see `src/config/firebase.js`).

Local development: **`npm run dev`** then open **`http://localhost:5173/`** (small link hub) or go directly to **`/student.html`** and **`/instructor.html`** — the Q&amp;A UI is not mounted on the bare `/` path by itself.

---

## Step 4: Host it

### Option A — Firebase Hosting (what this repo actually does)

Production is Firebase Hosting, published **by hand** with the Firebase CLI. There is no CI deploy: pushing to `main` deploys nothing. The full sequence, including building from a clean checkout rather than the working tree, is in **`.claude/skills/deploy-and-verify.md`**. The core command:

```bash
npx firebase-tools deploy --only hosting:app --project <your-project-id>
```

`firebase.json` defines two hosting targets: **`app`** (serves `dist/`) and **`legacy`** (redirect-only). Hosting and rules deploy **separately** — `--only hosting:app` does not ship `firestore.rules` or `storage.rules`. See Step 2 for those.

### Option B — Netlify or any static host

1. Run **`npm run build`**.
2. Upload the contents of **`dist/`**, or connect the repo with **Build command** `npm run build` and **Publish directory** `dist`.
3. You get URLs like `https://your-app.netlify.app/student.html` (students) and `/instructor.html` (instructors).

Whatever host you pick, add its exact origin to **`storage-cors.json`** and run `gsutil cors set …` (see **Storage CORS** above), or image uploads fail from the deployed site. Also add the domain under Firebase **Authentication → Settings → Authorized domains**, or sign-in fails.

### GitHub Pages — retired

Earlier revisions of this guide walked through a **`.github/workflows/deploy-pages.yml`** Actions deploy. **That workflow no longer exists in this repo** (`.github/` is absent, and `git ls-files .github` returns nothing), and `https://teomarcelo.github.io/session-qa/` returns 404. Do not follow Pages instructions for this project; use Option A.

One piece of that troubleshooting is still worth keeping, because it applies to any static host: if the deployed **`student.html`** has no CSS and the join form looks like plain HTML, open **View Page Source**. Seeing `src="/src/student/main.js"` means the host is serving the **raw repo files**, not the Vite build — publish **`dist/`** instead. A correct deploy shows `href="./assets/student-….css"` and `src="./assets/student-….js"`. Then hard-refresh (**Cmd+Shift+R** / **Ctrl+Shift+R**) so the browser drops the old HTML.

---

## How to run a session

1. Open **`instructor.html`** (from `npm run dev` during development, or from **`dist/instructor.html`** after `npm run build` when hosted)
2. Click **Continue with Google** and pick your `@salesforce.com` account. Optionally type the name students should see first — there is no account to create and no PIN (see **Instructor accounts** below)
3. Return visits: the same button, and Google usually keeps you signed in
4. Click **+ New session** — the modal matches **Session settings** (session name, date/time, room, description, OrgClaim, survey link/ID). A code like `SQA-A7K2` is generated when you **Create session**; those values load into **Session settings** in the sidebar automatically.
5. You can still change anything later in **Session settings** → **Save session info**
6. Share the session code with students — they go to `student.html` and enter the code
7. Students ask questions, upvote, and see your answers update in real time

### Demo mode
Not ready to connect Firebase yet? Click **Try the demo** on the login screen.
Demo mode loads 5 sample Agentforce questions and lets you try every instructor action
(answer, pin, delete, filter) without touching the database. Use **Reset demo** to
restore the original questions at any time.

---

## Firebase free tier — will it be enough?

**Short answer: yes, easily.**

Firebase's free Spark plan gives you:
- 1 GB storage
- 50,000 reads / day
- 20,000 writes / day

A busy event day with 10 sessions and 300 questions uses roughly **1,400 writes** —
about 7% of the daily free limit. Storage for thousands of questions is well under 10 MB.

**The one thing to watch:** Each connected student counts as a read every time any question
is updated. With 300 students connected at once, a busy session could approach the 50k
read limit. If you see a quota warning in the Firebase console, upgrade to the **Blaze
(pay-as-you-go) plan** — 100,000 reads costs $0.06, so a full day of heavy use would still run under about $1.

---

## Instructor accounts

There are no app-managed accounts, no registration step, and no PIN. Instructors sign in with **Google**, and identity comes from the verified email on that Google account.

- **Sign-in:** one **Continue with Google** button on `instructor.html` (`src/instructor/components/LoginScreen.jsx`). The popup is hinted to the `salesforce.com` workspace via the `hd` parameter (`src/lib/auth.js`).
- **The hint is not the enforcement.** [`firestore.rules`](firestore.rules) is what actually restricts access: its `isSalesforce()` helper requires `email_verified == true` **and** an email matching `^[^@]+@salesforce[.]com$`. A Google account on any other domain can sign in and read, but every instructor write is denied.
- **Optional display name.** The name field on the sign-in screen only sets the name students see; it is not a credential and it is not how you are identified. You can change it later.
- **Session access is by email, not by name.** Creating a session stores `ownerEmail` and seeds `instructorEmails`; joining with a code appends the joiner's verified email. Those two fields on `sessions/{code}` are what the rules check.
- **Owner vs co-instructor are different powers.** Any verified `@salesforce.com` user can self-join a session as a co-instructor, so co-instructor membership is a self-service claim. Deleting a session and rewriting its ownership fields are owner-only.
- **`instructors/{id}`** may include **`joinedSessions`** (codes you joined) and **`sessionsHiddenFromList`** (codes hidden from *your* “My sessions” list only — no session document is deleted). **Join** the same code again to remove it from the hidden list and see it again. The doc id is derived from your email, so `alex.rivera@` and `alexrivera@` resolve to the same account doc.
- **Demo mode** needs no sign-in at all and touches no database.

---

## Console setup this depends on

Restricting instructor access to `@salesforce.com` is **not** a future upgrade — it shipped, and it is described under **Instructor accounts** above. What is still required is Firebase Console configuration, which no amount of local code can supply:

1. **Authentication → Sign-in method:** enable **Google** (instructors) and **Anonymous** (students get a silent identity that the rules bind their writes to). Until Google is enabled the sign-in button returns a "not enabled" error; demo mode still works.
2. **Authentication → Settings → Authorized domains:** add your production domain, plus `localhost` for local testing.
3. **App Check:** register the web app with **reCAPTCHA v3**. Note that App Check is currently registered but **UNENFORCED**, so it protects nothing yet — see the App Check section of `CLAUDE.md` before changing that, and never flip enforcement on during an event.
4. **Storage:** enable it in the same project (see **Firebase Storage** above), and deploy `storage.rules`.

`next-app/` in this repo holds a separate Next.js OAuth gateway. It has **never been deployed** and is not part of the sign-in path described above.

---

## Session code format
New codes use the `SQA-` prefix plus four alphanumeric characters (`SQA-XXXX`). Older sessions created before a rename may still use the previous `TDX-` prefix; both work when joining.
Ambiguous characters like 0/O and 1/I are excluded to avoid confusion.
Students enter them on the join screen — input is automatically uppercased.
