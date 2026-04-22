# Changelog

All notable changes to this project are documented here. Newest first.

---

## 2026-04-23

### Added

- **`src/lib/answeredBadge.js`:** Status badges for answered questions. Optional Firestore boolean **`answeredVerbally`** on `sessions/{code}/questions/{id}` is set when the instructor uses **Answered verbally**; it is cleared when marking **pending** (or when the last answer is removed and the thread returns to pending). If a host marks verbally and later posts a written (or image) answer, students and instructors can see **both** an **Answered verbally** pill and an **Answered** pill. Older data without the flag still shows one verbal-style pill when the thread is answered with no in-app reply text or images.

### Changed

- **Instructor card actions:** **Answered verbally** and **Mark pending** are always **two buttons** (not toggled in one slot). Order: **Save answer** → **Answered verbally** → **Pin** → **Mark pending** → **Delete** (Mark pending sits left of Delete).
- **Student + instructor sidebar resizer:** Strip is **8px** wide with **`overflow: hidden`** / min-max width so it stays a thin divider. The **chevron** on the strip was removed to avoid layout flicker; **double-click** the strip toggles hide/show (keyboard on the focused separator unchanged). `title` / `aria-label` mention double-click.
- **“Answered verbally” badge styling:** **Teal** background/text (`.badge-answered-verbal`); green **Answered** unchanged. Removed the inset **box-shadow** that read as an extra border.
- **Instructor demo sample:** One answered question includes **`answeredVerbally: true`** plus text so the dual-badge case is visible in demo mode.

---

## 2026-04-18

### Added

- **Multiple session sidebar notes:** Instructors can add several independent “Important” messages (title, body with formatting toolbar, image URLs, per-note visibility). **Drag the handle (⠿)** to reorder before saving. Stored as `sessionNotes` on `sessions/{code}` (capped at 15). Students see each note as its own card in session order. **Legacy** single `sessionNoteTitle` / `sessionNoteBody` / `sessionNoteImageUrls` still works when `sessionNotes` is absent. Shared helpers in **`src/lib/sessionNotes.js`**.
- **Named links** on each session note: optional **https** URL plus optional **display name**; students get a compact link list under the message (still capped per note in **`sessionNotes.js`**).
- **Student layout:** Session sidebar is **resizable** (drag the strip between feed and sidebar), **collapsible** via the **chevron** control, width persisted in **`localStorage`**. Below **768px** the layout stacks and the resizer is hidden. The strip shows subtle **‹ ›** hints for drag direction.
- **Instructor layout:** Left **My sessions** sidebar matches the same **drag / chevron / keyboard** resize and collapse behavior (persisted separately; hidden below **900px**).
- **Instructor session notes:** Each note card can be **collapsed** (▼) to save space; **+ Add note** collapses all existing cards and opens the new one expanded.

---

## 2026-04-22

### Fixed

- **Firebase Storage CORS:** **`storage-cors.json`** now allows **Vite** dev origins **`http://localhost:5173`** / **`http://127.0.0.1:5173`** and **`vite preview`** **`:4173`** (uploads were blocked when only older ports like `:8765` were listed). You must still run **`gsutil cors set storage-cors.json gs://YOUR_BUCKET`** after editing. Student image upload errors that look like CORS/network now point at SETUP.

### Changed

- **Student + instructor stats:** Sidebar **Session stats** / **Overview** with a **scope hint**. **Total**, **Answered**, **Pending**, and **Pinned** (and instructor filter count badges) use **Firestore aggregate `count()`** queries on `sessions/{id}/questions` so numbers are **session-wide**, not tied to how many pages you have opened. The question list still loads in pages. **Dependency:** `firebase` npm package.
- **Fixed:** Session-wide counts always fell back to “loaded only” because **CDN compat** and **npm modular** did not share one app. Firebase compat is now initialized from **`src/lib/firebaseCompat.js`** (bundled with Vite); **HTML no longer loads Firebase from jsDelivr**. Modular `getApp()` / `getFirestore()` then match compat `firebase.firestore()`. If aggregates still fail (offline, rules, missing index), the hint explains the cache fallback.
- **Pagination:** **Next** / phantom page respects an **end-of-list** flag when an older fetch returns no documents (fixes sessions with exactly `QUESTIONS_PAGE_SIZE`, `2×`, … questions). **Instructor demo:** Reselecting the demo session repopulates questions after the shared session reset; demo stats stay client-side from sample data.

---

## 2026-04-21

### Fixed

- **Student join (`code-input`):** Auto-uppercase on input restores **`selectionStart` / `selectionEnd`** so the caret does not jump to the end when fixing a character in the middle of the session code.

### Documentation

- **`README.md` / `SETUP.md`:** Dev server note — **`/`** is the link hub (`index.html`); student and instructor apps are at **`/student.html`** and **`/instructor.html`**.

---

## 2026-04-20

### Added

- **Vite build:** `package.json` + `vite.config.js` multi-page app (`student.html`, `instructor.html`). Shared code under **`src/`** — `config/firebase.js` (optional `VITE_FIREBASE_*` overrides), `constants/` (pagination, poll interval, image limits, PIN pepper), `lib/` (`richText`, `toast`, `formatQuestionWhen`, Fuse-powered **`questionSearch`**), and **`src/instructor/instructorApp.js`** / **`src/student/studentApp.js`** (existing behavior, `globalThis` exports for `onclick` handlers). Styles extracted to **`src/styles/instructor.css`** and **`src/styles/student.css`**. **`scripts/`** contains small HTML rewrite helpers used while migrating.
- **`npm run dev`** / **`npm run build`**; production output **`dist/`** with **`base: './'`** so assets resolve on GitHub Pages subpaths. **`node_modules/`** and **`dist/`** gitignored.

### Documentation

- **`README.md` / `SETUP.md`:** Document Vite dev/build and hosting **`dist/`**.

### Fixed

- **`instructor.html` / `student.html`:** Default **`#app-screen`** to **`style="display:none"`** so the main shell does not appear above the login/join UI before bundled CSS loads (avoids seeing both at once in dev or on a slow connection).

### Added

- **`index.html`:** Vite dev (and **`dist/`** after build) serves **`/`** as a short hub with links to **`student.html`** and **`instructor.html`**, since this repo has no single-page app root.

---

## 2026-04-19

### Changed

- **Product naming:** User-facing branding is **Session Q&A** (titles, join screen, instructor top bar). New session codes use prefix **`SQA-`** (demo: **`SQA-DEMO`**). Firebase sample config still targets project id **`tdx-qa`** until you replace it.
- **Browser storage keys** now prefer the **`sqa_*`** prefix (`sqa_student_uid`, `sqa_student_last_code`, `sqa_name`, `sqa_my_questions_{code}`, instructor `sessionStorage` keys for active session, onboarding flag, name, demo mode, demo hidden list). **Legacy `tdx_*` keys are read once and migrated** so existing browsers keep identity and “my questions” data. Instructor **PIN hash salt** remains `tdxqa:` so existing instructor accounts keep working.
- **Student page:** `authorId` uses **`localStorage`** key `sqa_student_uid` (migrates from legacy `tdx_student_uid` and older `sessionStorage` `tdx_uid`) so refresh and new tabs on the same device keep the same identity. **Last joined session code** is remembered for **auto-rejoin on load** until **Leave** clears it. “My questions” for edit eligibility is stored per session (`sqa_my_questions_{code}`) with migration from `tdx_my_questions_{code}` and the old flat `tdx_my_questions` key.
- **Student Refresh:** Control moved from a separate row into the **Search / Clear** row to reduce empty space.
- **Student board:** Instructor bulletin was briefly shown in the Session sidebar; that bulletin UI was then removed entirely (see **Removed**).

### Removed

- **Live bulletin:** No instructor UI, student display, or writes for `bulletinTitle` / `bulletinBody` / `bulletinImageUrls`. Older session documents may still contain those fields; they are ignored. Use the **Session sidebar (“Important”)** note for links and notices instead.
- **“New session from this one”:** Removed the duplicate-session control and **`duplicateSessionFromCurrent()`** from `instructor.html` so each class is created only via **+ New session** (independent session details).

### Added

- **Instructor “hide from my list”:** Per-instructor optional array **`sessionsHiddenFromList`** on **`instructors/{id}`** filters the sidebar; sessions are not deleted. **Re-join** the session code clears that entry for your account. Demo mode uses **`sessionStorage`** key **`sqa_sessions_hidden_demo`** (migrates from `tdx_sessions_hidden_demo`); **Reset demo** clears it.
- **Rendered code — copy to clipboard:** Icon button on **fenced** (```) **and** **inline** (`` `...` ``) code in formatted questions, answers, session note, and demo views (`student.html` / `instructor.html`).

### Fixed

- **Emoji “⋯” picker (student + instructor):** Scroll hint **▲/▼** live in dedicated rails (not drawn under the scrolling grid); hints stay visible at ends (dimmed when that direction cannot scroll further); **`ResizeObserver`** refreshes overflow state; panel uses **viewport** height/width (no longer shrunk to the parent **`.q-card`** band). **Picker shell is appended to `document.body` while open** (portal) with a `details`↔shell link so stacking escapes nested cards, textareas, pagination, and the student **sidebar**; outside-click / Escape close logic respects the portaled shell. Extra **CSS** stacking for format toolbars, **ask box**, **main column**, **question list**, and instructor **answer** chrome where still relevant.
- **Instructor script:** Removed duplicate `linkify` definition so a single `linkify` + `formatRichMessage` block remains.

### Documentation

- **`README.md`:** Student/instructor bullets for format toolbars, Refresh placement, and local identity/session persistence; points here for a dated timeline.
- **`SETUP.md`:** Note that session note / Q&A bodies support client-side rich formatting (no extra Firebase fields).
- Optional local notes (e.g. **`BRAINSTORM-tomorrow.md`**) for follow-up ideas (edit parity, Important section, images).

---

## 2026-04-18

### Added

- **Slack-style rich text** (rendered safely after escape): `*bold*`, `_italic_`, `~strikethrough~`, `` `inline code` ``, fenced ` ``` ` code blocks, Unicode emojis, auto-linked `https://` URLs.
- **Where it applies:** Session “Important” note, question bodies, and instructor answers on both pages; instructor session sidebar message and per-question answer boxes (delegated clicks), and student-view demo ask/edit.
- **Format toolbars:** Buttons insert markers around the selection (or placeholder text) on student ask + edit modal; instructor session sidebar message, per-question answer boxes, and student-view demo ask/edit.

### Changed

- Instructor help copy for session sidebar aligned with formatting capabilities.

---

## Earlier (pre-changelog)

Shipped features already described in **`README.md`** (roadmap / stack) include question pagination (25 per page), student polling, instructor live listener on the newest page, and answer draft preservation.

When in doubt, compare **`git log`**.
