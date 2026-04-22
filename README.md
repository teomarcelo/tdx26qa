# Session Q&A

Live Q&A for trainings and events. Instructors run a session with a short code; students join in the browser, post questions, and upvote. Everything is stored in **Firebase Firestore**; instructors see the latest page of questions live, while students get periodic updates plus an immediate refresh when they post or vote. No app store—just two static pages you can host anywhere (e.g. GitHub Pages).

---

## What’s in the repo

| Path | Role |
|------|------|
| `index.html` | Dev/prod **hub** at `/` with links to student and instructor (the real apps are the two HTML entries below). |
| `student.html` / `instructor.html` | Page shells (markup + Firebase CDN + Fuse). **Run via Vite** in dev; for production, use the **`dist/`** output of `npm run build` (see below). |
| `src/` | App logic split into **`config/`**, **`constants/`**, **`lib/`**, and **`student/`** / **`instructor/`** entry bundles. |
| `vite.config.js`, `package.json` | [Vite](https://vitejs.dev/) multi-page build (`index` + `student` + `instructor`). **`firebase`** (npm): **`firebase/compat/app`** (+ Firestore + Storage) in **`src/lib/firebaseCompat.js`** for all reads/writes, and the same package’s modular **`getCountFromServer`** for **session-wide stat** counts (no separate CDN Firebase scripts). |
| `SETUP.md` | Firebase project, Firestore rules, hosting, and session flow. |
| `CHANGELOG.md` | **Timeline of recent product and doc changes** (newest first). |

### Develop and deploy

1. **Install:** `npm install`
2. **Local dev:** `npm run dev` — open **`http://localhost:5173/`** for a link hub, or go straight to **`/student.html`** or **`/instructor.html`** (there is no app UI on `/` unless you use this hub).
3. **Production build:** `npm run build` — outputs **`dist/`** with hashed JS/CSS and **relative** `./assets/…` URLs so the folder can be dropped onto Netlify or published as a static site from any path.
4. **Optional env overrides:** set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, etc. before `npm run build` (see `src/config/firebase.js`).

`dist/` is listed in `.gitignore`; ship the build artifact to hosting rather than committing it.

### GitHub Pages (quick path)

This repo includes **`.github/workflows/deploy-pages.yml`**: on every push to **`main`**, GitHub Actions runs **`npm ci`** + **`npm run build`** and publishes **`dist/`** to Pages. Full click-by-click steps are in **`SETUP.md` → Step 4 → Option B — GitHub Pages (GitHub Actions)`**.

If **`student.html` looks like plain HTML** (no styling), Pages is almost certainly serving **source files** instead of the **built `dist/`**: set **Settings → Pages → Source** to **GitHub Actions**, not **Deploy from a branch**. Details in **`SETUP.md`** under **Troubleshooting: student page has no styling**.

---

## Changelog / timeline

For a **dated history** (fixes, UI tweaks, rich text, toolbars), see **`CHANGELOG.md`**.

---

## Students (attendees)

- Join with a session code: **`SQA-`** is a fixed label and you type the last four characters (or paste a full **`SQA-`** / legacy **`TDX-`** code in the field). On desktop, the right column shows **Session** (details) first, then **Session stats**, with a **feedback** control at the bottom; **Sort** / filters sit above the question list in the main column. A **narrow strip** between the columns is the resize handle: **drag** to change width, **double-click** to collapse or expand the sidebar (saved in this browser).
- Optional name, or post as **Anonymous** (non-anonymous names are remembered in this browser).
- **Same browser:** a stable **student id** and your **last session code** are stored locally so a normal page refresh reopens the board without typing the code again (until **Leave**). That id is the `authorId` on your questions and votes—not your display name—so retyping the same name does not create a second “you” in Firebase.
- Ask questions, **edit your own** questions while in the same browser session, **upvote** any question.
- See session details (title, room, time, description) in the **Session** column on the right, then **Session stats** below that. At the bottom of the sidebar, **Send feedback** opens a short form (subject + message) stored anonymously in Firestore (**`dashboardFeedback`**) — no mail app, no reply. **Instructor notes** (when the host enables them): an **Instructor notes** pill on the **same row** as All / Pinned / Unanswered / Answered / **Most votes** — click to swap the main feed between **questions** and **notes** (click again, or any filter, to return to Q&A). **Most votes** toggles vote order vs newest-first (default). **Top pagination** sits **under** that filter row, then the question list (and bottom pagination). On narrow screens the sidebar stacks first, then the ask box and feed. Vote sort applies to **loaded** questions only if you have not loaded older pages.
- Questions load in **pages** of 10 with **Load older**; the board **polls** about every 10s (your own submit or edit refreshes immediately). **Refresh** next to Search/Clear runs the same fetch on demand for that student only.
- The **Format** row above the ask box (and in **Edit**) inserts Slack-style markers: bold, italic, strikethrough, inline code, code blocks, and common emojis; `https://` links still auto-link when posted. On the board, **fenced and inline code** in rendered messages show a small **copy** control (same idea as the instructor view).
- **Paste screenshots** into the ask box (students) or answer box (instructors): images resize, upload to **Firebase Storage**, and show as attachments after submit (requires Storage enabled + rules — see `SETUP.md`).
- See **instructor answers** as they’re saved (including multiple answers per thread when instructors add them).

---

## Instructors

- **Account:** display name + PIN (PIN is stored hashed in Firestore; see `SETUP.md` for limits).
- **Sessions:** create a session (code generated for you) with the same fields as **Session settings** (including OrgClaim and survey), then tweak anytime in the sidebar; copy the code for students. Co-instructors can **join an existing session** with the same code. You can **hide a session from your own sidebar** (Firestore keeps the session; **join again** with the code to put it back on your list).
- **Instructor Notes** (sidebar section title): optional title, message, optional named links (editor), and `https://` image URLs; **Show in student dashboard** checkbox; Slack-style formatting; format toolbar on the message field. Students see notes only when they open the **Instructor notes** feed toggle (not mixed into the question list). Instructors can **edit** a previously saved answer on a thread.
- **OrgClaim & survey shortcuts:** **OrgClaim** link (defaults to `http://sfdc.co/OrgClaim` on save) plus **OrgClaim code** — students always see **OrgClaim**; if the code is empty, **OrgClaim Code:** is shown with no value after it. **SURVEY** is hidden without a Survey ID and https link.
- **During class:** answer (including follow-up answers); **Answered verbally** and **Mark pending** are separate controls (always visible—order: Save answer → Answered verbally → Pin → Mark pending → Delete); **pin** and **delete** questions. The newest **10** questions per page update **live**; use **Load older questions** for earlier posts. Draft answers are kept when the list refreshes. Rendered **code** (inline and fenced) in threads includes a **copy** control for students. Status badges can show **Answered verbally** (live/in-app mark) and/or **Answered** when there is a written reply.
- **Demo mode:** try the UI with sample data and no Firebase (button on the login screen).

---

## Stack (today)

- **Vite** bundles ES modules from `src/`; markup stays in the two HTML entry files; CSS lives under `src/styles/`. Firebase compat SDK and Fuse stay on CDNs as before.
- Firestore holds instructors, sessions, and questions. Static hosting (GitHub Pages, Netlify, etc.) serves the **`dist/`** folder after `npm run build`.

---

## Roadmap

**Shipped in this repo**

- **Pagination** (10 questions per page) + **Load older** on student and instructor.
- Student **polling** (~10s) instead of a live listener on the full question list; instructor **live listener on the newest page** only.
- **Answer drafts** preserved for instructors when the question list re-renders.
- Question and session-note text: **line breaks**, **Slack-style rich markers** (`*bold*`, code fences, etc.), **linkified** `https://` URLs, **copy-to-clipboard on rendered code**, plus **format toolbars** on key editors (see **`CHANGELOG.md`**).

**Still to build (when you’re ready)**

- React (or similar) for cleaner UI state, Heroku + **Salesforce Files** for real uploads, Firebase **App Check** + instructor **Auth**, tighter rules for global URLs.

Details for maintainers may live in a private notes file; this README stays high level.

---

## Setup

See **`SETUP.md`** for Firebase config, security rules, hosting, and how to run a session end to end (including the Vite build step for production).
