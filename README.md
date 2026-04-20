# Session Q&A

Live Q&A for trainings and events. Instructors run a session with a short code; students join in the browser, post questions, and upvote. Everything is stored in **Firebase Firestore**; instructors see the latest page of questions live, while students get periodic updates plus an immediate refresh when they post or vote. No app store—just two static pages you can host anywhere (e.g. GitHub Pages).

---

## What’s in the repo

| File | Role |
|------|------|
| `student.html` | Join screen + board for **students** (share this URL widely). |
| `instructor.html` | Login, sessions, moderation for **instructors** (treat as internal). |
| `SETUP.md` | Firebase project, Firestore rules, hosting, and session flow. |
| `CHANGELOG.md` | **Timeline of recent product and doc changes** (newest first). |

---

## Changelog / timeline

For a **dated history** (fixes, UI tweaks, rich text, toolbars), see **`CHANGELOG.md`**.

---

## Students (attendees)

- Join with a session code (e.g. `SQA-XXXX`). On desktop, **Sort**, **Stats**, and **Session** sit in the right column; the question feed stays on the left (narrow screens stack the sidebar first so controls stay near the top).
- Optional name, or post as **Anonymous** (non-anonymous names are remembered in this browser).
- **Same browser:** a stable **student id** and your **last session code** are stored locally so a normal page refresh reopens the board without typing the code again (until **Leave**). That id is the `authorId` on your questions and votes—not your display name—so retyping the same name does not create a second “you” in Firebase.
- Ask questions, **edit your own** questions while in the same browser session, **upvote** any question.
- See session details (title, room, time, description) and optional **Important** (session sidebar note) in the **Session** column on the right. On narrow screens the sidebar stacks first, then the ask box and question feed. Filters (all / pinned / answered / unanswered) and **sort by newest or by votes** (votes sort applies to **loaded** questions only if you have not loaded older pages).
- Questions load in **pages** of 25 with **Load older**; the board **polls** about every 10s (your own submit or edit refreshes immediately). **Refresh** next to Search/Clear runs the same fetch on demand for that student only.
- The **Format** row above the ask box (and in **Edit**) inserts Slack-style markers: bold, italic, strikethrough, inline code, code blocks, and common emojis; `https://` links still auto-link when posted. On the board, **fenced and inline code** in rendered messages show a small **copy** control (same idea as the instructor view).
- **Paste screenshots** into the ask box (students) or answer box (instructors): images resize, upload to **Firebase Storage**, and show as attachments after submit (requires Storage enabled + rules — see `SETUP.md`).
- See **instructor answers** as they’re saved (including multiple answers per thread when instructors add them).

---

## Instructors

- **Account:** display name + PIN (PIN is stored hashed in Firestore; see `SETUP.md` for limits).
- **Sessions:** create a session (code generated for you), edit session info, copy the code for students. Co-instructors can **join an existing session** with the same code. You can **hide a session from your own sidebar** (Firestore keeps the session; **join again** with the code to put it back on your list).
- **Session sidebar note** (“Important”): optional title, message, and `https://` image URLs for the student **Session** panel; Slack-style formatting; format toolbar on the message field.
- **During class:** answer (including follow-up answers), **pin** questions, mark answered/pending, **delete** questions. The newest **25** questions update **live**; use **Load older questions** for earlier posts. Draft answers are kept when the list refreshes. Rendered **code** (inline and fenced) in threads includes a **copy** control for students.
- **Demo mode:** try the UI with sample data and no Firebase (button on the login screen).

---

## Stack (today)

- Plain HTML + CSS + JS in each file; Firebase compat SDK from CDN.
- Firestore holds instructors, sessions, and questions. GitHub Pages works fine for the static files.

---

## Roadmap

**Shipped in this repo**

- **Pagination** (25 per page) + **Load older** on student and instructor.
- Student **polling** (~10s) instead of a live listener on the full question list; instructor **live listener on the newest page** only.
- **Answer drafts** preserved for instructors when the question list re-renders.
- Question and session-note text: **line breaks**, **Slack-style rich markers** (`*bold*`, code fences, etc.), **linkified** `https://` URLs, **copy-to-clipboard on rendered code**, plus **format toolbars** on key editors (see **`CHANGELOG.md`**).

**Still to build (when you’re ready)**

- React (or similar) for cleaner UI state, Heroku + **Salesforce Files** for real uploads, Firebase **App Check** + instructor **Auth**, tighter rules for global URLs.

Details for maintainers may live in a private notes file; this README stays high level.

---

## Setup

See **`SETUP.md`** for Firebase config, security rules, hosting, and how to run a session end to end.
