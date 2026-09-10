# Session Q&A — Prioritized Backlog

Captured for the Dreamforce bootcamp. Ordered by value/effort. File pointers are
starting points, not exhaustive.

## Operational

### P1 — Enable App Check enforcement (deliberately deferred)
App Check is registered and the client now mints reCAPTCHA v3 tokens, but
`firestore`, `firebasestorage` and `identitytoolkit` are all **UNENFORCED**, so
the backend accepts requests carrying no token. Until this is on, App Check
protects nothing — see the vote-integrity note in [`firestore.rules`](firestore.rules),
which correctly identifies App Check as the only lever against a sockpuppet
upvote campaign, since anonymous identities are unlimited and rules cannot tell
500 scripted voters from 500 real ones.
- Do **not** enable it from the console on a hunch. Let one real workshop run,
  then check the verified vs. unverified split in Firebase Console → App Check.
- Enforce only when essentially all traffic shows verified. Never on event day:
  the failure mode is total, not degraded — unverified clients cannot write at all.
- Token TTL is 24h and the score threshold is reCAPTCHA's default `0.5`. A
  stricter score also catches real attendees on VPNs and privacy blockers.

### P2: Split the 1.05 MB shared chunk off first paint
The chunk `dist/assets/ImageLightbox-*.js` is **1,049,445 bytes raw / 261,403
bytes gzipped** (`gzip -9`, re-measured 2026-08-17 on the working tree with the
uncommitted audit fix set) and is still eagerly `modulepreload`ed on *both*
`student.html` and `instructor.html`, so every attendee downloads it before the
app is interactive.

An earlier version of this item blamed the whole 310 KB on `emojilib`. That was
wrong. What is left is the **Firebase compat SDK**, plus React and Fuse.js.

- **The remaining win:** split Firebase out of the shared chunk and stop
  preloading the vendor chunk on the student page. Verify a fix by re-running
  `npm run build` and confirming the vendor chunk stops appearing as a
  `modulepreload` in `dist/student.html`.
- **The emoji half is done** (audit fix set, not yet deployed).
  [`emojiData.js`](src/lib/emojiData.js) loads `emojilib` through a dynamic
  `import()`, so the dataset lands in `dist/assets/emoji-en-US-*.js` (174,270
  raw / 48,385 gzipped), is not preloaded, and is fetched when a picker first
  opens. That is where the shared chunk's drop from 1,221,887 / 309,892 came
  from — roughly **48.5 kB gzipped** off the critical path. Search falls back to
  matching nothing until the keywords land, then backfills the cells and replays
  the query; a failed fetch costs search only and a later open retries.
- **The two pickers now match.** Each still has its own 1,035-glyph grid
  (`Array.from(FORMAT_EMOJI_PICKER_RAW).length` is 1035 in both files), but both
  go through the shared, cached `getEmojiIndex()` and both defer the work:
  - **Student** — [`FormatToolbar.jsx`](src/student/components/FormatToolbar.jsx)
    indexes on first picker open, and starts the keyword fetch on open.
  - **Instructor** —
    [`FormatToolbar.jsx`](src/instructor/components/FormatToolbar.jsx) fills the
    grid on the first open of that `<details>` rather than on mount. Previously
    the grid was built unconditionally in a `useEffect`, so a normal instructor
    page ran the 1,035-glyph pass about **eleven times before first paint** (one
    toolbar per answer box — `AnswerBox.jsx:64`, one `AnswerBox` per card,
    `QUESTIONS_PAGE_SIZE` is 10 — plus one per note body in
    [`SessionNotesEditor.jsx`](src/instructor/components/sidebar/SessionNotesEditor.jsx))
    and built the same number of 1,035-button `innerHTML` strings.
- Known cost of the async index: if the emoji chunk fails to load, search shows
  "No emoji match", which is indistinguishable from a real empty result.

## Features

### P1 — QR-code join (biggest in-person win)
Students join by scanning instead of typing `SQA-XXXX`.
- Add a QR that encodes the student URL with the code prefilled, e.g.
  `https://<host>/student.html?code=SQA-XXXX`.
- Show it on the instructor dashboard header and optionally the hub.
- Have the student join flow read `?code=` and auto-fill/auto-join
  ([`JoinScreen.jsx`](src/student/components/JoinScreen.jsx),
  [`useStudentSession.js`](src/student/hooks/useStudentSession.js)).
- Library: `qrcode` (render to canvas/img) — small, offline.

### P1 — Presenter / kiosk view (projector mode)
Full-screen, large-type view for the room showing pinned + top-voted unanswered
questions, auto-refreshing.
- New route/component reusing the instructor question store
  ([`useInstructorStore.js`](src/instructor/store/useInstructorStore.js),
  [`QuestionsList.jsx`](src/instructor/components/QuestionsList.jsx)).
- Sort by votes desc, hide answered, minimal chrome, high contrast.

### P2 — Export session
Download questions + answers after class (Markdown and/or CSV).
- Iterate the questions collection for a session and serialize client-side.
- Add an "Export" control in the instructor sidebar
  ([`InstructorSidebar.jsx`](src/instructor/components/sidebar/InstructorSidebar.jsx)).

### P2 — Instructor live-Q&A keyboard shortcuts
Answer / pin / mark-answered / next without the mouse during live Q&A
([`QuestionCard.jsx`](src/instructor/components/QuestionCard.jsx),
[`AnswerBox.jsx`](src/instructor/components/AnswerBox.jsx)).

### ~~P2: Finish or remove image upload~~ (done)
No longer half-wired. Image paste is complete end to end: resize (1600px longest
edge, JPEG q0.82 per `src/constants/app.js`), upload, render, plus identity-gated
[`storage.rules`](storage.rules) and [`storage-cors.json`](storage-cors.json).
`test/storage.rules.test.mjs` covers it with 12 cases, all passing under
`npm run test:rules` (**87/87** total on 2026-08-17, with the audit fix set in
the tree: 12 storage plus 75 Firestore).

### P3 — Scale / read-budget for large events
Stale premise, corrected: the student board no longer polls. Page 0 is a live
`onSnapshot` listener ([`useQuestions.js`](src/student/hooks/useQuestions.js)
line 245) and `STUDENT_POLL_MS` no longer exists anywhere in `src/`. That
changes the read profile rather than removing the concern: a listener bills a
read per connected client per document change, so a busy room can cost more than
a 10s poll, not less.
- Consider a lightweight "new questions available" indicator + manual refresh to
  cut reads when hundreds are connected.
- Confirm Firestore read budget / plan for TDX-scale audiences. **Unverified:**
  nobody has measured actual reads for a listener-based session at event scale.

## Design / UX / Accessibility

### ~~P1 — Replace instructor PIN UI after OAuth ships~~ (done)
Closed 2026-08-17. The PIN form is gone:
[`LoginScreen.jsx`](src/instructor/components/LoginScreen.jsx) now renders a
single **Continue with Google** button plus an optional display-name field and
the demo button, with no PIN input and no "Future upgrade… Salesforce OAuth"
footer note. `src/constants/auth.js`, `hashPin`, and the `login` / `register`
helpers were deleted outright (`rg -n "hashPin|constants/auth" src/` returns
nothing). This did not require the Next.js gate, which has still never been
deployed. Remaining polish: the screen shows the typed display name rather than
the verified Google email, so there is no on-screen confirmation of *which*
account is signed in.

### P2 — Consolidate inline styles into CSS tokens
Components mix heavy inline styles with the stylesheets, making theming
inconsistent (e.g. [`LoginScreen.jsx`](src/instructor/components/LoginScreen.jsx),
[`AskBox.jsx`](src/student/components/AskBox.jsx) anon toggle). Move to the
existing design tokens (`var(--accent)`, `var(--border)`, …) in
[`src/styles/`](src/styles).

### P2 — Accessibility pass
- `aria-label`s on icon-only buttons (reactions, delete `×`, feedback).
- Visible focus states on all interactive controls.
- Color-contrast check on muted text (`--text-light`/`--text-muted`).

### P3 — Consistent empty / loading states
Skeletons or clear placeholders for the question list and stats while data loads
([`QuestionsList.jsx`](src/student/components/QuestionsList.jsx),
[`useSessionStats.js`](src/student/hooks/useSessionStats.js)).

## Done (this pass)
- Removed the live chat (student + instructor), its CSS, Firestore chat rules,
  and the `leo-profanity` dependency.
- Scoped the Next.js middleware so only `/instructor` requires auth (students
  are no longer locked out).
- Brought `next-app/` into source control (secrets still ignored).
- Hardened `firestore.rules` with create-time validation + documented the
  Phase 2 Admin SDK write-lockdown.
- Added the OAuth/deploy runbook ([`next-app/README.md`](next-app/README.md)).
