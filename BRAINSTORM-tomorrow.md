# Tomorrow / follow-up — Q&A rich content & Important section

Temporary brainstorming notes (safe to delete after work is captured elsewhere).

**Shipped changes** (rich text, toolbars, Refresh layout, emoji picker fix) are summarized in **`CHANGELOG.md`**.

---

## 1. Edit questions & answers — parity with “new” compose

**Goal:** When **editing** a student question or an instructor answer, support the same capabilities as creating new content.

### Questions (students)

- [ ] **Paste / attach images** in **Edit your question** (today paste likely only wired on `#q-text`).
- [ ] **Format toolbar** already in the edit modal; confirm all actions still work after image work.
- [ ] On save: reuse same upload path as submit (Storage + Firestore fields for `imageUrls` / pending blobs) and handle **remove** preview chips while editing.
- [ ] Edge cases: edit while images uploading; empty text but images only; size limits consistent with ask box.

### Answers (instructors)

- [ ] **Paste images** into answer `textarea` when **adding** an answer (verify if already supported via shared paste handler).
- [ ] If **editing an existing answer** is ever added in UI, same rules as above (may be out of scope if answers are append-only today).

---

## 2. “Important information” (session sidebar note)

**Goal:** Same **formatting + paste images + link** behavior as bulletin / Q&A where product allows it.

### Instructor (`session-note-body-input`, optional title)

- [ ] Format toolbar is already on **Message**; evaluate **title** field if rich text is shown on student board.
- [ ] **Image paste or explicit upload** into session note body (today may be URLs-only in sidebar).
- [ ] Storage path + Firestore shape aligned with bulletin / questions for consistency and rules.

### Student display

- [ ] Confirm **Important** / session note **title + body** use `formatRichMessage` (and images from URLs).
- [ ] If inline uploads are added, student view must render new attachment shape (match bulletin cards pattern).

### Docs / product

- [ ] Update `SETUP.md` / README if Storage paths or limits change.

---

## 3. Emoji “⋯” menu — fix applied (2026-04-19)

**Cause:** The more-emoji panel is `position: absolute` and drops **below** the format row. The **textarea** (or next field) is the **next DOM sibling**, so it painted **on top** of the panel and **stole clicks**.

**Change:** `position: relative; z-index: 10` on `.format-toolbar`, and higher `z-index` on `.fmt-emoji-grid` in both `student.html` and `instructor.html`.

**Verify tomorrow:** Open ⋯, click each emoji; mobile Safari; instructor bulletin + session note pickers; delegated toolbar on answer cards.

---

## 4. Quick idea backlog

- Strip markdown markers for search haystack (optional).
- **Markdown `**bold**`** in addition to Slack `*bold*` (single decision for both pages).

---

*This file is intentionally disposable after tasks are tracked in your real backlog.*
