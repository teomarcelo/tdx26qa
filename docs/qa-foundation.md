# QA — Firebase Auth Security Foundation (Phase 1)

Local-only verification for the auth/security foundation. **Nothing here is
deployed or pushed.** `firestore.rules` is edited as a file only; it becomes
live only when a human runs `firebase deploy --only firestore:rules` later.

Environment note (corrected 2026-08-17): an earlier revision of this document
said this machine had **no JDK ≥ 21** and that the Firestore emulator (and
therefore `npm run test:rules`) could not run here. That was false. Homebrew's
`openjdk` 26.0.2 was installed at `/opt/homebrew/opt/openjdk` the whole time.
Two things hid it:

- The Homebrew `openjdk` formula is keg-only, so it never symlinks `java` onto
  the default PATH.
- It registers no JVM bundle in `/Library/Java/JavaVirtualMachines`, which is
  the only place `/usr/libexec/java_home` looks. So `java_home` reports "Unable
  to locate a Java Runtime" while a working JDK sits in the Cellar.

On top of that, the only `java` on PATH is a Salesforce policy shim that prints
a guidance message and **exits 0 without printing a version**, which is why a
naive `java -version` probe reads as success. Two exports before the suite are
the whole fix: see "How to run the rules tests" below. Do not install another
JDK.

## Per-step smoke tests + results

Legend:
- ✅ pass: a command was run and its exit code checked.
- 📖 code-reviewed, not executed: the code was read, nothing was run.
- 🟡 partial: verified as far as the local env allows.
- ⛔ blocked.

The 📖 marker was applied retroactively. Every item below that this document
does not record as backed by an actual command (`npm run build`, the lint check,
the backfill dry run, `npm run test:rules`) is code review, so it is now marked
📖 rather than ✅. Where it was ambiguous whether something was executed, it was
marked 📖, which is the conservative choice.

### 1. auth-sdk — `firebase/compat/auth` + guarded App Check + `src/lib/auth.js`
- [x] `npm run build` clean. ✅
- [x] Lint clean on edited files. ✅
- [x] `firebase.auth()` resolves (imported in `firebaseCompat.js`; `getAuth()` returns it). 📖
- [x] App Check init is skipped when `VITE_APPCHECK_SITE_KEY` is unset (logs a one-line notice), initializes when set. 📖 (code path; needs a real key to fully exercise)
- [x] Demo / no-config path does not crash (every helper no-ops when `getAuth()` is null). 📖
- Result: 🟡 partial. Build and lint pass as commands. The auth wiring itself was
  read, not exercised at runtime.

### 2. instructor-signin — real Google sign-in, drop spoofable `sso_*`
- [x] `?sso_name` / `?sso_email` are no longer read anywhere (grep clean). ✅ (grep)
- [x] `onAuthStateChanged` sets identity from a verified Google user (email-keyed ownerId), ignores anonymous sessions. 📖 (round two: that id is a **session-lookup key**, not the ownership identity — ownership is decided from `ownerEmail`, see `instructorOwnsSession`)
- [x] "Continue with Google" button calls `signInInstructorWithGoogle()`; provider-disabled surfaces a clean message, no crash. 📖 (error mapping in `friendlyAuthError`)
- [x] Editable display-name field retained; demo mode retained; name-only fallback retained. 📖
- [x] `logout` calls `firebase.auth().signOut()` then clears local state. 📖
- [ ] Live popup sign-in ⛔ requires Google provider enabled + authorized domain in the console (not available locally).
- Result: 🟡 partial. Code paths in place and build/lint clean; live popup needs console setup (see human steps).

### 3. student-anon — silent anonymous auth before writes; `authorUid` + uid voters
- [x] `ensureAnonymousStudent()` called on student session start/join, and before each write (AskBox, upvote, feedback). 📖
- [x] New questions stamp `authorUid = auth.currentUser.uid` (kept `authorId` for continuity). 📖
- [x] Upvote uses uid-based voter (falls back to legacy id); "voted" highlight recognizes both. 📖
- [x] Feedback payload shape unchanged (exact 3 keys) so it still passes the *currently-deployed* rules. 📖
- [x] Demo unaffected (no `db`, helpers no-op). 📖
- [ ] Live anonymous sign-in ⛔ requires Anonymous provider enabled in the console.
- Result: 🟡 partial. Code complete, build/lint clean; live anon sign-in needs console setup.

### 4. ownership-fields — `ownerEmail` on create; `instructorEmails` on join
- [x] Create persists `ownerEmail` (lowercased verified email) + seeds `instructorEmails: [ownerEmail]`. 📖
- [x] Join appends the joiner's verified email via `arrayUnion` (plus roster display name). 📖
- [x] Per-session display names still work (roster logic unchanged). 📖
- [x] Legacy/existing sessions still load (fields are additive). 📖
- Result: 🟡 partial. Build and lint pass as commands; the field behaviour itself
  was read, not run. The rules suite (step 5) now covers `ownerEmail` and
  `instructorEmails` enforcement end to end against the emulator.

### 5. rules-rewrite — target rules shape (FILE ONLY, not deployed)
- [x] Rewritten to require auth; instructor writes require verified `@salesforce.com`; students edit own by uid; upvotes for any signed-in user; deletes instructor-only; legacy docs tolerated. 📖
- [x] Automated tests written in `test/firestore.rules.test.mjs` (**53 cases**) and
  `test/storage.rules.test.mjs` (**12 cases**). ✅ (counted with
  `grep -c "^test(" test/firestore.rules.test.mjs` and the same for the storage file
  on 2026-08-17; both files grow as fixes land, so re-count rather than trusting
  these numbers)
- [x] `npm run test:rules` executed against the emulators: **65 tests, 65 pass, 0 fail**,
  exit code 0, duration 2.57s. ✅
- Result: ✅ pass. The suite went green on its first run once `JAVA_HOME` was
  exported, with no code changes and no pre-existing failures. The earlier ⛔ on
  this line was wrong: the blocker was a PATH problem, not a missing JDK. The
  rules file is still **not deployed**.

  The run prints many `PERMISSION_DENIED` and `evaluation error` lines. That is
  expected and correct: they are the `assertFails` cases being properly denied.
  Read the `ℹ pass` / `ℹ fail` summary at the end, not the noise above it.

### 6. app-check — env-guarded init (implemented in step 1)
- [x] Key unset → init skipped, app runs. 📖
- [x] Key set → `firebase.appCheck().activate(ReCaptchaV3Provider)` (optional debug provider via `VITE_APPCHECK_DEBUG`). 📖 (needs a real reCAPTCHA v3 key to fully exercise)
- Result: 🟡 partial. Code complete; real key required to see a token minted.

### 7. realtime-reads — `onSnapshot` for the student feed, polling removed
- [x] Page 0 is a live `onSnapshot` listener; `setInterval` polling removed. ✅ (`grep -rn "STUDENT_POLL_MS" src/` returns nothing on 2026-08-17; `src/student/hooks/useQuestions.js:245` attaches the listener)
- [x] Pagination/cache preserved: older pages still fetched via cursor `.get()`; returning to page 0 shows the freshest snapshot and drops stale older pages. 📖
- [x] Listener errors fall back without breaking the feed (cached data left in place). 📖
- [x] Demo mode (no `db`) still works (no listener attached; store drives the board). 📖
- [ ] Live "new question appears without refresh" ⛔ needs a live Firestore session to watch end-to-end.
- Result: 🟡 partial. Implemented and build-clean; live visual confirmation needs a running session.

### 8. backfill-script — `scripts/backfill-owner-emails.mjs`
- [x] Defaults to `--dry-run`; prints intended writes and changes nothing. ✅ (ran against prod read-only: 8 sessions listed, `Summary: ... Dry run only — no documents were modified`)
- [x] Resolves `ownerEmail` from `OWNER_EMAIL_MAP` (by code or ownerId); unresolved sessions are reported and skipped (never guessed). ✅ (verified a mapped code produced a correct `set {...}` line)
- [x] Real writes require the explicit `--commit` flag; supports emulator via `FIRESTORE_EMULATOR_HOST`. 📖 (flag gating read in the source; `--commit` not run)
- Result: ✅ pass (dry-run verified end-to-end; `--commit` intentionally not executed).

## Final gates

All four gates were **run end to end on the complete fixed tree on 2026-08-17**,
in one shell with `JAVA_HOME` exported (see "How to run the rules tests"). Every
number below is from that run's stdout and its captured `$?`; nothing here is
counted-but-not-run any more.

| Gate | Exit code | Result |
| --- | --- | --- |
| `npm run lint` | **0** | `eslint .` clean — no warnings, no errors, no output |
| `npm run test:unit` | **0** | **122 tests, 122 pass, 0 fail**, 0 skipped |
| `npm run build` | **0** | vite build clean |
| `npm test` (aggregate) | **0** | lint clean → unit **122/122** → rules **87/87, 0 fail** |

Numbers re-verified on 2026-08-17 against the finished audit fix set (rounds one
and two) in the working tree.

Notes on the numbers:

- `npm run test:unit` runs `node --test test/unit/*.mjs`. Eight files now match
  that glob, not one: `richText` (25), `sessionRename` (34),
  `fullQuestionCorpus` (17), `emojiData` (13), `emojiDataOffline` (3),
  `answerIdentity` (11), `pendingSubmissions` (10), `sessionNotesDraft` (9) —
  122 counted, 122 executed, 122 passed.
- The rules suite is **87 pass / 0 fail** (75 Firestore + 12 storage), up from 65
  as the rules grew. `firestore.rules` is now 631 lines, from 313.
- `npm run build` still emits the oversized-chunk warning for
  `dist/assets/ImageLightbox-*.js` (**1,049,445 bytes raw / 261,403 gzipped**,
  `gzip -9`). That is the known first-paint item in
  [`BACKLOG.md`](../BACKLOG.md), not a build failure — exit code is 0. The
  `emojilib` dataset is no longer inside it: it builds as its own
  non-preloaded `dist/assets/emoji-en-US-*.js` (174,270 / 48,385).

**The aggregate `npm test` had never been runnable on this machine before the
hidden-JDK workaround was found, and that is the whole reason the rules suite sat
unrun for so long.** `npm test` is `lint && test:unit && test:rules`, so the
rules step gates the entire command: with no usable `java` on PATH the emulator
could not boot, `test:rules` failed, and `npm test` failed with it — which made
the one command that checks everything look permanently broken. Lint, unit tests
and build were individually runnable the whole time, so the *only* missing piece
was the two `export` lines. There was never a missing JDK (see the environment
note at the top of this file).

- `ReadLints` on all edited/new files: ✅ no errors introduced.

## How to run the rules tests (needs the emulator)
1. Point `JAVA_HOME` at the Homebrew JDK and put it first on PATH. **Do not
   install another JDK.** One is already here (see the environment note at the
   top), it is just keg-only and invisible to `java_home`. Installing the Zulu
   cask also needs an interactive sudo password, so it is a wall as well as a
   waste of time.
   ```bash
   export JAVA_HOME=/opt/homebrew/opt/openjdk
   export PATH="$JAVA_HOME/bin:$PATH"
   ```
   Confirm with `java -version`. It must print `openjdk version "26.0.2"`. If it
   prints the Salesforce "supported Java platform" guidance message instead, the
   policy shim is still first on PATH and the exports did not take.
2. From the repo root:
   ```bash
   npm run test:rules
   ```
   This runs `firebase emulators:exec --only firestore,storage --project demo-session-qa "node --test test/*.mjs"`,
   which boots the Firestore **and Storage** emulators, runs
   `test/firestore.rules.test.mjs` and `test/storage.rules.test.mjs` against
   them, and shuts the emulators down. No production project is touched
   (throwaway `demo-*` project id).
3. Ignore the `PERMISSION_DENIED` and `evaluation error` lines in the output.
   They are the `assertFails` cases being correctly denied. The `ℹ pass` /
   `ℹ fail` summary at the end is the result.

## `npm run dev` expectations (manual)
- Instructor page: "Continue with Google" opens the Google popup **only if** the
  Google provider is enabled and the domain is authorized in the Firebase
  Console. Until then it shows a clear error ("Google sign-in is not enabled…")
  and demo mode still works.
- Student page: silent anonymous sign-in happens on load **only if** the
  Anonymous provider is enabled. If disabled, writes fall back to the legacy
  localStorage id and still succeed under the *currently-deployed* permissive
  rules.
- Automated confidence comes from the build, lint, dry-run backfill, and the
  (emulator-run) rules tests — not from the popup, which needs console setup.

## Human-only steps still required (for manual testing + deployment)
1. Firebase Console → Authentication → Sign-in method: **enable Google** and
   **enable Anonymous**.
2. Authentication → Settings → **Authorized domains**: add the production domain
   (and `localhost` for local testing).
3. App Check → register the web app with **reCAPTCHA v3**, then set
   `VITE_APPCHECK_SITE_KEY` in `.env`. Keep App Check in *monitor* mode first,
   then *enforce* on Firestore.
4. Deploy in order, only when you say so: **hosting (the client) first**
   (`npx firebase-tools deploy --only hosting:app --project tdx-qa`), then the
   rules (`--only firestore:rules`, then `--only storage`). Full sequence and the
   reasoning are in [`CHANGELOG.md`](../CHANGELOG.md) under the unreleased audit
   fix set.
5. **After hosting is live**, run the backfill with real emails, preview then
   commit:
   ```bash
   OWNER_EMAIL_MAP='{"SQA-XXXX":"owner@salesforce.com", ...}' node scripts/backfill-owner-emails.mjs        # preview
   OWNER_EMAIL_MAP='{...}' node scripts/backfill-owner-emails.mjs --commit                                  # apply
   ```
   Order matters: the script writes `ownerEmail` / `instructorEmails` and **never
   `ownerId`**, and only the new client reads `ownerEmail` to decide ownership, so
   running it against the old client leaves a backfilled session looking
   ownerless on screen. Run the `--commit` before App Check enforcement, or
   against the emulator, or with an Admin SDK service account.
6. (Optional, later phases) Upgrade to Blaze for Cloud Functions; create the
   Slack app + IT approval; add an Auth blocking function to hard-reject
   non-salesforce sign-ins.
