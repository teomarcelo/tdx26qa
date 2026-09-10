/**
 * Unit tests for the per-session instructor rename.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * The rename rewrites content by matching display-name strings, so who is allowed
 * to be rewritten is load-bearing: a co-instructor's rename used to move the
 * session's `ownerName` and re-attribute the owner's notes and past replies to the
 * co-instructor, live, mid-workshop.
 *
 * Who counts as the owner is therefore tested first, on its own. It has to be the
 * same answer firestore.rules gives, since the rules are what actually accept or
 * refuse the write — see the instructorOwnsSession block below.
 *
 * useInstructorAuth.js is a browser module, so react, the Firebase context and the
 * auth wrapper are stubbed through module hooks. Everything under test — the plan
 * helper and renameInSession itself — is the real source on disk.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', '..', 'src');

function stub(code) {
  return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true };
}

const REACT_STUB = `
const noop = () => {};
export const useCallback = (fn) => fn;
export const useMemo = (fn) => fn();
export const useRef = (v) => ({ current: v });
export const useEffect = noop;
export const useLayoutEffect = noop;
export const useDebugValue = noop;
export const useState = (v) => [v, noop];
export const useSyncExternalStore = (sub, get) => get();
export const createContext = () => ({ Provider: null, Consumer: null });
export const useContext = () => ({});
export const createElement = () => null;
export default { useCallback, useMemo, useRef, useEffect, useLayoutEffect, useDebugValue, useState, useSyncExternalStore, createContext, useContext, createElement };
`;
const FIREBASE_CONTEXT_STUB = `
export const useFirebase = () => globalThis.__testFirebase || { db: null, storage: null };
export const FirebaseProvider = null;
`;
// ensureInstructorAuth is the ONLY source the rename may take an email from, so
// the stub is driven by a global the tests set: null models "no verified
// salesforce.com identity", an object models a signed-in one.
const AUTH_STUB = `
export const currentUser = () => null;
export const signOutInstructor = async () => {};
export const ensureInstructorAuth = async () => globalThis.__testInstructorUser || null;
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react') return stub(REACT_STUB);
    if (specifier.endsWith('FirebaseContext.jsx')) return stub(FIREBASE_CONTEXT_STUB);
    if (specifier.endsWith('/lib/auth.js')) return stub(AUTH_STUB);
    return nextResolve(specifier, context);
  },
});

const { resolveSessionRenamePlan, instructorOwnsSession, emailToId, resolveInstructorIds, useInstructorAuth } =
  await import(pathToFileURL(resolve(SRC, 'instructor/hooks/useInstructorAuth.js')).href);
const useInstructorStore =
  (await import(pathToFileURL(resolve(SRC, 'instructor/store/useInstructorStore.js')).href)).default;

// --- Fixtures: Alex Kim owns the session, Sam Rivera co-instructs it. ---
const OWNER_ID = 'alex_kim_salesforce_com';
const CO_ID = 'sam_rivera_salesforce_com';
const OWNER_EMAIL = 'alex.kim@salesforce.com';
const CO_EMAIL = 'sam.rivera@salesforce.com';

function session(over = {}) {
  return {
    id: 'SQA-TEST',
    ownerId: OWNER_ID,
    ownerEmail: OWNER_EMAIL,
    ownerName: 'Alex Kim',
    instructors: ['Alex Kim', 'Sam Rivera'],
    instructorNames: 'Alex Kim, Sam Rivera',
    sessionNotes: [
      { id: 'n1', instructor: 'Alex Kim' },
      { id: 'n2', instructor: 'Sam Rivera' },
    ],
    ...over,
  };
}

/**
 * A pre-migration session: created before email-based ownership, so the field the
 * Firestore rules identify the owner by has never existed on it. The client still
 * recognises the owner, by ownerId.
 */
function legacyDoc(over = {}) {
  const doc = session(over);
  delete doc.ownerEmail;
  return doc;
}

/**
 * A pre-migration session that scripts/backfill-owner-emails.mjs has since
 * stamped: it now has the ownerEmail the rules identify the owner by, while its
 * ownerId is still the old NAME-derived one. Nothing migrates ownerId, so this is
 * the shape where the two notions of ownership disagree most sharply.
 */
function backfilledDoc(over = {}) {
  return session({ ownerId: 'alex_kim', ...over });
}

// The caller's verified email is what decides ownership on any document that has
// an ownerEmail, so every identity below needs one. It is derived from the ownerId
// the test is already passing, and any test where the two must disagree passes
// `email` itself.
const EMAIL_FOR_ID = { [OWNER_ID]: OWNER_EMAIL, [CO_ID]: CO_EMAIL };

const identityFor = ({ ownerId, legacyOwnerId = null, email }) => ({
  ownerId,
  legacyOwnerId,
  email: email === undefined ? (EMAIL_FOR_ID[ownerId] || null) : email,
});

const plan = ({ ownerId, legacyOwnerId, email, ...rest }) =>
  resolveSessionRenamePlan({ identity: identityFor({ ownerId, legacyOwnerId, email }), ...rest });

// ── instructorOwnsSession ───────────────────────────────────────────────────
// Who the client calls the owner has to be who firestore.rules calls the owner,
// or the dashboard offers owner-only controls whose writes are then refused (and,
// in the other direction, hides them from the real owner). isSessionOwner() in
// the rules reads `ownerEmail` and nothing else, so these pin the client to the
// same field, and pin the ownerId fallback to the one case the rules also fall
// back on: a document with no ownerEmail (legacySession()).

const owns = (doc, identity) => instructorOwnsSession(doc, identityFor(identity));

test('ownership on a document with an ownerEmail is decided by that email', () => {
  assert.equal(owns(session(), { ownerId: OWNER_ID }), true);
  assert.equal(owns(session(), { ownerId: CO_ID }), false);
});

test('a backfilled document: the owner is recognised by email even though ownerId never migrated', () => {
  const doc = backfilledDoc();
  assert.notEqual(doc.ownerId, OWNER_ID, 'the fixture must actually disagree, or this proves nothing');
  assert.equal(owns(doc, { ownerId: OWNER_ID }), true);
});

test('a namesake does not inherit a backfilled session through the name-derived id', () => {
  // resolveInstructorIds hands the name-based id to anyone whose Google display
  // name matches, as legacyOwnerId. On a backfilled doc that id IS the owner's.
  const namesake = resolveInstructorIds({ email: CO_EMAIL, name: 'Alex Kim' });
  const doc = backfilledDoc();
  assert.equal(namesake.legacyOwnerId, doc.ownerId, 'the id collision is the premise here');
  assert.equal(
    owns(doc, { ownerId: namesake.ownerId, legacyOwnerId: namesake.legacyOwnerId }),
    false,
    'ownerEmail disambiguates them, so the display-name collision must not grant ownership'
  );
});

test('the emailToId collision does not grant ownership when ownerEmail can tell them apart', () => {
  // emailToId collapses runs of non-alphanumerics, so these two distinct people
  // share one client-side id. Only ownerEmail separates them.
  const REAL = 'a.b@salesforce.com';
  const OTHER = 'a-b@salesforce.com';
  assert.equal(emailToId(REAL), emailToId(OTHER), 'the collision is the premise here');

  const doc = session({ ownerId: emailToId(REAL), ownerEmail: REAL });
  assert.equal(owns(doc, { ownerId: emailToId(REAL), email: REAL }), true);
  assert.equal(
    owns(doc, { ownerId: emailToId(OTHER), email: OTHER }),
    false,
    'the shared ownerId must not make a-b@ the owner of a.b@\u2019s session'
  );
});

test('a legacy document with no ownerEmail still falls back to the ownerId match', () => {
  const doc = legacyDoc();
  assert.equal(owns(doc, { ownerId: OWNER_ID }), true);
  assert.equal(owns(doc, { ownerId: CO_ID }), false);
  // The fallback is the whole reason legacyOwnerId still exists.
  assert.equal(owns(legacyDoc({ ownerId: 'alex_kim' }), { ownerId: OWNER_ID }), false);
  assert.equal(
    owns(legacyDoc({ ownerId: 'alex_kim' }), { ownerId: OWNER_ID, legacyOwnerId: 'alex_kim' }),
    true
  );
});

test('demo mode owns the demo session with no verified email anywhere', async () => {
  const { DEMO_SESSION, DEMO_INSTRUCTOR_OWNER_ID } =
    await import(pathToFileURL(resolve(SRC, 'lib/demoData.js')).href);
  assert.ok(!('ownerEmail' in DEMO_SESSION), 'demo ownership depends on there being no ownerEmail');
  assert.equal(
    owns(DEMO_SESSION, { ownerId: DEMO_INSTRUCTOR_OWNER_ID, email: null }),
    true
  );
});

test('an identity with no email yet is not the owner of a document that has an ownerEmail', () => {
  // The shape InstructorApp holds between its first-mount name restore and
  // onAuthStateChanged. It renders AuthRestoring, not the Dashboard, so this is
  // never on screen — but if that gate ever moves, "not the owner" is the safe
  // answer rather than owner-only controls backed by no token.
  assert.equal(owns(session(), { ownerId: OWNER_ID, email: null }), false);
  assert.equal(instructorOwnsSession(session(), undefined), false);
  assert.equal(instructorOwnsSession(undefined, identityFor({ ownerId: OWNER_ID })), false);
});

test('an ownerEmail that is present but identifies nobody makes nobody the owner', () => {
  // Mirrors the rules: `'ownerEmail' in data` is true, so legacySession() is
  // false and there is no ownerId fallback, while isSessionOwner() cannot match
  // an empty or non-string value. Every ownerName write on such a doc is denied.
  for (const bad of ['', null]) {
    assert.equal(owns(session({ ownerEmail: bad }), { ownerId: OWNER_ID }), false);
    assert.equal(owns(session({ ownerEmail: bad }), { ownerId: CO_ID }), false);
  }
});

test('the caller\u2019s own address is normalised for the comparison, the stored one is not', () => {
  // verifiedEmail() in the rules lowercases the token and compares it to the
  // stored value verbatim, so this has to match that asymmetry exactly.
  assert.equal(owns(session(), { ownerId: OWNER_ID, email: '  Alex.KIM@Salesforce.com  ' }), true);
  assert.equal(
    owns(session({ ownerEmail: 'Alex.Kim@salesforce.com' }), { ownerId: OWNER_ID }),
    false,
    'a mixed-case stored value is one the rules would reject too'
  );
});

// ── resolveSessionRenamePlan ────────────────────────────────────────────────

test('owner renaming themselves moves the owner label and both of their names', () => {
  const p = plan({
    session: session(),
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
  });
  assert.equal(p.status, 'ok');
  assert.equal(p.isOwner, true);
  assert.equal(p.renameOwnerLabel, true);
  assert.deepEqual(p.oldNames, ['Alex Kim']);
});

test('owner who never set a per-session name still rewrites their global one', () => {
  const p = plan({
    session: session({ ownerName: 'Alex Kim' }),
    currentInstructor: 'Alex from Trailhead',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
  });
  assert.deepEqual(p.oldNames, ['Alex Kim', 'Alex from Trailhead']);
});

test('owner matched only by their legacy name-based id is still the owner', () => {
  // No ownerEmail, so this is the one shape where the id fallback decides.
  const p = plan({
    session: legacyDoc({ ownerId: 'alex_kim' }),
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    legacyOwnerId: 'alex_kim',
    newName: 'Alex K.',
  });
  assert.equal(p.isOwner, true);
  assert.equal(p.renameOwnerLabel, true);
});

test('a matching legacy id does not make a namesake the owner once ownerEmail exists', () => {
  const p = plan({
    session: backfilledDoc(),
    currentInstructor: 'Alex Kim',
    ownerId: CO_ID,
    legacyOwnerId: 'alex_kim',
    newName: 'Alex K.',
  });
  assert.equal(p.isOwner, false, 'the id fallback must not outrank ownerEmail');
  assert.equal(p.renameOwnerLabel, false);
});

test('the real owner of a backfilled session keeps the owner rename', () => {
  const p = plan({
    session: backfilledDoc(),
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
  });
  assert.equal(p.isOwner, true, 'hiding the owner rename from the real owner breaks a live workshop');
  assert.equal(p.renameOwnerLabel, true);
});

test('co-instructor renaming themselves never touches the owner label or name', () => {
  const p = plan({
    session: session(),
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam R.',
  });
  assert.equal(p.status, 'ok');
  assert.equal(p.isOwner, false);
  assert.equal(p.renameOwnerLabel, false);
  assert.deepEqual(p.oldNames, ['Sam Rivera'], 'the owner name must not be rewritable by a co-instructor');
});

test('co-instructor already posting under the owner name is refused, not guessed at', () => {
  const p = plan({
    session: session(),
    currentInstructor: 'Alex Kim',
    ownerId: CO_ID,
    newName: 'Sam R.',
  });
  assert.equal(p.status, 'ambiguous');
  assert.deepEqual(p.oldNames, []);
});

test('co-instructor asking for the owner name is refused instead of silently doing nothing', () => {
  const p = plan({
    session: session(),
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Alex Kim',
  });
  assert.equal(p.status, 'name-taken');
  assert.deepEqual(p.oldNames, []);
});

test('no-op is measured against the caller\u2019s own name, for each role', () => {
  const asOwner = plan({
    session: session(),
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: '  Alex Kim  ',
  });
  assert.equal(asOwner.status, 'no-change');

  const asCoInstructor = plan({
    session: session(),
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam Rivera',
  });
  assert.equal(asCoInstructor.status, 'no-change');
});

test('legacy session with no ownerName: owner stamps one, co-instructor does not', () => {
  const legacy = session({ ownerName: undefined });
  const asOwner = plan({
    session: legacy,
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
  });
  assert.equal(asOwner.status, 'ok');
  assert.equal(asOwner.renameOwnerLabel, true);
  assert.deepEqual(asOwner.oldNames, ['Alex Kim']);

  const asCoInstructor = plan({
    session: legacy,
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam R.',
  });
  assert.equal(asCoInstructor.status, 'ok', 'no ownerName means no collision to refuse');
  assert.equal(asCoInstructor.renameOwnerLabel, false);
  assert.deepEqual(asCoInstructor.oldNames, ['Sam Rivera']);
});

// ── renameInSession end to end (fake Firestore) ─────────────────────────────
// The plan only matters if the writes honour it, so drive the real hook against a
// fake compat db and assert on the documents it leaves behind.

function fakeDb(sessionDoc, questions, { failAnswers = false } = {}) {
  // sessionWrites keeps the raw update payloads, not just the merged result: which
  // FIELDS a rename sends is what the Firestore rules judge it on.
  const state = {
    session: structuredClone(sessionDoc),
    questions: structuredClone(questions),
    sessionWrites: [],
  };
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => structuredClone(state.session) }),
        update: async (upd) => {
          state.sessionWrites.push(structuredClone(upd));
          Object.assign(state.session, structuredClone(upd));
        },
        collection: () => ({
          get: async () => ({
            forEach: (cb) => Object.keys(state.questions).forEach(id =>
              cb({ id, ref: { id }, data: () => structuredClone(state.questions[id]) })),
          }),
        }),
      }),
    }),
    batch: () => {
      const ops = [];
      return {
        update: (ref, data) => ops.push([ref, data]),
        commit: async () => {
          if (failAnswers) throw new Error('permission-denied');
          ops.forEach(([ref, data]) => Object.assign(state.questions[ref.id], structuredClone(data)));
        },
      };
    },
  };
  return { db, state };
}

const QUESTIONS = {
  q1: { answers: [{ instructor: 'Alex Kim', text: 'owner reply' }] },
  q2: { answers: [{ instructor: 'Sam Rivera', text: 'co-instructor reply' }] },
};

// `myEmail` is the store identity the ownership check reads; `authEmail` is what
// ensureInstructorAuth hands the legacy ownerEmail stamp. In the app both come
// from the same verified user, but they are separate knobs here so a stamp test
// can vary one without moving who the owner is.
async function rename({
  currentInstructor,
  ownerId,
  legacyOwnerId = null,
  myEmail,
  newName,
  doc = session(),
  failAnswers = false,
  isDemoMode = false,
  authEmail = OWNER_EMAIL,
}) {
  const { db, state } = fakeDb(doc, QUESTIONS, { failAnswers });
  globalThis.__testFirebase = { db, storage: null };
  globalThis.__testInstructorUser = authEmail ? { email: authEmail } : null;
  useInstructorStore.setState({
    currentInstructor,
    instructorOwnerId: ownerId,
    instructorLegacyOwnerId: legacyOwnerId,
    instructorEmail: identityFor({ ownerId, email: myEmail }).email,
    isDemoMode,
    allSessions: [structuredClone(doc)],
    activeSessionCode: doc.id,
    questionPages: [],
  });
  const result = await useInstructorAuth().renameInSession(doc.id, newName);
  return { result, state };
}

test('end to end: a co-instructor rename leaves the owner entirely alone', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam R.',
  });
  assert.equal(result, null);
  assert.equal(state.session.ownerName, 'Alex Kim');
  assert.deepEqual(state.session.instructors, ['Alex Kim', 'Sam R.']);
  assert.deepEqual(state.session.sessionNotes.map(n => n.instructor), ['Alex Kim', 'Sam R.']);
  assert.equal(state.questions.q1.answers[0].instructor, 'Alex Kim');
  assert.equal(state.questions.q2.answers[0].instructor, 'Sam R.');
});

test('end to end: an owner rename still updates the owner label, roster, notes and replies', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
  });
  assert.equal(result, null);
  assert.equal(state.session.ownerName, 'Alex K.');
  assert.deepEqual(state.session.instructors, ['Alex K.', 'Sam Rivera']);
  assert.deepEqual(state.session.sessionNotes.map(n => n.instructor), ['Alex K.', 'Sam Rivera']);
  assert.equal(state.questions.q1.answers[0].instructor, 'Alex K.');
  assert.equal(state.questions.q2.answers[0].instructor, 'Sam Rivera', 'the co-instructor keeps their name');
});

test('end to end: replies failing after the session updated is a warning, not a claim of success', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    failAnswers: true,
  });
  assert.ok(result && result.warning, `expected a warning, got ${JSON.stringify(result)}`);
  assert.equal(state.session.ownerName, 'Alex K.');
  assert.equal(state.questions.q1.answers[0].instructor, 'Alex Kim', 'the reply write did not land');
});

test('end to end: replies failing with nothing else to change reports that nothing was renamed', async () => {
  // A co-instructor who never made the roster and wrote no notes has only replies
  // to rewrite, so a reply failure means the rename reached nothing at all.
  const { result } = await rename({
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam R.',
    doc: session({
      instructors: ['Alex Kim'],
      instructorNames: 'Alex Kim',
      sessionNotes: [{ id: 'n1', instructor: 'Alex Kim' }],
    }),
    failAnswers: true,
  });
  assert.ok(result && result.error, `expected an error, got ${JSON.stringify(result)}`);
  assert.match(result.error, /Nothing was renamed/);
});

// ── Legacy sessions: the ownerEmail stamp ───────────────────────────────────
// firestore.rules identifies the session owner by `ownerEmail`, but a session
// created before that field existed has none, so `ownerNameOk` cannot see an
// owner and denies the `ownerName` write. The rename is ONE multi-field update,
// so that denial takes the whole rename down. The rules' repair path is to stamp
// the caller's own verified email in the same write; these tests pin the client
// to that shape, and to only ever sending the caller's OWN address.

test('legacy session: an owner rename stamps their own verified email alongside ownerName', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    doc: legacyDoc(),
  });
  assert.equal(result, null);
  assert.equal(state.sessionWrites.length, 1, 'the rename is a single session update');
  const write = state.sessionWrites[0];
  assert.equal(write.ownerName, 'Alex K.');
  assert.equal(
    write.ownerEmail,
    OWNER_EMAIL,
    'without ownerEmail in the same write the rules deny the whole rename'
  );
  assert.equal(state.session.ownerName, 'Alex K.');
  assert.deepEqual(state.session.instructors, ['Alex K.', 'Sam Rivera']);
  assert.equal(state.questions.q1.answers[0].instructor, 'Alex K.');
});

test('legacy session: the stamp is the verified email, normalised, whatever the document says', async () => {
  const { state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    // A document carrying someone else's address in a neighbouring field must not
    // be able to steer what gets stamped.
    doc: legacyDoc({ instructorEmails: ['mallory@salesforce.com'] }),
    authEmail: '  Alex.KIM@Salesforce.com  ',
  });
  assert.equal(state.sessionWrites[0].ownerEmail, OWNER_EMAIL);
});

test('legacy session: an owner rename with no verified sign-in renames nothing and says so', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    doc: legacyDoc(),
    // No verified sign-in means no store email either, so the ownerId fallback is
    // the only thing that still recognises the owner here.
    myEmail: null,
    authEmail: null,
  });
  assert.ok(result && result.error, `expected an error, got ${JSON.stringify(result)}`);
  assert.match(result.error, /Nothing was renamed/);
  assert.match(result.error, /sign-in/, 'the message must point at the real cause');
  assert.deepEqual(state.sessionWrites, [], 'stop before writing, so the message stays true');
  assert.equal(state.session.ownerName, 'Alex Kim');
  assert.equal(state.questions.q1.answers[0].instructor, 'Alex Kim');
});

test('legacy session: a co-instructor rename writes neither ownerName nor ownerEmail', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam R.',
    doc: legacyDoc(),
    authEmail: CO_EMAIL,
  });
  assert.equal(result, null);
  const write = state.sessionWrites[0];
  assert.ok(!('ownerName' in write), 'a co-instructor may not move the lead label');
  assert.ok(!('ownerEmail' in write), 'and the stamp must never become a way to claim a session');
  assert.equal(state.session.ownerName, 'Alex Kim');
});

test('a session that already has an ownerEmail never has it re-sent', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
  });
  assert.equal(result, null);
  assert.equal(state.sessionWrites[0].ownerName, 'Alex K.');
  assert.ok(
    !('ownerEmail' in state.sessionWrites[0]),
    'ownerEmailPreserved forbids touching an existing ownerEmail, so do not send it'
  );
});

test('an ownerEmail that is present but empty is left alone rather than overwritten', async () => {
  // Mirrors the rules' `'ownerEmail' in data` test: the field exists, so it is not
  // the client's to write, even though its value identifies nobody. Nobody is the
  // owner of such a document either — isSessionOwner() cannot match '' — so the
  // caller here is a co-instructor, which is the only role that can still write.
  const { state } = await rename({
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Sam R.',
    doc: session({ ownerEmail: '' }),
  });
  const write = state.sessionWrites[0];
  assert.ok(!('ownerEmail' in write), 'the field exists, so it is not the client\u2019s to write');
  assert.ok(!('ownerName' in write), 'the rules deny every ownerName write on this document');
  assert.deepEqual(state.session.instructors, ['Alex Kim', 'Sam R.']);
});

test('nobody holds the owner rename on a document whose ownerEmail is empty', async () => {
  // The person the old ownerId check called the owner. The rules would refuse the
  // ownerName write, so attempting it would fail the whole rename.
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    doc: session({ ownerEmail: '' }),
  });
  assert.ok(result && result.error, `expected a refusal, got ${JSON.stringify(result)}`);
  assert.match(result.error, /Nothing was renamed/);
  assert.deepEqual(state.sessionWrites, []);
  assert.equal(state.session.ownerName, 'Alex Kim');
});

test('end to end: an emailToId twin cannot move the owner label they collide with', async () => {
  const REAL = 'a.b@salesforce.com';
  const TWIN = 'a-b@salesforce.com';
  const sharedId = emailToId(REAL);
  const { result, state } = await rename({
    currentInstructor: 'A Bee',
    ownerId: sharedId,
    myEmail: TWIN,
    newName: 'A B',
    doc: session({ ownerId: sharedId, ownerEmail: REAL, ownerName: 'A B' }),
    authEmail: TWIN,
  });
  // 'A B' is the owner's label, and asking for it is refused rather than applied.
  assert.ok(result && result.error, `expected a refusal, got ${JSON.stringify(result)}`);
  assert.deepEqual(state.sessionWrites, []);
  assert.equal(state.session.ownerName, 'A B', 'the twin must not be able to rename the lead');
  assert.equal(state.session.ownerEmail, REAL);
});

test('end to end: the owner of a backfilled session renames without re-sending ownerEmail', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    doc: backfilledDoc(),
  });
  assert.equal(result, null);
  assert.equal(state.sessionWrites[0].ownerName, 'Alex K.');
  assert.ok(
    !('ownerEmail' in state.sessionWrites[0]),
    'the backfill already set it, so ownerEmailPreserved forbids touching it'
  );
  assert.equal(state.questions.q1.answers[0].instructor, 'Alex K.');
});

test('demo mode: a legacy-shaped session renames in memory and stamps nothing', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Alex Kim',
    ownerId: OWNER_ID,
    newName: 'Alex K.',
    doc: legacyDoc(),
    isDemoMode: true,
    myEmail: null,
    authEmail: null,
  });
  assert.equal(result, null);
  assert.deepEqual(state.sessionWrites, [], 'demo mode never writes to Firestore');
  const stored = useInstructorStore.getState().allSessions[0];
  assert.equal(stored.ownerName, 'Alex K.', 'the rename still shows immediately');
  assert.ok(!('ownerEmail' in stored), 'the stamp exists only to satisfy a server rule');
});

test('end to end: a refused rename reports why and writes nothing', async () => {
  const { result, state } = await rename({
    currentInstructor: 'Sam Rivera',
    ownerId: CO_ID,
    newName: 'Alex Kim',
  });
  assert.ok(result && result.error, 'the caller must be told, not shown a success toast');
  assert.match(result.error, /Nothing was renamed/);
  assert.equal(state.session.ownerName, 'Alex Kim');
  assert.deepEqual(state.session.instructors, ['Alex Kim', 'Sam Rivera']);
  assert.equal(state.questions.q2.answers[0].instructor, 'Sam Rivera');
});
