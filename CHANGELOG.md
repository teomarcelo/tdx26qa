# Changelog

All notable changes to this project are documented here. Newest first.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## 2026-04-19

### Fixed

- **Emoji “⋯” menu:** Extra emoji grid was unclickable because the question `textarea` (next sibling) painted above the popover. Raised stacking (`z-index`) on the format toolbar and emoji grid in `student.html` and `instructor.html`.
- **Instructor script:** Removed duplicate `linkify` definition so a single `linkify` + `formatRichMessage` block remains.

### Changed

- **Student Refresh:** Control moved from a separate row into the **Search / Clear** row to reduce empty space.

### Documentation

- **`README.md`:** Student/instructor bullets for format toolbars and Refresh placement; this file added for a dated timeline.
- **`SETUP.md`:** Note that bulletin/session note bodies support client-side rich formatting (no extra Firebase fields).
- **`BRAINSTORM-tomorrow.md`:** Follow-up ideas (edit parity, Important section, images).

---

## 2026-04-18

### Added

- **Slack-style rich text** (rendered safely after escape): `*bold*`, `_italic_`, `~strikethrough~`, `` `inline code` ``, fenced ` ``` ` code blocks, Unicode emojis, auto-linked `https://` URLs.
- **Where it applies:** Student bulletin and session “Important” note; question bodies and instructor answers on both pages; instructor bulletin and session note editors.
- **Format toolbars:** Buttons insert markers around the selection (or placeholder text) on student ask + edit modal; instructor bulletin message, session sidebar message, per-question answer boxes (delegated clicks), and student-view demo ask/edit.

### Changed

- Instructor help copy for bulletin and session sidebar aligned with formatting capabilities.

---

## Earlier (pre-changelog)

Shipped features already described in **`README.md`** (roadmap / stack) include bulletin fields on the session document, question pagination (25 per page), student polling, instructor live listener on the newest page, answer draft preservation, and “New session from this one.”

When in doubt, compare **`git log`**.
