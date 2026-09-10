# Changelog

All notable changes to this project are documented here. Newest first.

---

## Unreleased — audit fix set, rounds one and two (NOT DEPLOYED)

Derived from `git diff f3183dff` and `--stat`: **60 tracked files changed, +3,730 / −1,047**, plus **11 new files** — four sources (`src/instructor/lib/answerIdentity.js`, `src/instructor/lib/sessionNotesDraft.js`, `src/student/hooks/useFullQuestionCorpus.js`, `src/student/lib/pendingSubmissions.js`) and seven unit-test files. Two files were **deleted** as dead code: `src/constants/auth.js` (the PIN pepper) and `src/instructor/components/StudentDemoPanel.jsx`. Nothing here is live.

Round two exists because round one's own fixes introduced four regressions, listed under **Fixed** below. Treat the two rounds as one change set: round one on its own was not safe to ship.

Local gates on the finished tree: `npm run lint` exit **0**; `npm run test:unit` exit **0** (**128 tests, 128 pass, 0 fail** — up from 25); `npm run build` exit **0**; aggregate `npm test` exit **0** (**128 unit + 88 rules**, 0 fail — rules up from 65). The rules suite needs the keg-only Homebrew JDK put on PATH first (`export JAVA_HOME=/opt/homebrew/opt/openjdk`, then `export PATH="$JAVA_HOME/bin:$PATH"`); see `docs/qa-foundation.md`. **No UI change here has been confirmed in a real browser** — see the last item under Known limitations.

> ### ⚠️ Deploy in this order. Getting it wrong breaks production.
>
> **1. Hosting (the client) first.**
>
> ```bash
> # from a clean checkout of origin/main — see .claude/skills/deploy-and-verify.md
> npx firebase-tools deploy --only hosting:app --project tdx-qa
> ```
>
> **2. Then the rules.** Both rules files changed, and **editing them locally does nothing to production** — a hosting deploy does not carry them:
>
> ```bash
> npx firebase-tools deploy --only firestore:rules --project tdx-qa
> npx firebase-tools deploy --only storage --project tdx-qa
> ```
>
> **Every fix in the Security section lives in those two files.** Ship the app and stop there and the code is live while all nine holes stay open. (Commands verified against `firebase.json`, which maps `firestore.rules` / `storage.rules` and the `app` hosting target, and against `.claude/skills/deploy-and-verify.md`. The project id is still `tdx-qa`.)
>
> **3. Only then run `scripts/backfill-owner-emails.mjs --commit`.**
>
> **Hosting before the backfill is the hard constraint.** The backfill writes `ownerEmail` and `instructorEmails` and **never writes `ownerId`** (`planForSession`, lines 99–126). `ownerId` is the only ownership signal the *currently deployed* client reads, and `ownerEmail` is the only one the *new* client reads. So the migration only becomes visible to the client once the new client is live: run it first and a session whose `ownerId` no longer identifies anybody — exactly the case the script's map-by-session-code path exists for — stays ownerless on screen, and its owner sees no owner controls.
>
> **4. Once no session lacks `ownerEmail`, delete `legacySession()` from `firestore.rules`.** It is the largest hole left: a document with no `ownerEmail` is rewritable and deletable by *any* verified Salesforce user, and it is what the whole `ownerEmail`-preservation guard exists to stop callers manufacturing.
>
> Steps 1 and 2 are close to order-independent — the rules live today are the permissive ones, and nothing in the new client needs the new rules. One old-client path does break if the rules go first: renaming yourself in a **pre-backfill** session writes `ownerName` on a document with no `ownerEmail`, which the new `ownerLabelsOk` guard denies. The new client fixes that by stamping the caller's own verified email in the same write. Deploy hosting first and the question never comes up.

### Security — round one's five holes plus four more from round two, all at the rules layer (NOT LIVE until deployed)

Round two added `ownerName`, `ownerId`, the student-facing launch URLs, and the `sessionNotes` caps. They are folded into the bullets below rather than listed separately, because they belong to the same self-join escalation story.

- **Cross-session question tampering by any verified Salesforce address.** On `sessions/{code}/questions/{id}`, `allow update` and `allow delete` were gated on `isSalesforce()` alone — so any verified `@salesforce.com` account could answer, edit, pin, re-status or delete questions in **any session in the database**, including sessions it had no relationship to. Both now also require `instructsSession(sessionId)`. The parent-session `get()` this adds is a billed read, so it is deliberately placed **behind** `isSalesforce()`: the two high-volume student paths (upvote, author text edit) still short-circuit out before any read happens.
- **Privilege escalation after a self-join.** Any verified Salesforce user can add themselves to `instructorEmails` (`joiningSelf`), so co-instructor membership is a self-service claim, not a trust boundary. These guards now apply to **every** session update path, including the owner's, and each is gated on the field actually being written so one bad legacy value can never brick a live session:
  - `ownerEmailPreserved()` — no client update may change or clear `ownerEmail`. **Clearing it was the actual exploit:** a session with no `ownerEmail` reads as a legacy doc, and `legacySession()` lets *any* Salesforce user rewrite or delete it. The one exception is a repair path — a legacy doc that has no `ownerEmail` yet may have the caller's **own** verified email stamped on it, under exactly the constraint `create` applies.
  - `ownerLabelsOk()` — **new in round two.** `ownerName` and `ownerId` are now owner-only. `ownerName` is the "Lead" label every student in the room sees and the byline the owner's notes and answers carry, so a self-joined co-instructor could rename the lead on every screen mid-workshop and re-attribute the lead's posts. `ownerId` is the client's entire notion of ownership (`where('ownerId', '==', …)` plus `instructorOwnsSession`), so rewriting it made every dashboard present the writer as the lead. The rules never read `ownerId`, so that half is not a rules-level escalation — it is a UI takeover. Blocking both strands nothing: no client update path writes them, and the legacy repair path stays open through `isSessionOwner(after)`.
  - `instructorEmailsOk()` — anyone who is not the owner may only add or remove **themselves**. Previously, self-joining also bought the power to evict the real owner from the allow-list and lock them out of their own session.
  - `sessionNameOk()` — the 300-character cap that `create` enforced now applies on update too. `sessionName` renders on every student's screen.
  - Session `allow delete` narrowed from `ownsSession()` (owner **or** any listed co-instructor) to `isSessionOwner()` (owner only; legacy docs with no `ownerEmail` stay tolerated). Self-joining no longer confers the power to destroy someone else's session.
- **`javascript:` and `data:` URLs could be written to the student-facing launch buttons.** **New in round two.** `studentOrgClaimUrl` and `studentSurveyUrl` render as **buttons on every attendee's session card**, and the only scheme check was in the client — which is not the authorization layer. `launchUrlOk()` now requires each to be empty or to match `^https?://.*` and caps it at 2,000 characters; the two copy-text fields are size-capped the same way. `matches()` is a whole-string match and `.` does not match a newline, so a multi-line value that merely *contains* an https line is rejected rather than accepted on the strength of it. This closes the scheme hole and bounds the length; an http(s) phishing link is still indistinguishable from a real one here. The client-side guard was completed too — `SessionInfo.handleSurvey` validated nothing before calling `window.open`.
- **`sessionNotes` had no type, element-count or size constraint at all.** **New in round two.** Every card in that array renders on every student's board, so one write could push hundreds of kilobytes onto every screen and drive the session document toward Firestore's 1 MiB ceiling — past which **every** later write to the session fails (settings, roster, notes, joins), a per-session denial of service. `sessionNotesOk()` now requires a list, caps it at **16** elements, and caps the three fields that render as text: body 12,000, title 2,000, `instructor` 200. The pre-`sessionNotes` single-note fields got the same treatment. Rules cannot loop, so each slot is checked by index; the element cap and the number of checks must stay in step. The expression budget is the binding constraint (Firestore denies a request that exceeds 1,000 expressions, and it looks exactly like a rule saying no), which is why all eight guards share one `affectedKeys()` diff — read the budget note in `firestore.rules` before adding anything.
- **Students forging an instructor `answer` at creation time.** `answer` stays in the create allow-list because the shipped client sends `answer: ''` on every question, but it must now arrive **empty**. The student view renders `q.answer` under an "Instructor" label, so a non-empty value written at create time was instructor-attributed text authored by a student. The client now also renders that legacy singular field **only** when `status === 'answered'` (`QuestionCard.jsx`, and the search haystack matches it), which is a second, independent stop: `create` pins status to `'pending'` and a student's only update path is `hasOnly(['text','imageUrls'])`. The plural `answers` array is not forgeable and renders regardless of status, so a real answer stays visible after "Mark pending."
- **Unbounded `voters` array padding.** `hasAll` / `hasOnly` are **set** tests and ignore multiplicity, so on their own they accepted a `voters` array padded with thousands of duplicate copies of a legal uid. `addsOwnVote` and `removesOwnVote` now assert an exact size delta (`voterList(before).size() + 1` and `- 1`), which is what makes multiplicity unforgeable. The impact was a per-question denial of service: padding the document toward Firestore's 1 MiB limit makes **every** later write to that question fail — votes, the instructor's answer, pinning, status.
- **Storage rules raised an evaluation exception on anonymous callers.** `storage.rules` `isSalesforce()` read `request.auth.token.email_verified` and `.email` by bare property access. Anonymous students carry neither claim, and a bare access on a missing claim raises an evaluation error rather than cleanly returning false. The request still ended up denied, but by an exception instead of a boolean, and it littered the emulator log with `EvaluationException` on every anonymous upload. Now read with defaults: `.get('email_verified', false)` and `.get('email', '')`.

`firestore.rules` grew from **313 to 631 lines**, `test/firestore.rules.test.mjs` by **+747 lines**. `npm run test:rules` is **88 tests, 88 pass, 0 fail**.

### Changed — what looks different to an instructor or an attendee mid-workshop

This tool runs live, so read this section before deploying on a teaching day. Several failures that used to be silent are now **loud on purpose**.

- **A failed session join now shows an error instead of a false success toast.** The roster write that actually grants co-instructor access was fire-and-forget with `.catch(() => {})`. A denied write produced a cheerful "Joined session SQA-XXXX" followed by every privileged action failing later in the workshop with a sign-in message that pointed at the wrong cause. It is now awaited, and `permission-denied` says what really happened: *"You can read this session but could not be added as a co-instructor, so answering and pinning would fail. Ask the session owner to add you."* Separately and more softly: if only the bookkeeping write to your own instructor doc fails, the join still succeeds, but the toast warns the session may not be listed after a reload.
- **Answer edits and removals can now be refused.** Both run in a transaction and locate the reply by **identity** in the freshly-read array rather than by rendered index, because a co-instructor adding or removing a reply shifts every later index. If the reply changed underneath you: *"Another instructor changed or removed that reply. Your text is still here — cancel the edit and post it as a new reply."* If the question was deleted: *"That question was deleted, so the answer was not saved."* If two replies are genuinely indistinguishable, the operation is **refused rather than resolved to the first hit**, because silently deleting a co-instructor's reply is the worse outcome. **Your draft survives all of these.** Editing someone else's reply keeps the original author instead of reattributing it to you.
- **Notes saves can report a merge.** `sessionNotes` is a single array field, so two instructors with the editor open silently overwrote each other. A save now re-reads inside a transaction and three-way merges by note id (new `src/instructor/lib/sessionNotesDraft.js`). When a co-instructor had also changed notes: *"Session notes saved. A co-instructor had also changed notes, so both sets were kept — check the list."*
- **"Remove co-instructor" is now labelled "Hide from roster."** The original control never revoked access — it only edited the display-name list students see, while write access is granted by the verified email in `instructorEmails`. The label, tooltip, `aria-label`, toast and the helper text under the roster now all say so explicitly (*"They can still edit this session."*). The write was also rewritten as a transaction using `arrayRemove`, so a co-instructor joining at the same moment is no longer dropped, and `instructorNames` is recomputed from the array read **inside** the transaction so the two fields cannot drift.
- **Older instructor pages now refresh themselves, and can say they gave up.** A new question shifts page 0, which moves the cursor every older page was fetched from — so cached older pages are marked `stale` and refetched on navigation instead of showing a window that no longer joins page 0. If arrivals keep moving the boundary, the walk stops after three attempts and says so: *"New questions kept arriving. Try that page again."* The pages stay stale, so the next navigation picks the heal back up.
- **Whole-session student views announce what they are doing.** While the session-wide read is in flight the empty state says *"Checking the whole session…"* instead of asserting there is nothing there, and pagination is hidden for every corpus-driven view (not just search) because those views render the whole session in one list. A session that runs past the 300-question cap gets an honest scope line, e.g. *"Ranked from the newest 300 questions. This session has more, so an older question could have more votes."* Almost no session reaches it.
- **A duplicate question submission is refused with an explanation.** Pressing Submit again while an offline write is still queued now says *"That question is already sending — it posts as soon as you are back online."* Anything genuinely retyped has a different fingerprint and posts normally; the box is never locked.
- **Unsaved edits are no longer wiped by someone else's write.** `allSessions` comes from a live listener, so a co-instructor joining rewrote the same document and both the session-settings form and the notes editor re-hydrated from it — discarding whatever the instructor had typed and clearing the "Unsaved changes" badge as if it had been saved. Remote changes are now ignored while either is dirty, until save or a session switch. Nothing is lost by waiting: the notes save re-reads and merges the remote array.
- **A per-session rename can now refuse instead of guessing.** Notes and answers store `instructor` as a bare display name, so if a co-instructor already posts under the owner's exact name, or asks for it, their past posts are indistinguishable and the rename stops with a plain reason. Failures also stop lying about how far they got: *"Nothing was renamed"* is used only when nothing was, and the partial case still reports *"Renamed for this session, but some past replies still show your old name."*

### Fixed

- **Student edit of a posted question could not add, replace, or remove images.** The edit modal was text-only, save wrote only `text`, and the author update rule was `hasOnly(['text'])`. Edit now uses the same paste-to-Storage pipeline as the ask box (preview, add, remove), and the author path may also write `imageUrls` (still capped at 10, still cannot touch votes, status, pin, or answers). Image-only questions can be saved without typing placeholder text.

Four of these are **regressions introduced by round one's own fixes** — the reason there is a round two.

- **The student full-corpus fetch could hang forever after a session switch, and never ran at all in `npm run dev`.** *(Round-one regression.)* A plain in-flight boolean silently swallowed a trigger it turned away, so switching sessions mid-fetch meant the new session never fetched: every whole-session view sat on *"Checking the whole session…"* permanently. The same defect killed the feature outright under React 19 StrictMode's double effect pass, which is what both entry points run — so the hook was dead in local dev. The guard now holds the in-flight **session code** rather than a boolean, and a turned-away trigger queues in state so the settling read re-runs the effect.
- **Instructor page healing could still drop a question that arrived mid-heal.** *(Round-one regression.)* Committing a refetched page whose result was issued against a page-0 boundary that has since moved re-creates the original pagination gap — questions between the old and new boundary belong to no page, with the stale flag cleared so nothing heals them. The walk now records the boundary before each fetch, discards the result if it moved, and re-derives; the restart budget is 3.
- **A transactional answer delete could atomically remove a co-instructor's reply.** *(Round-one regression.)* Round one identified a reply by `ts:<iso>`, which is not unique. Replies written from now on carry a unique `id`; replies already in production are matched on their whole payload (`ts`, `instructor`, `text`, `imageUrls`), and a match that is still ambiguous is refused. Covered by `test/unit/answerIdentity.test.mjs`.
- **The offline submit timeout let the same question post twice.** *(Round-one regression.)* Firestore's compat `add()` does not reject when offline — the write sits in the local queue and the promise never settles — so round one handed the Submit button back after 12 s. Pressing it again queued a second document and both flushed on reconnect, putting the same question on the board twice in front of the room. A fingerprint set now refuses only that exact submission while its write is outstanding (`src/student/lib/pendingSubmissions.js`).
- **The client decided session ownership from the wrong field.** The rules decide ownership from `ownerEmail` and nothing else, while the client compared `ownerId` — so the UI could offer owner-only controls whose writes were then refused. `ownerEmail` is now authoritative client-side, with `ownerId` used only when the document has no `ownerEmail` at all (which is precisely when the rules stop looking for an owner). That also fixes a real collision: `emailToId` collapses runs of non-alphanumerics to one underscore, so `a.b@salesforce.com` and `a-b@salesforce.com` both map to `a_b_salesforce_com`, and the name-based fallback id is shared by anyone with the same display name. `ownerId` is now documented as a lookup key, not an identity.
- **Renaming yourself in a pre-backfill session would have been denied outright.** The rename writes `ownerName`, which the new `ownerLabelsOk` guard rejects on a document with no `ownerEmail` — and since it is one multi-field update, that failed the whole rename. It now stamps the caller's **own** verified email (read from Firebase Auth, never from the store or the session document) in that same write, which is the repair path the rules already allow, and migrates the document as a side effect.
- **A latent production bug in `scripts/backfill-owner-emails.mjs`.** It writes `ownerEmail` and `instructorEmails` and never `ownerId` — see the deploy box above. Not a code change; the fix is the deploy order.
- **Salesforce API names no longer render as italics.** Emphasis delimiters are now conservative: `_` may not be flanked by word characters (the CommonMark / Slack rule), and every delimiter must hug non-space text on both sides and stay on one line. `Custom_Field__c` survives verbatim instead of becoming `Custom<em>Field</em>_c`, and arithmetic like `5 * 3` is read as prose. The copy-to-clipboard path uses the same rules, so copied text and rendered text agree on what was markup. Covered by `test/unit/richText.test.mjs` (25 cases).
- **Student search, the votes sort, and the Pinned / Answered / Unanswered filters answered from ten questions.** The student page cache holds only the visible page, so filtering it silently searched one page rather than the session. Those views now go through a new `useFullQuestionCorpus` hook, capped at **300** questions per fetch (plus one probe document, so the truncation flag is exact rather than crying wolf on the boundary) with a **20 s** reuse window so flipping filters cannot turn into a query storm.
- **Upvoting from an older page threw the student back to the newest questions.** The post-vote reconcile called `fetchFirstPage()`, which ends in `setCurrentPage(0)`. Off page 0 it now re-reads just the voted question and patches it where it is cached.
- **Instructor sidebar stat tiles could freeze exactly when the room got busy.** Every change to `questionPages` restarted a 400 ms debounce, and at event scale changes arrived faster than that, so the timer never fired. A max-wait ceiling of 5 s now forces a refresh. A background refresh (60 s, floored at 30 s between runs, skipped on a hidden tab) was also added, because the live listener only watches page 0, so a co-instructor answering an older question used to leave the tiles stale. The hook is annotated as billing-sensitive: each refresh is three `count()` aggregate queries.
- **Smaller correctness and lifecycle fixes.** An impossible date such as 2026-02-31 no longer rolls forward to a real one; a malformed `createdAt` renders as nothing instead of the literal string "Invalid Date"; the student sidebar resizer removes every listener it adds (it previously removed none and gated re-init on a `dataset` flag, so a remount stacked a second unreachable window `resize` listener); the feedback modal cannot double-submit; Enter on the join screen cannot fire a second join; the delete-question modal is a real dialog with focus management and Escape.

### Performance

- **The `emojilib` keyword dataset is now a dynamic `import()` in its own chunk.** Measured on a local `npm run build` with `gzip -9`: the shared chunk `dist/assets/ImageLightbox-*.js` is **1,049,445 bytes raw / 261,403 gzipped**, down from 1,221,887 / 309,892 — about **48.5 kB gzipped off every attendee's critical path**, because that chunk is `modulepreload`ed on both entry points and the new `emoji-en-US-*.js` chunk (174,270 raw / 48,385 gzipped) is not. Glyphs never wait on it: the picker grids are plain string literals, and search matches nothing until the keywords arrive, then backfills and replays the query. A failed fetch costs search only, and a later open retries.
- **The instructor emoji grid fills on first open instead of on mount.** It renders one toolbar per question card plus one per session note, so with `QUESTIONS_PAGE_SIZE` at 10 the page previously ran about eleven full passes over 1,035 glyphs — and built eleven 1,035-button `innerHTML` strings — before first paint, for a panel that is opened at most once. The index is now cached per glyph list and shared by both toolbars.

### Known limitations — deliberately NOT fixed

- **Any verified `@salesforce.com` user can self-join any session, and every session code is enumerable.** Session `read` is `if true`, so the unauthenticated `list` of `sessions` hands out every code; `joiningSelf` then lets any verified Salesforce user add themselves as a co-instructor. Each is defensible alone. Together they mean any Salesforce employee can become co-instructor on any session in the database. Closing the enumeration breaks `scripts/backfill-owner-emails.mjs`, which lists the collection, so this needs a human decision rather than a quiet fix.
- **Sessions still have no closed field set.** Questions use `keys().hasOnly`; sessions do not, so arbitrary fields can be attached to a session document. Left open on purpose: `buildSessionRenameUpdates` spreads stored fields verbatim, so a single unenumerated field already in production would make renaming impossible. This needs a planned migration, not a rules edit.
- **Co-instructor access cannot actually be revoked from the client.** Hiding a name from the roster is all the UI can honestly offer, and it now says so. Access is granted by the verified email in `instructorEmails`, but the roster stores **display names with no link back to the email that joined under them**, so the client cannot tell which address to remove. Real revocation needs a server-side path (Cloud Function) **and** a name-to-email mapping that does not exist in the data model.
- **Notes and answers store `instructor` as a bare display name with no identity link.** This single gap is what blocks co-instructor revocation, byline enforcement in the rules, and rename disambiguation — three separate limitations with one cause. **A stable per-instructor identity on session content is the highest-value follow-up in this list.** It is a schema change.
- **Renaming yourself in a session still reads every question in that session.** Firestore cannot query "the `answers` array contains an entry whose `instructor` is X", so finding past replies means a full-collection read of `sessions/{code}/questions`. The only cheap narrowing is already applied: skip the read entirely when no prior name is left to replace. The reply rewrite is also **not atomic across batches**, which is why the UI offers a retry instead of claiming success.
- **A session with `ownerEmail: ''` has no owner at all under the rules.** An empty string matches no verified email, so `isSessionOwner` is false for everyone, and `ownerName` can then never be written (`ownerEmailPreserved` allows the repair stamp only where the field is *absent*). Degenerate, and prevented going forward, but any document already in that state is unfixable from the client.
- **If the emoji chunk fails to load, search shows "No emoji match"** — indistinguishable from a legitimate empty result. Glyph browsing is unaffected.
- **The healing walk in `src/instructor/hooks/useQuestions.js` has no permanent test.** It was verified with throwaway harnesses. Making it testable means extracting the logic out of the hook.
- **There is no component or E2E test runner, and browser verification was impossible throughout** (Chrome DevTools debugging is blocked by system policy). Every UI change in this set is backed by code review and unit tests only.

### Docs

- **`SETUP.md`: both pasteable permissive rulesets removed.** The guide inlined the original `allow read/create/update: if true` Firestore block and an unauthenticated 4 MB `image/.*` Storage block. A previous pass added "OUT OF DATE" notices above them but left the snippets intact — still a copy-paste footgun, since a reader skimming for a block to paste into the Firebase console would have pasted world-writable rules into a real project. Both sections now point at `firestore.rules` / `storage.rules` as the single source of truth and give the real deploy commands. No rules are inlined, so they cannot go stale again.
- **`SETUP.md`: the name-plus-PIN account model is described accurately instead of flagged.** The PIN model is entirely gone from the codebase (`src/constants/auth.js`, `hashPin`, `login` and `register` were all deleted in this fix set), so the instructions for it were replaced with the current model: Google sign-in, with `firestore.rules` enforcing a verified `@salesforce.com` email, and `ownerEmail` / `instructorEmails` driving session access. The "Future: Salesforce OAuth" section became a list of the Firebase Console setup that is genuinely still required.
- **`SETUP.md`: the GitHub Pages walkthrough is marked retired.** It claimed "this repo ships `.github/workflows/deploy-pages.yml`"; `.github/` does not exist and `git ls-files .github` returns nothing. Step 4 now leads with the real path (manual Firebase Hosting), keeping the host-agnostic "student page has no CSS" troubleshooting.
- **Stale numbers swept out of `CLAUDE.md`, `BACKLOG.md` and `docs/qa-foundation.md`.** Test counts (25 unit / 65 rules → 122 / 87), the shared-chunk measurements, the "emojilib still ships eagerly" claim, the student-vs-instructor emoji-toolbar asymmetry (now fixed on both sides), and the `firestore.rules` line count in `SETUP.md` (403 → 631). `CLAUDE.md` now also states how client-side ownership is decided, and the backfill step in `docs/qa-foundation.md` carries the deploy-order constraint.
- **`README.md`: the Firebase and Fuse.js CDN claim removed.** Two places still said the compat SDK and Fuse load from CDNs. They have been npm dependencies bundled by Vite since 2026-04-22, and the page shells contain no CDN script tags. Predates this fix set; corrected while passing through.
- **`docs/qa-foundation.md`: all gates recorded as run, with exit codes.** `npm run test:unit` was previously counted-but-not-run. The aggregate `npm test` had never been runnable on this machine, because `test:rules` gates it and the Homebrew JDK is keg-only and invisible to `/usr/libexec/java_home` — which is why the rules suite sat unrun for so long.
- **`next-app/` (11 files) changed in this fix set but is still not part of any deploy.** It has never been deployed, and no root gate covers it.

---

## 2026-08-17

### Changed

- **Production domain is now https://session-qa.web.app.** Added a second Hosting *site* (`session-qa`) to the existing **`tdx-qa`** project rather than creating a new project — a `.web.app` address comes from the Hosting site id, so Firestore data, Auth identities, stored image URLs and the App Check registration were all left untouched. **The Firebase project id is still `tdx-qa`.**
- **`tdx-qa.web.app` now 301-redirects** to the new domain, preserving path *and* query string, so links already handed out with a session code keep working. `firebase.json` hosting is now two targets: **`app`** (serves `dist/`) and **`legacy`** (redirect-only, backed by `redirect-site/`).
- **Storage CORS** and the **reCAPTCHA key domain list** gained `session-qa.web.app` and `session-qa.firebaseapp.com`; the old origins stay listed. **Firebase Auth authorized domains** likewise.

### Fixed

- **App Check never actually ran in production.** `VITE_APPCHECK_SITE_KEY` lived only in the untracked `.env.local`, but production is built from a detached worktree of `origin/main` which has no such file — so Vite inlined an empty value and every deploy since App Check was wired shipped with it inactive. The live bundle contained no site key at all; only `UNENFORCED` mode kept the app working, and enabling enforcement would have rejected every client write. The site key is now a committed default in **`src/config/firebase.js`** (it is public by design, like the rest of the Firebase web config), and a Vite plugin **fails the production build** if no key reaches the emitted chunks.
- **Instructor questions panel showed "No questions in this view." while still loading.** `questionPages` starts empty, so the gap between selecting a session and its first snapshot rendered an assertion of emptiness that then corrected itself. Now tracked by `questionsHydrated` and shown as a loading state.
- **Switching sessions briefly rendered the previous session's questions** under the new session's header: the effect reset the page index but left the cached pages in place. Cached pages are now cleared *before* subscribing.
- **A failed questions subscription hung on the loading state.** The `onSnapshot` call had no error callback; it now hydrates on error and surfaces a toast.

### Docs

- Swept `tdx-qa.web.app` → `session-qa.web.app` across README, the domain-change checklist and all three `.claude/skills/` files. **Only public URLs changed — every `--project` flag still says `tdx-qa`**, which is what made the earlier rename attempt (reverted in `96a1a37`) wrong.
- **`CLAUDE.md` corrected**: it described the app as GitHub Pages, vanilla JavaScript and having no auth. It is Firebase Hosting (manual deploy, no CI), React, and Firebase Auth with Google + anonymous. The `.github/workflows/` directory it referenced does not exist.
- **`firestore.rules` header no longer claims App Check is enforced.** It is not. Comment-only change; rule logic is byte-identical to the deployed ruleset.

---

## 2026-04-23

### Added

- **Student sidebar:** **Session** details are **above** **Session stats**; footer with short copy + envelope control opens **Dashboard feedback** (subject + body). Submits an **anonymous** Firestore doc under **`sessions/{code}/sessionFeedback`**; instructors see it under **Dashboard feedback** (see **`firestore.rules`**). No mail client and no reply path.

### Changed

- **Question pagination:** Firestore page size is **10** questions per page (was 25), via **`QUESTIONS_PAGE_SIZE`** in **`src/constants/app.js`** (student + instructor).

### Docs

- **README** and **SETUP.md:** GitHub Pages deploy walkthrough (**Option B — GitHub Actions**): enable Pages from Actions, branch **`main`**, bookmark URLs for hub / `student.html` / `instructor.html`, Storage CORS note, optional **`VITE_*`** secrets.
- **SETUP / README:** Troubleshooting when **`student.html` has no CSS** — usually **Pages → Source** is **Deploy from a branch** (publishes raw repo HTML with `/src/…`) instead of **GitHub Actions** (publishes **`dist/`** with `./assets/…`).
- **GitHub Actions:** After **`npm run build`**, verify **`dist/student.html`** references **`./assets/`** and not **`/src/student/main.js`** before uploading the Pages artifact.

### Student

- **Instructor notes byline:** each note card shows the **instructor display name** who saved that card (same string model as answer attribution: `instructor` on each `sessionNotes` item).
- **Instructor notes:** single **Instructor notes** pill on the filter row (after **Most votes**); toggles the main feed between Q&A and notes only (no **custom-named** link list — plain https links still show as hostname/path so the control stays available for link-only cards).
- **Instructor notes visibility:** toggle stays in sync with Firestore even when the notes list node is missing on first paint; **https links** count as visible note content again.
- **Toolbar:** solid-blue “active” styling applies only to **All / Pinned / Unanswered / Answered** (`data-filter`); **Most votes** / **Instructor notes** use the same solid fill when on, with a **Sort** label so it is clear sort is separate from status (both can be active at once).
- **Toolbar layout:** **Sort** label on the **far left**, then All / Pinned / Unanswered / Answered / Most votes in one row; separator and **Instructor notes** follow.
- **Session sidebar (student):** date/time line supports **Firestore `Timestamp`** (and `{ seconds }` shapes), not only plain strings, so updates from the host show correctly after **Save session info**; when **`sessionTimezone`** is set, the line ends with a short zone label (e.g. **PDT**) from **`Intl`**.
- **Session date (instructor + student):** `<input type="date">` values (`YYYY-MM-DD`) are parsed as **local calendar dates** when saving and when filling the form — avoids the common off-by-one day bug from `new Date("YYYY-MM-DD")` (UTC midnight) vs `toLocaleDateString`.
- **Instructor notes toggle:** `sessionNotes: []` again merges **legacy** `sessionNoteTitle` / `Body` / images when present so the pill is not stuck hidden; **http://** links count for visibility (student list shows them as text; only **https** is clickable).
- **Instructor notes visibility:** title/body treat **HTML / `&nbsp;`** as empty when there is no real text, so rich-but-empty notes do not fake “has content”; non-**https** image URLs still open via a text link on the student card.
- **Instructor notes pill:** shown whenever **Show in student dashboard** is on (`sessionNoteShow !== false`), even if the host has not saved any note cards yet — notes panel shows a short empty state until content exists.
- **Sort:** **Most recent** control removed; **Most votes** is one toggle on the same row as All / Pinned / Unanswered / Answered (off = newest first). **Top pagination** moved **below** the filter row.

### Instructor

- **Session timezone:** **Session settings** and **Create session** include a **timezone** dropdown (stored as IANA **`sessionTimezone`** on `sessions/{code}`; default **America/Los_Angeles**). Options live in **`src/lib/sessionTimezones.js`**.
- **Session date save:** **Save session info** / **Create session** store **`sessionDate`** using **`YYYY-MM-DD` → local calendar** (see **Session date** under Student) so the value matches the date picker in all timezones.
- **Session form:** **Date / time** fields load correctly when Firestore returns **`Timestamp`** (not only strings), so saving session info does not wipe or distort values read back from the server.
- **Session notes attribution:** new cards record **`instructor`** (signed-in instructor name); edits preserve the existing author unless the note predates the field (then the next save assigns the current editor). Editor header shows **Added by …**; students see the same name on each card.
- **Instructor Notes** sidebar label (replaces “Important”); **Show in student dashboard** checkbox copy.
- **Edit** saved answer text/images on a thread.

---

## 2026-04-22

### Fixed

- **Firebase Storage CORS:** **`storage-cors.json`** now allows **Vite** dev origins **`http://localhost:5173`** / **`http://127.0.0.1:5173`** and **`vite preview`** **`:4173`** (uploads were blocked when only older ports like `:8765` were listed). You must still run **`gsutil cors set storage-cors.json gs://YOUR_BUCKET`** after editing. Student image upload errors that look like CORS/network now point at SETUP.

### Changed

- **Student + instructor stats:** Sidebar **Session stats** / **Overview** with a **scope hint**. **Total**, **Answered**, **Pending**, and **Pinned** (and instructor filter count badges) use **Firestore aggregate `count()`** queries on `sessions/{id}/questions` so numbers are **session-wide**, not tied to how many pages you have opened. The question list still loads in pages. **Dependency:** `firebase` npm package.
- **Fixed:** Session-wide counts always fell back to “loaded only” because **CDN compat** and **npm modular** did not share one app. Firebase compat is now initialized from **`src/lib/firebaseCompat.js`** (bundled with Vite); **HTML no longer loads Firebase from jsDelivr**. Modular `getApp()` / `getFirestore()` then match compat `firebase.firestore()`. If aggregates still fail (offline, rules, missing index), the hint explains the cache fallback.
- **Pagination:** **Next** / phantom page respects an **end-of-list** flag when an older fetch returns no documents (fixes sessions with exactly `QUESTIONS_PAGE_SIZE`, `2×`, … questions). **Instructor demo:** Reselecting the demo session repopulates questions after the shared session reset; demo stats stay client-side from sample data.
- **Instructor card actions:** **Answered verbally** and **Mark pending** are always **two buttons** (not one toggled slot). Order: **Save answer** → **Answered verbally** → **Pin** → **Mark pending** → **Delete** (Mark pending sits left of Delete).
- **Student + instructor sidebar resizer:** Strip is **8px** wide with **`overflow: hidden`** / min-max width so it stays a thin divider. The **chevron** on the strip was removed; **double-click** the strip toggles hide/show (keyboard on the focused separator unchanged). `title` / `aria-label` mention double-click.
- **“Answered verbally” badge styling:** **Teal** background/text (`.badge-answered-verbal`); green **Answered** unchanged. Removed the inset **box-shadow** that read as an extra border.
- **Instructor demo sample:** One answered question includes **`answeredVerbally: true`** plus text so the dual-badge case is visible in demo mode.
- **Survey shortcut (session):** Instructors set **`studentSurveyUrl`** and **`studentSurveyCopyText`** (survey ID) under Session settings. Students see **SURVEY** on the **Session** card with survey ID helper text; click opens **https** in a new tab and copies the ID. Hub-only copy/open controls were removed in favor of this.

### Added

- **`src/lib/answeredBadge.js`:** Status badges for answered questions. Optional Firestore boolean **`answeredVerbally`** on `sessions/{code}/questions/{id}` is set when the instructor uses **Answered verbally**; cleared when marking **pending** (or when the last answer is removed and the thread returns to pending). Verbal mark plus a written/image answer can show **both** **Answered verbally** and **Answered** pills. Older rows without the flag still infer one verbal-style pill when answered with no in-app reply text or images.

---

## 2026-04-21

### Fixed

- **Student join (`code-input`):** Split **`SQA-`** + suffix field; see **`src/lib/sessionCode.js`**.

### Documentation

- **`README.md` / `SETUP.md`:** Dev server note — **`/`** is the link hub (`index.html`); student and instructor apps are at **`/student.html`** and **`/instructor.html`**.

---

## 2026-04-20

### Added

- **Vite build:** `package.json` + `vite.config.js` multi-page app (`student.html`, `instructor.html`). Shared code under **`src/`** — `config/firebase.js` (optional `VITE_FIREBASE_*` overrides), `constants/` (pagination, poll interval, image limits, PIN pepper), `lib/` (`richText`, `toast`, `formatQuestionWhen`, Fuse-powered **`questionSearch`**), and **`src/instructor/instructorApp.js`** / **`src/student/studentApp.js`** (existing behavior, `globalThis` exports for `onclick` handlers). Styles extracted to **`src/styles/instructor.css`** and **`src/styles/student.css`**. **`scripts/`** contains small HTML rewrite helpers used while migrating.
- **`npm run dev`** / **`npm run build`**; production output **`dist/`** with **`base: './'`** so assets resolve on GitHub Pages subpaths. **`node_modules/`** and **`dist/`** gitignored.
- **`index.html`:** Vite dev (and **`dist/`** after build) serves **`/`** as a short hub with links to **`student.html`** and **`instructor.html`**, since this repo has no single-page app root.

### Documentation

- **`README.md` / `SETUP.md`:** Document Vite dev/build and hosting **`dist/`**.

### Fixed

- **`instructor.html` / `student.html`:** Default **`#app-screen`** to **`style="display:none"`** so the main shell does not appear above the login/join UI before bundled CSS loads (avoids seeing both at once in dev or on a slow connection).

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

### Changed

- **Class name removed** from instructor session UI, create modal, saves, and student titles (only **session name** is used). Saving session info deletes legacy **`className`** on the Firestore session document.
- **Join session (student + instructor):** split row — fixed **`SQA-`** label plus a suffix field (no more deleting the prefix or caret jumps). Paste **`TDX-…`** to switch to legacy full-code mode (label hides). **`src/lib/sessionCode.js`** owns sync + `buildSessionCodeFromJoinRow` / `setJoinRowFromSessionCode`.
- **Student Instructor Notes:** moved out of the Session sidebar; students open notes via the **Instructor notes** control on the filter row (see **2026-04-23** for current toggle + layout).
- Instructor help copy for session sidebar aligned with formatting capabilities.

### Added

- **Multiple session sidebar notes:** Instructors can add several independent note cards (title, body with formatting toolbar, image URLs, per-note visibility). **Drag the handle (⠿)** to reorder before saving. Stored as `sessionNotes` on `sessions/{code}` (capped at 15). Students see each note as its own card when the notes feed is open. **Legacy** single `sessionNoteTitle` / `sessionNoteBody` / `sessionNoteImageUrls` still works when `sessionNotes` is absent. Shared helpers in **`src/lib/sessionNotes.js`**.
- **Named links** on each session note (instructor editor + Firestore): optional **https** URL plus optional **display name** (capped per note in **`sessionNotes.js`**); not listed separately on the student board (body links still render).
- **Student layout:** Session sidebar is **resizable** (drag the strip between feed and sidebar), **collapsible** via the **chevron** control, width persisted in **`localStorage`**. Below **768px** the layout stacks and the resizer is hidden. The strip shows subtle **‹ ›** hints for drag direction.
- **Instructor layout:** Left **My sessions** sidebar matches the same **drag / chevron / keyboard** resize and collapse behavior (persisted separately; hidden below **900px**).
- **Instructor session notes:** Each note card can be **collapsed** (▼) to save space; **+ Add note** collapses all existing cards and opens the new one expanded.
- **OrgClaim + Survey on student Session card:** **`studentOrgClaimUrl`** (defaults to **`http://sfdc.co/OrgClaim`**) and **`studentOrgClaimCopyText`**; **OrgClaim** above **SURVEY** and always visible; empty OrgClaim code leaves **OrgClaim Code:** with no text after it. Survey ID / https rules unchanged for **SURVEY** (no Survey ID substitute for OrgClaim).
- **Create session modal:** **+ New session** includes the same core fields as **Session settings** (session name, date/time, room, description, OrgClaim link/code, survey link/ID). After **Create session**, the sidebar form is filled from the saved document so you can continue editing without retyping.
- **Slack-style rich text** (rendered safely after escape): `*bold*`, `_italic_`, `~strikethrough~`, `` `inline code` ``, fenced ` ``` ` code blocks, Unicode emojis, auto-linked `https://` URLs.
- **Where it applies:** Session “Important” note, question bodies, and instructor answers on both pages; instructor session sidebar message and per-question answer boxes (delegated clicks), and student-view demo ask/edit.
- **Format toolbars:** Buttons insert markers around the selection (or placeholder text) on student ask + edit modal; instructor session sidebar message, per-question answer boxes, and student-view demo ask/edit.

---

## Earlier (pre-changelog)

Shipped features already described in **`README.md`** (roadmap / stack) include question pagination (10 per page), student polling, instructor live listener on the newest page, and answer draft preservation.

When in doubt, compare **`git log`**.
