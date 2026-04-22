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

In Firebase Console → Firestore → **Rules**, replace the entire editor contents with the rules below.

**Copy/paste checklist (fixes “Line 2: mismatched input `match`”):**

1. The file **must** start with `rules_version = '2';` on line 1.
2. Line **2** must be exactly `service cloud.firestore {` — do **not** start at `match /databases/...` or Firebase will reject the rules.
3. Do **not** paste the Markdown backticks (`` ``` ``) from this doc—only the rules text.
4. You can also open **`firestore.rules`** in this repo and copy everything from there (no Markdown).

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Instructors self-register — PIN is stored hashed (SHA-256), never plain text
    match /instructors/{instructorId} {
      allow read: if true;
      allow create: if true;
      allow update: if true;
      allow delete: if false;
    }

    // Sessions (instructor creates/updates class info) and questions
    match /sessions/{sessionId} {
      allow read: if true;
      allow create, update: if true;
      allow delete: if false;
      match /questions/{questionId} {
        allow read: if true;
        allow create: if true;
        // Updates keep authorId unchanged (votes, answers, status, student text edits).
        allow update: if resource.data.authorId == request.resource.data.authorId;
        // Instructors delete from the dashboard; without Firebase Auth this cannot be restricted to “only instructors”.
        allow delete: if true;
      }
    }
  }
}
```

> **Security:** These rules are for **trusted / internal** use (e.g. a workshop or team room). Anyone with your
> deployed `student.html` / `instructor.html` can call Firestore with your web API key, so a
> motivated user could delete questions or change data unless you add **Firebase Authentication**
> and tighten rules (e.g. only signed-in instructors may `delete` or update session docs).

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

Students can submit **subject** + **body** from the sidebar footer. The app writes an **anonymous** document under **`sessions/{sessionCode}/sessionFeedback`** (subject, body, client timestamp — no student email, no mail app). Instructors see the same stream in the sidebar **Student feedback** section when that session is selected. Deploy **`firestore.rules`** from this repo or writes return **permission denied**. Older data may still exist under the retired top-level **`dashboardFeedback`** collection; migrate manually if needed. To get messages in an inbox, use a scheduled export, BigQuery, or a small **Cloud Function** + email provider (not included in this static app).

### Question fields (status badges)

No rule change is required for this UI-only flag:

- **`answeredVerbally`** (optional boolean on each question document): set to **`true`** when the instructor clicks **Answered verbally**; cleared to **`false`** when they click **Mark pending** or when the last saved answer is removed and the question returns to **pending**. Saving a written answer does **not** clear it, so the board can show **both** “Answered verbally” and “Answered” when applicable. Existing sessions without this field still behave sensibly (verbal-only answered rows infer one verbal-style badge).

### Firebase Storage (paste screenshots)

Pasting an image into the **student question** box or an **instructor answer** box uploads a JPEG to Cloud Storage under `sessions/{sessionCode}/…`. You must enable **Storage** in the Firebase console (same project as Firestore), then add **Rules** similar to:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /sessions/{sessionId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.resource.size < 4 * 1024 * 1024
                    && request.resource.contentType.matches('image/.*');
    }
  }
}
```

Tighten these rules (auth, App Check, smaller size) before a fully public launch. If Storage is disabled or rules deny the write, paste will show an error toast and nothing is stored.

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

## Step 4: Host it (free options)

### Option A — Netlify (easiest, ~2 minutes)
1. Go to https://netlify.com → sign up free
2. Run **`npm run build`**, then drag and drop the **`dist/`** folder onto the Netlify dashboard (or connect the repo and set **Build command** `npm run build`, **Publish directory** `dist`).
3. You'll get URLs like:
   - `https://your-app.netlify.app/student.html` ← share with students
   - `https://your-app.netlify.app/instructor.html` ← instructors only

### Option B — GitHub Pages (GitHub Actions)

This repo ships **`.github/workflows/deploy-pages.yml`**, which builds with **Node 20** and deploys the **`dist/`** folder whenever you push to **`main`** (or run the workflow manually).

#### One-time GitHub setup

1. **Create the repo** on GitHub (empty is fine) and **push this project** (replace `YOUR-ORG` / `YOUR-REPO`):

   ```bash
   git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
   git push -u origin main
   ```

   If your default branch is **`master`**, either rename it to **`main`** in GitHub (**Settings → General → Default branch**) or edit **`.github/workflows/deploy-pages.yml`** so `branches: [main]` matches your branch name.

2. **Firebase at build time:** `npm run build` reads **`src/config/firebase.js`** (or **`VITE_FIREBASE_*`** env vars). For a public repo, prefer **GitHub Actions secrets**: repo **Settings → Secrets and variables → Actions → New repository secret** for each of `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, then add an `env:` block to the **`npm run build`** step in the workflow file mapping `secrets.VITE_FIREBASE_API_KEY` → `VITE_FIREBASE_API_KEY`, etc. If you skip secrets, the committed config in **`firebase.js`** is what the Action build uses.

3. **Turn on GitHub Pages from Actions:** Repo **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions** (not “Deploy from a branch”). Save if prompted.

   **Critical:** If **Source** is set to **Deploy from a branch** (e.g. **`main`** / **`/` (root)**), GitHub publishes the **raw repo files** — `student.html` still contains `/src/student/main.js`, which does **not** exist on Pages, so **no CSS and no app JS** (the join screen looks like plain HTML). Only **GitHub Actions** as the source publishes the **`npm run build`** output from **`dist/`**, where links look like **`./assets/…`**.

4. **First deploy:** Push to **`main`** (or **Actions → Deploy to GitHub Pages → Run workflow**). Open the workflow run; when it is green, **Settings → Pages** will show the **site URL** (often `https://<user>.github.io/<repo>/`).

5. **Optional first-time prompt:** If GitHub asks you to **configure** the **`github-pages`** environment, approve it (**Settings → Environments → github-pages**).

#### URLs to bookmark after deploy

- Hub: `https://<user>.github.io/<repo>/` (opens **`index.html`**)
- Students: `https://<user>.github.io/<repo>/student.html`
- Instructors: `https://<user>.github.io/<repo>/instructor.html`

**Storage CORS:** Add your real **`https://<user>.github.io`** origin to **`storage-cors.json`** and run **`gsutil cors set …`** (see **Storage CORS** above), or image uploads may fail from the deployed site.

#### Troubleshooting: student page has no styling (unstyled join form)

1. In the browser, open **View Page Source** (not DevTools Elements) for **`student.html`**.
2. If you see **`src="/src/student/main.js"`** (or **`/src/`** anywhere), the live site is **not** the Vite build. Go back to **Settings → Pages** and set **Source** to **GitHub Actions** only; disable **Deploy from a branch** if it is selected.
3. Open **Actions** → **Deploy to GitHub Pages** — the latest run must be **green**. If it never ran, push a commit or use **Run workflow**.
4. After the deploy finishes, do a **hard refresh** (e.g. **Cmd+Shift+R** / **Ctrl+Shift+R**) so the browser does not keep an old HTML cache.

When it is correct, View Source will show **`<link rel="stylesheet" … href="./assets/student-….css">`** and **`<script type="module" … src="./assets/student-….js">`**.

#### Manual alternative (no Actions)

From your machine: **`npm run build`**, then upload the contents of **`dist/`** to any static host (or push **`dist`** to a **`gh-pages`** branch with only that folder’s contents at root). The Actions workflow avoids committing **`dist/`**.

---

## How to run a session

1. Open **`instructor.html`** (from `npm run dev` during development, or from **`dist/instructor.html`** after `npm run build` when hosted)
2. First time: click **Create an account** → enter your name and choose a PIN
3. Return visits: sign in with your name and PIN
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

Each instructor creates their own account directly on `instructor.html` — no admin needed.

- Name + PIN (min 4 characters)
- PIN is stored as a SHA-256 hash in Firestore — never plain text
- Multiple instructors can have separate accounts independently
- Name is the unique identifier — "Alex Rivera" and "alex rivera" are the same account
- **`instructors/{id}`** may include **`joinedSessions`** (codes you joined) and **`sessionsHiddenFromList`** (codes hidden from *your* “My sessions” list only — no session document is deleted). **Join** the same code again to remove it from the hidden list and see it again.

---

## Future: Salesforce OAuth (optional upgrade)

To restrict instructor access to @salesforce.com accounts only:

1. In Salesforce Setup → **App Manager** → New Connected App
2. Enable OAuth, set callback URL to your hosted instructor page
3. Add scopes: `openid`, `profile`, `email`
4. In Firebase Console → Authentication → Add provider → SAML / OpenID Connect
5. In `instructor.html`, replace the PIN check with:
   ```js
   if (!user.email.endsWith('@salesforce.com')) { signOut(); }
   ```

This is approximately a 1-hour upgrade once the Connected App is configured in your Salesforce org.

---

## Session code format
New codes use the `SQA-` prefix plus four alphanumeric characters (`SQA-XXXX`). Older sessions created before a rename may still use the previous `TDX-` prefix; both work when joining.
Ambiguous characters like 0/O and 1/I are excluded to avoid confusion.
Students enter them on the join screen — input is automatically uppercased.
