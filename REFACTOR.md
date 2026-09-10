# React Refactor — Session Q&A

## Status: COMPLETE — this file is a historical record

The React rewrite **shipped**. Both the student and instructor apps are React on
`main` today (see `CLAUDE.md`), so this document is kept as the record of what was
decided and why, not as a description of current state or a set of instructions.
The `react-refactor` branch still exists locally and on `origin`.

Read the rest in past tense. The **Architecture decisions** below all held and are
still the reasons the code looks the way it does. Where a later section describes
something that has since changed, it is flagged inline.

The original working rule while the branch was live, kept for context: nothing went
to GitHub or production until Teo explicitly said "push" or "deploy," and `main`
stayed production-ready throughout. That rule still governs the repo generally.

---

## Why React

Not because vanilla JS is unreadable — it isn't. The problem is architectural:
state, side effects, and rendering are all mixed together. Every feature change
requires touching `renderQuestions()` in multiple places. The instructor app's
`captureAnswerDrafts`/`restoreAnswerDrafts` cycle (which runs before and after
every render to preserve textarea contents) is the clearest sign the vanilla
architecture has hit its ceiling.

React solves these specifically:
- Controlled textareas survive re-renders without a capture/restore cycle
- `useEffect` cleanup makes Firestore listener teardown explicit and reliable
- Component boundaries make it obvious what state belongs where

---

## Architecture decisions

### Two React apps, not one SPA

`student.html` and `instructor.html` remain two independent HTML pages, each
with its own `ReactDOM.createRoot`. There is no shared router, no shared React
tree, no client-side navigation between them.

Rejected alternative: one React app with React Router.
Why rejected: would change production URLs, bundle instructor code into the
student page and vice versa, and gains nothing — students and instructors never
navigate between the two in the same session.

### State management

**Student app:** plain `useState` + `useReducer`. The student app has a small,
linear state machine (join → session → leave) and no deeply interconnected
global state.

**Instructor app:** Zustand. The instructor app has 11+ interconnected pieces
of state (`activeSessionCode`, `allQuestions`, `allSessions`, `questionPages`,
`currentPage`, `answerDrafts`, `pendingAnswerImages`, `answerEditState`,
`isDemoMode`, `currentInstructor`, `studentViewOpen`). Changing
`activeSessionCode` cascades through all of them. Zustand gives a single store
with actions, no provider wrapping, and demo mode is a simple branch in each
action.

### Firebase

The compat SDK (`firebase/compat/*`) is kept exactly as-is. Do not migrate to
the modular SDK. `sessionQuestionCounts.js` already uses the modular API
(`getCountFromServer`) and coexists with the compat SDK — this is proven and
intentional.

Firebase instances are exposed via a `FirebaseContext` React context rather
than module-level globals.

### CSS

All CSS files (`src/styles/student.css`, `src/styles/instructor.css`) are kept
exactly as-is. No CSS-in-JS, no Tailwind, no component library. The existing
CSS is production-quality and precisely tuned for this app.

### Fuse.js

Moved from CDN `<script>` tag to npm dependency. `questionSearch.js` updated
to `import Fuse from 'fuse.js'`. One-line change, required for Vite bundling.

### Rich text rendering

`formatRichMessage()` output is rendered via `dangerouslySetInnerHTML`. This is
safe: all user-supplied content is HTML-escaped via `esc()` before entering the
formatter. This must be documented at every usage site.

### Emoji picker and resizable sidebar

These are ~250 lines of imperative DOM code each (IntersectionObserver,
ResizeObserver, pointer capture, `getBoundingClientRect` positioning). They
work and handle real edge cases.

Decision: wrap, do not rewrite. The positioning and observer logic stays as
vanilla JS inside `useEffect` hooks. A `createPortal` call handles the
`document.body.appendChild` pattern. The geometry math is not touched.

### No TypeScript

Not introduced during this refactor. Too much change at once for a production
app. Can be added later.

### No React Query / SWR

Firebase's `onSnapshot` is push-based, not request-response. These libraries
don't map to it cleanly. Custom hooks are the right model.

### No component library

MUI, Chakra, etc. would require fighting or ripping out the existing CSS.

---

## Folder structure (target as planned — not the final layout)

This was the plan drafted before the work started, and the finished code diverged
from it. Two examples: `src/shared/` ended up with `FirebaseContext.jsx` and
`ImageLightbox.jsx` only, not the six files listed here, and
`StudentDemoPanel.jsx` was built and has since been **deleted**. The tree is left
as drafted so the plan stays legible; consult the repo, not this block, for what
exists now.

```
src/
├── config/firebase.js          ← unchanged
├── constants/                  ← unchanged
├── lib/                        ← ALL files unchanged
├── styles/                     ← ALL CSS unchanged
│
├── shared/
│   ├── FirebaseContext.jsx     ← db + storage via React context
│   ├── FormatToolbar.jsx       ← bold/italic/code/fenced buttons
│   ├── EmojiPicker.jsx         ← full picker, portal + positioning
│   ├── Modal.jsx               ← generic modal wrapper
│   ├── Toast.jsx               ← toast notification
│   └── ResizableSidebar.jsx    ← drag-to-resize + collapse/expand
│
├── student/
│   ├── main.jsx
│   ├── StudentApp.jsx
│   ├── hooks/
│   │   ├── useStudentSession.js
│   │   ├── useQuestions.js
│   │   ├── useUpvote.js
│   │   └── useSessionStats.js
│   └── components/
│       ├── JoinScreen.jsx
│       ├── AppScreen.jsx
│       ├── QuestionsList.jsx
│       ├── QuestionCard.jsx
│       ├── AskBox.jsx
│       ├── SessionSidebar.jsx
│       ├── SessionInfo.jsx
│       ├── InstructorNotesFeed.jsx
│       ├── Pagination.jsx
│       ├── QuestionToolbar.jsx
│       ├── EditModal.jsx
│       └── FeedbackModal.jsx
│
└── instructor/
    ├── main.jsx
    ├── InstructorApp.jsx
    ├── store/
    │   └── useInstructorStore.js   ← Zustand store
    ├── hooks/
    │   ├── useInstructorAuth.js
    │   ├── useSessions.js
    │   ├── useQuestions.js
    │   └── useSessionStats.js
    └── components/
        ├── LoginScreen.jsx
        ├── Dashboard.jsx
        ├── sidebar/
        │   ├── InstructorSidebar.jsx
        │   ├── SessionsList.jsx
        │   ├── SessionSettings.jsx
        │   ├── InstructorManager.jsx
        │   ├── FilterSort.jsx
        │   ├── StatsSection.jsx
        │   ├── SessionNotesEditor.jsx
        │   └── SessionFeedbackList.jsx
        ├── QuestionsList.jsx
        ├── QuestionCard.jsx
        ├── AnswerBox.jsx
        ├── StudentDemoPanel.jsx
        ├── JoinSessionModal.jsx
        ├── CreateSessionModal.jsx
        └── DeleteModal.jsx
```

---

## Pagination model (critical to get right)

This is the highest-risk state in the refactor. The model:

- `pages` is an array of `{ questions, endSnap }` objects
- `currentPage` is an index into `pages`
- The instructor app has a real-time `onSnapshot` listener that updates
  `pages[0]` whenever questions change
- Pages 1+ are fetched on demand via `.startAfter(endSnap)` and cached
- Navigating back to page 0 uses the cached value; it does not re-fetch
- Navigating away from page 0 pauses live updates for that session
- ~~The student app polls instead of using `onSnapshot` for questions~~ — **no
  longer true.** Student polling was removed after the refactor; page 0 on the
  student side is now an `onSnapshot` listener too (`STUDENT_POLL_MS` no longer
  exists in `src/`). The rest of the model above still describes the code.

This must be modeled as explicit state in each app's store/hooks, not
reconstructed from side effects.

---

## Features that must be preserved exactly

- Session creation, join, and SQA-/TDX- code system
- Live question feed with 10s polling on student side
- Real-time `onSnapshot` listener on newest page for instructors
- Pagination (10 per page) + Load older
- Upvoting (optimistic, per-question lock), pinning, answering, marking pending, deleting
- Slack-style rich text: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, ` ```blocks``` `
- Format toolbars on ask box and answer boxes
- Instructor notes and session notes editor (drag-to-reorder)
- Session feedback (anonymous, student → Firestore)
- Session stats (total, answered, pending, pinned) via Firestore aggregates
- Multi-session management (create, join, hide from list)
- Co-instructor support
- Demo mode (no Firebase required, full sample data)
- Student view toggle for instructors
- Resizable sidebar with collapse/expand (both apps)
- Image paste → resize → Firebase Storage upload → preview
- GitHub Actions deploy to GitHub Pages on push to main (unchanged)

---

## Build sequence

Each phase ends with a working `npm run dev` before the next begins.

1. Setup — packages, Vite plugin, verify dev server
2. Student: join screen
3. Student: question list + ask box + Firestore
4. Student: sidebar + session info + stats
5. Student: pagination + search + filters
6. Student: format toolbar + emoji picker (shared components built here)
7. Student: image paste + upload
8. Student: modals + resizable sidebar
9. Instructor: login screen
10. Instructor: dashboard skeleton + Zustand store
11. Instructor: sessions list + session select + Firestore
12. Instructor: questions list + answer box + action buttons
13. Instructor: session settings + notes editor
14. Instructor: student demo panel
15. Instructor: remaining modals + sidebar resizer
16. End-to-end smoke test against a real Firebase session

---

## What is off-limits during this refactor

- Do not push to GitHub
- Do not deploy to production
- Do not modify `firestore.rules`
- Do not modify `storage-cors.json`
- Do not migrate Firebase compat SDK to modular
- Do not change the URL structure (`student.html`, `instructor.html`)
- Do not introduce TypeScript
- Do not introduce a component library
- Do not change how GitHub Actions works

---

## Testing

Always run `npm run dev` after each phase. Test:
- Student join + question submit + upvote
- Instructor login + session select + answer + pin + delete
- Demo mode (no Firebase config required)
- Image paste (requires Firebase Storage to be configured)
- Pagination across multiple pages
- Mobile layout (resize browser to < 768px / < 900px)
