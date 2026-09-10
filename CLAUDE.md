# Session Q&A — Claude Code Context

You are working on Session Q&A, a live Q&A tool built for Salesforce training
workshops and events. Instructors create a session with a short code; students
join in the browser, post questions, and upvote. Used in production at TDX26
and ongoing Salesforce training sessions.

## ⚠️ Production rules — read before doing anything
- This app is in ACTIVE production use for live Salesforce workshops.
- NEVER push to GitHub or deploy without Teo explicitly saying "push" or "deploy."
- Build and test locally only until instructed otherwise.
- Do not modify firestore.rules or storage-cors.json without confirming first.
- firestore.rules changes are NOT live until reviewed and deployed with
  `firebase deploy --only firestore:rules`. Editing the file locally never
  affects production on its own.
- Do not migrate Firebase compat SDK to modular — keep existing SDK as-is.
- Always run `npm run dev` to test — never assume changes work without verifying locally.

## What this app is
Two-page static app deployed on Firebase Hosting at **https://session-qa.web.app**:
- **student.html** — students join with a session code, post questions, upvote
- **instructor.html** — instructors create/manage sessions, answer questions,
  pin, filter, view stats, add instructor notes, receive session feedback
- **index.html** — dev/prod hub linking to both pages

Used for live Salesforce training events including TDX26. Co-instructors can
join the same session. Scales to large event audiences.

## Tech stack
- **Bundler:** Vite (multi-page: index + student + instructor)
- **Database:** Firebase Firestore (compat SDK via firebaseCompat.js)
- **File storage:** Firebase Storage (compat SDK — image paste is shipped)
- **Search:** Fuse.js (fuzzy search on questions)
- **Hosting:** Firebase Hosting, deployed **manually** with the Firebase CLI.
  Project id is `tdx-qa`; `session-qa` is a Hosting *site* inside it. Pushing to
  `main` deploys nothing. `tdx-qa.web.app` 301-redirects to `session-qa.web.app`.
- **Auth:** Firebase Auth. Instructors sign in with Google and writes require a
  verified `@salesforce.com` address; students get a silent anonymous identity.
  App Check (reCAPTCHA v3) is initialised but **not enforced**.
- **Language:** React (`.jsx`) on Vite, ES modules under `src/`, HTML, CSS

## Project structure
```
session-qa/
├── index.html                  ← hub page
├── student.html                ← student entry shell
├── instructor.html             ← instructor entry shell
├── src/
│   ├── config/
│   │   └── firebase.js         ← Firebase config (env var overrides)
│   ├── constants/              ← shared constants
│   ├── lib/
│   │   └── firebaseCompat.js   ← Firebase Firestore + Storage init
│   ├── styles/                 ← all CSS
│   ├── student/                ← student app logic + entry bundle
│   └── instructor/             ← instructor app logic + entry bundle
├── next-app/                   ← Next.js OAuth gateway, NEVER DEPLOYED (see below)
├── scripts/                    ← build/deploy scripts
├── redirect-site/              ← tiny public dir for the tdx-qa.web.app redirect
├── firestore.rules             ← Firestore security rules (do not modify without asking)
├── storage.rules               ← Firebase Storage security rules
├── storage-cors.json           ← Firebase Storage CORS config (do not modify without asking)
├── firebase.json               ← multi-site hosting (app + legacy targets), rules, emulators
├── vite.config.js              ← multi-page Vite build config
└── package.json
```

### `next-app/` (Next.js 16 OAuth gateway)
Tracked in git (26 files, per `git ls-files next-app`) and live-coupled to the
shipped Vite app: its `/instructor` page sets an `sso_logout` query parameter
that the Vite dashboard reads (`next-app/app/instructor/page.js:26`,
`src/instructor/components/Dashboard.jsx:586`). Facts to know before touching it:

- It has **never been deployed.** There is no `.vercel/` directory, the
  verification checklist in `next-app/README.md` is entirely unchecked (0 of 5
  boxes), and only two commits have ever touched the directory.
- It is excluded from the root eslint config (`'next-app/**'` sits in the
  `ignores` block of `eslint.config.js`) and from every root `package.json`
  gate. Nothing in the root `npm test` looks at it.
- It is verified separately, from inside `next-app/`. Its Next 16 async-API
  breakage has been fixed, and its own `npm run lint` and `npm run build` pass
  there. (Reported by the audit and consistent with the `next-app/.next/` build
  output present locally; not re-run when this note was written.)

## Current build state
MVP is complete and production-stable. All features below are shipped and working:
- Session creation, join, and code system (SQA- prefix)
- Live question feed on the student side: page 0 is an `onSnapshot` listener.
  The ~10s `setInterval` polling was removed (`grep -rn "STUDENT_POLL_MS" src/`
  returns nothing; the listener is at `src/student/hooks/useQuestions.js:245`)
- Real-time listener on newest page for instructors
- Pagination (10 questions per page) + Load older
- Upvoting, pinning, answering, marking pending, deleting
- Slack-style rich text formatting (bold, italic, code, fenced blocks, links)
- Format toolbars on ask box and answer box
- Instructor notes (optional, shown to students as separate feed)
- Session feedback (anonymous, stored in Firestore)
- Session stats (total, answered, pending, pinned)
- Multi-session management (create, join, hide)
- Co-instructor support
- Demo mode (no Firebase required)
- Student view toggle for instructors
- Resizable sidebar with collapse/expand
- Image paste for questions and answers, uploaded to Firebase Storage
- Firebase Auth: Google sign-in for instructors, anonymous identities for students
- React rewrite of both the student and instructor apps

## Known gaps / next up

### 1. App Check is registered but UNENFORCED (top remaining item)
Unenforced on Firestore, Storage and Identity Toolkit. The client mints
reCAPTCHA v3 tokens and the backend ignores them, so App Check currently
protects nothing. This is now the single highest-leverage security control
left: the rules rewrite tightened *authorization*, but anonymous write abuse is
still bounded only by Firestore's own limits, and rules cannot tell 500 scripted
anonymous identities from 500 real attendees.

Enable enforcement only after the App Check console shows real workshop traffic
minting valid tokens. Turning it on early rejects every client write instantly:
the failure mode is total, not degraded. Never flip it on event day.

### 2. First paint ships one large shared chunk
Measured against `dist/` from a local `npm run build` (`gzip -9`, 2026-08-17,
working tree including the uncommitted audit fix set):
`dist/assets/ImageLightbox-*.js` is **1,049,445 bytes raw / 261,403 bytes
gzipped**, and **both** `dist/student.html` and `dist/instructor.html`
`modulepreload` it. Every attendee downloads it before the app is interactive.
The entry chunks themselves are modest by comparison: `student` 73,354 raw /
24,197 gzipped, `instructor` 126,494 / 38,859.

- The remaining first-paint win is **splitting the Firebase compat SDK out of
  the shared chunk, and not preloading the vendor chunk on the student page.**
  Firebase plus React and Fuse.js is essentially all of that 1.05 MB.
- **`emojilib` is already out of it.** `src/lib/emojiData.js` loads the keyword
  dataset with a dynamic `import()`, so it lands in its own chunk
  (`dist/assets/emoji-en-US-*.js`, 174,270 raw / 48,385 gzipped) that is **not**
  preloaded and is fetched only when a picker opens. That took the shared chunk
  from 1,221,887 / 309,892 down to the figures above — about 48.5 kB gzipped off
  the critical path. Glyph grids are plain string literals and never wait on it.
- Both emoji pickers now build the keyword index lazily and share one cache
  (`getEmojiIndex` in `src/lib/emojiData.js`): the student side on first picker
  open, the instructor side when the picker is first opened rather than on
  mount. Earlier revisions of this file described the instructor side as eager
  and per-toolbar-instance; that is fixed.
- Earlier revisions also attributed the whole 310 kB gzipped to emojilib. That
  was wrong in the other direction too: removing it left about a megabyte of
  Firebase, React and Fuse.js in place, still preloaded.

Chunk sizes move build to build, so re-measure rather than trusting the numbers
above.

### Scale requirement (important)
This app is used at large Salesforce events — potentially hundreds of students
in a single session. Firebase Storage free tier is 5GB storage + 1GB/day
download. For most workshops this is fine. For very large events (TDX-scale)
the Firebase plan may need a temporary upgrade. Design uploads to be efficient:
- Resize/compress images client-side before uploading
- Current settings: **1600px longest edge, JPEG quality 0.82**
  (`IMAGE_MAX_EDGE` and `IMAGE_JPEG_QUALITY` in `src/constants/app.js:11,14`)
- Storage paths, per `storage.rules`. There is no single `images/` path for all
  uploads; each surface has its own prefix and its own write rule:
  - `sessions/{code}/question_paste/` for student question pastes (any signed-in
    identity may write)
  - `sessions/{code}/answer_paste/` for instructor answer pastes (verified
    `@salesforce.com` only)
  - `sessions/{code}/images/` for instructor session-note images (verified
    `@salesforce.com` only)
- Rules cap uploads at 8 MB and require `contentType == 'image/jpeg'`

## How sessions work
- Session codes: SQA-XXXX format (legacy TDX- codes also supported)
- Instructors create a session → get a code → share with students
- Students join with the code — no account needed
- Student identity stored in localStorage (stable studentId + last session code),
  plus an anonymous Firebase Auth uid that `firestore.rules` binds writes to
- Instructor identity: verified Google `@salesforce.com` account; `ownerEmail` /
  `instructorEmails` on the session drive access in `firestore.rules`
- **Ownership is decided by `ownerEmail` on both sides.** `instructorOwnsSession`
  (`src/instructor/hooks/useInstructorAuth.js`) compares the caller's verified
  email against `session.ownerEmail`, matching `isSessionOwner()` in the rules,
  and falls back to `ownerId` only for a document that has no `ownerEmail` at all
  — which is exactly when the rules stop looking for an owner. `ownerId` is a
  session-lookup key (`where('ownerId', '==', …)`), **not** an identity: it is
  derived from the email with runs of non-alphanumerics collapsed to one
  underscore, so it collides, and it falls back to a name-derived id
- Questions stored under: sessions/{code}/questions/{questionId}
- Session feedback stored under: sessions/{code}/sessionFeedback

## Development workflow
```bash
npm install          # first time only
npm run dev          # local dev server at http://localhost:5173
npm run build        # production build → dist/
```

There is no CI deploy. Production is published by hand from a clean checkout of
`origin/main`, never from the working tree — full sequence in
`.claude/skills/deploy-and-verify.md`:

```bash
npx firebase-tools deploy --only hosting:app --project tdx-qa
```

**Never commit dist/ — it is in .gitignore and rebuilt for every deploy.**

## Rules
- Before writing any code, state what you are about to build, what decisions
  you made and why, and flag anything that needs input before proceeding.
- Write complete working files — not snippets.
- Always specify which file you are creating or editing.
- Use async/await — no callback hell.
- Handle errors gracefully — never let a failure crash silently.
- Comment code clearly, especially Firebase operations.
- Never hardcode real secrets (service accounts, API secrets, tokens). The
  Firebase web config and the App Check reCAPTCHA *site* key are not secrets —
  they are public by design and ship in the client bundle, so they live as
  committed defaults in `src/config/firebase.js` with `VITE_*` overrides. They
  must stay committed: production builds from a clean checkout that has no
  `.env.local`, and an env-only value silently resolves empty there.
- Do not push to GitHub or deploy unless Teo explicitly says to.
- Test locally with npm run dev before declaring anything done.
