# Changelog

All notable changes to this project are documented here. Newest first.

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
