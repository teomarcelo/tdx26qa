# Session Q&A App — Setup Guide

## What you got
- `student.html` / `instructor.html` — Page shells (**Fuse** from CDN; **Firebase** is bundled from `src/lib/firebaseCompat.js` with Vite; app logic in `src/`)
- `src/` — Bundled app logic, styles, and default Firebase config (`src/config/firebase.js`)

**Rich text (no extra Firebase setup):** Session sidebar (“Important”) note, questions, and answers support **Slack-style** markers in plain text (`*bold*`, `` `code` ``, fenced blocks, `https://` links). The app renders them in the browser; stored values are still normal strings on the session or question documents. **Copy** controls on rendered code and the **⋯** emoji grid are UI-only (no extra fields).

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

### Session sidebar note (“Important” for students)

Optional fields on the same `sessions/{code}` document:

- `sessionNoteShow` (boolean — default visible if omitted)
- `sessionNoteTitle` (string)
- `sessionNoteBody` (string — Slack-style formatting; rendered client-side)
- `sessionNoteImageUrls` (array of `https://` image URLs, one per line in the UI)

### Question pagination

Questions are loaded with `orderBy('createdAt', 'desc')` and a page size of **25**. If Firebase asks you to create an **index** the first time you run a session with questions, follow the link in the error dialog and create it.

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

1. Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) so you have `gsutil`.
2. In Firebase Console → **Project settings** → note your **Storage bucket** (e.g. `tdx-qa.firebasestorage.app` or `your-project.appspot.com`).
3. Edit **`storage-cors.json`** in this repo: add your dev URLs (with the correct **port**) and your production site URL (e.g. `https://your-app.netlify.app`).
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

### Option B — GitHub Pages
1. Build locally with **`npm run build`**, then publish the **`dist/`** contents (e.g. push `dist` output to `gh-pages` branch, or use a GitHub Action that runs `npm ci && npm run build` and uploads `dist/`).
2. Your URLs: `https://username.github.io/repo-name/student.html` (adjust if you use a custom Pages URL).

---

## How to run a session

1. Open **`instructor.html`** (from `npm run dev` during development, or from **`dist/instructor.html`** after `npm run build` when hosted)
2. First time: click **Create an account** → enter your name and choose a PIN
3. Return visits: sign in with your name and PIN
4. Click **+ New session** — a unique code like `SQA-A7K2` is generated automatically
5. Fill in session details (name, room, date/time, description) → **Save session info**
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
