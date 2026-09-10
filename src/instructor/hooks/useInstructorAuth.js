import { useCallback } from 'react';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import { currentUser as firebaseCurrentUser, ensureInstructorAuth, signOutInstructor } from '../../lib/auth.js';
import useInstructorStore, { DEMO_SESSION_CODE, DEMO_INSTRUCTOR_NAME, DEMO_INSTRUCTOR_OWNER_ID } from '../store/useInstructorStore.js';
import { clearDemoSessionPatch } from '../../lib/demoSessionSync.js';

// Storage key constants
const INSTR_ACTIVE_SESSION_KEY = 'sqa_instructor_active_session';
const INSTR_ACTIVE_SESSION_LEGACY = 'tdx_instructor_active_session';
const INSTR_ONBOARDING_WELCOME_KEY = 'sqa_instructor_onboarding_welcome';
const INSTR_ONBOARDING_LEGACY = 'tdx_instructor_onboarding_welcome';
const INSTR_NAME_KEY = 'sqa_instructor_name';
const INSTR_NAME_LEGACY = 'tdx_instructor_name';
const INSTR_DEMO_FLAG = 'sqa_is_demo';
const INSTR_DEMO_LEGACY = 'tdx_is_demo';
export const DEMO_SESSIONS_HIDDEN_KEY = 'sqa_sessions_hidden_demo';
const DEMO_SESSIONS_HIDDEN_LEGACY = 'tdx_sessions_hidden_demo';

export function nameToId(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * LOOKUP KEY derived from the verified Google email, not an ownership proof.
 * Independent of the display name, so instructors can rename themselves without
 * losing their sessions: it is what `where('ownerId', '==', …)` finds "my
 * sessions" with, and what names an instructor's own `instructors/{id}` doc.
 *
 * It is not unique enough to decide who owns a session. Runs of
 * non-alphanumerics collapse to one underscore, so a.b@salesforce.com and
 * a-b@salesforce.com both map to a_b_salesforce_com. instructorOwnsSession
 * therefore only consults it when there is no ownerEmail to ask.
 */
export function emailToId(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve the session-lookup keys for an instructor.
 * - ownerId: primary key (email-based when available, else name-based).
 * - legacyOwnerId: the pre-OAuth name-based id, returned only when it differs from
 *   ownerId, so sessions created before the email-identity switch stay visible.
 *
 * Both are query keys. Neither is an identity: the name-based fallback makes them
 * shared by anyone with the same display name, which is exactly why ownership is
 * decided by email in instructorOwnsSession.
 */
export function resolveInstructorIds({ email, name }) {
  const nameId = name ? nameToId(name) : '';
  const ownerId = email ? emailToId(email) : nameId;
  const legacyOwnerId = nameId && nameId !== ownerId ? nameId : null;
  return { ownerId, legacyOwnerId };
}

/**
 * Whether a session document carries an `ownerEmail` at all.
 *
 * Mirrors the `'ownerEmail' in data` test the Firestore rules use, and both
 * readers below depend on it meaning exactly that:
 *  - legacySession() decides whether the rules have any owner to identify, so it
 *    is the one condition under which instructorOwnsSession may fall back to
 *    `ownerId`.
 *  - `ownerEmailPreserved` lets a client write the field on a document that
 *    has never had it (legacy repair), or as a lead transfer onto someone
 *    already listed in `instructorEmails`.
 * A null or empty value therefore counts as PRESENT: it identifies nobody, it is
 * not ours to overwrite, and trying would be denied.
 */
function hasOwnerEmail(data) {
  return !!data && data.ownerEmail !== undefined;
}

/**
 * True when this instructor is the session's OWNER — the lead — rather than a
 * co-instructor. `identity` is { ownerId, legacyOwnerId, email }, the three
 * fields the store holds (see useInstructorStore).
 *
 * `ownerEmail` decides it whenever the document has one, because that is the only
 * field the rules look at: isSessionOwner() compares `data.ownerEmail` against
 * the caller's verified email and nothing else. Deciding it any other way here is
 * how the UI ends up offering owner-only controls whose writes are then refused.
 *
 * The comparison is as literal as the rule: the caller's own address is
 * lowercased (the rules read the token through .lower()) while the stored value
 * is compared verbatim (the rules never touch it). Every writer of the field
 * stores it lowercased and trimmed, so a stored value that fails this test is one
 * the rules would reject too, and "not the owner" is the honest answer about it.
 *
 * The `ownerId` fallback is confined to a document with no `ownerEmail`, which is
 * precisely when the rules stop looking for an owner and fall back to
 * legacySession(). It cannot be the general answer because it is not an identity:
 * emailToId collides, and resolveInstructorIds hands out a name-derived id, so a
 * namesake matches the owner of any document whose ownerId was never migrated.
 * Demo sessions carry no ownerEmail, so the demo lead still owns the demo session
 * with no verified identity anywhere.
 */
export function instructorOwnsSession(session, identity) {
  if (!session) return false;
  const { ownerId, legacyOwnerId, email } = identity || {};
  if (hasOwnerEmail(session)) {
    const mine = String(email || '').trim().toLowerCase();
    return !!mine && session.ownerEmail === mine;
  }
  const owned = [ownerId, legacyOwnerId].filter(Boolean);
  return owned.includes(session.ownerId);
}

/**
 * The name to show/author under for this instructor in a specific session.
 * Sessions they own can carry a per-session name (ownerName); otherwise fall back
 * to their global default display name.
 */
export function myNameForSession(session, currentInstructor, identity) {
  if (session && session.ownerName && instructorOwnsSession(session, identity)) {
    return session.ownerName;
  }
  return currentInstructor || 'Instructor';
}

/**
 * The caller's identity as the two checks above want it, from a store snapshot.
 * `instructorEmail` is the verified Google address the auth listener stored
 * (InstructorApp) — the same value the token carries, and available synchronously,
 * so ownership is decided during render without awaiting auth.
 *
 * Components assemble the same three fields from their own selectors rather than
 * calling this: a selector that returned a fresh object every render would defeat
 * the store's reference check.
 */
function instructorIdentityFromState(state) {
  return {
    ownerId: state.instructorOwnerId,
    legacyOwnerId: state.instructorLegacyOwnerId,
    email: state.instructorEmail,
  };
}

// Editable display-name override, persisted in localStorage keyed by ownerId so a
// rename survives reloads and does not leak across different signed-in accounts.
const INSTR_DISPLAY_NAME_OVERRIDES = 'sqa_instructor_display_names';

export function readDisplayNameOverride(ownerId) {
  if (!ownerId) return '';
  try {
    const raw = localStorage.getItem(INSTR_DISPLAY_NAME_OVERRIDES);
    if (!raw) return '';
    const map = JSON.parse(raw);
    return map && typeof map[ownerId] === 'string' ? map[ownerId] : '';
  } catch (e) { return ''; }
}

export function writeDisplayNameOverride(ownerId, name) {
  if (!ownerId) return;
  try {
    let map = {};
    const raw = localStorage.getItem(INSTR_DISPLAY_NAME_OVERRIDES);
    if (raw) { try { map = JSON.parse(raw) || {}; } catch (e) { map = {}; } }
    map[ownerId] = name;
    localStorage.setItem(INSTR_DISPLAY_NAME_OVERRIDES, JSON.stringify(map));
  } catch (e) {}
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Decide what a per-session rename is allowed to touch, given WHO is renaming.
 *
 * A session carries two different names: `ownerName` is the lead instructor's
 * label, while the roster, note bylines and answer bylines carry whoever wrote
 * them. Only the owner's own rename may move `ownerName` — a co-instructor who
 * moves it renames the lead on every screen in the room and re-attributes the
 * lead's past posts.
 *
 * Attribution is by display name and nothing else: notes and answers store
 * `instructor` as a bare string with no link back to an identity (the same
 * limitation the roster has, see InstructorManager). Two people sharing one label
 * in a session therefore cannot be told apart, and both refusals below exist to
 * keep the rewrite out of that state rather than guess:
 *  - `ambiguous`: a co-instructor already goes by the owner's exact name, so their
 *    past posts are indistinguishable from the owner's.
 *  - `name-taken`: a co-instructor asks for the owner's exact name, which would
 *    create that same state (and erase their own roster chip, since the roster
 *    holds one entry per distinct name).
 * The mirror case — the owner sharing a name with a co-instructor — is not
 * detectable at all for the same roster reason. Telling those apart needs a
 * per-author identity on posts, which is a schema change, not a client fix.
 *
 * Pure: reads only its arguments, so the callers below (live and demo) cannot
 * drift apart on who owns what.
 */
export function resolveSessionRenamePlan({ session, currentInstructor, identity, newName }) {
  const trimmed = String(newName || '').trim();
  const isOwner = instructorOwnsSession(session, identity);
  const myName = myNameForSession(session, currentInstructor, identity);
  const ownerName = (session && session.ownerName) || '';
  const stop = (status) => ({ status, isOwner, myName, renameOwnerLabel: false, oldNames: [] });

  if (!isOwner && ownerName && ownerName === myName) return stop('ambiguous');
  // Compared against the caller's OWN name, not the owner's: for a co-instructor
  // those are different questions, and only the first one means "no change".
  if (trimmed === myName) return stop('no-change');
  if (!isOwner && ownerName && ownerName === trimmed) return stop('name-taken');

  // The owner may have posted under their global default before this session got
  // its own name, so both of their labels are replaced. A co-instructor has
  // exactly one label in this session: their own.
  const oldNames = isOwner ? [ownerName, currentInstructor] : [myName];
  return {
    status: 'ok',
    isOwner,
    myName,
    renameOwnerLabel: isOwner,
    oldNames: [...new Set(oldNames.filter(Boolean))],
  };
}

/**
 * Replace any of the instructor's prior names (oldNames) with newName inside a
 * single session doc. The owner label moves only when the caller owns the session
 * (renameOwnerLabel), and it is written even when the field is absent, so an
 * owner's rename also stamps a per-session name onto a legacy doc that never had
 * one.
 */
function buildSessionRenameUpdates(data, oldNames, newName, { renameOwnerLabel = false } = {}) {
  const isOld = (nm) => !!nm && oldNames.has(nm);
  const upd = {};
  if (Array.isArray(data.instructors) && data.instructors.some(isOld)) {
    const next = [];
    data.instructors.forEach(nm => {
      const v = isOld(nm) ? newName : nm;
      if (v && !next.includes(v)) next.push(v);
    });
    upd.instructors = next;
    upd.instructorNames = next.join(', ');
  } else if (typeof data.instructorNames === 'string' && data.instructorNames) {
    const parts = data.instructorNames.split(',').map(x => x.trim());
    if (parts.some(isOld)) {
      const next = [];
      parts.forEach(p => {
        const v = isOld(p) ? newName : p;
        if (v && !next.includes(v)) next.push(v);
      });
      upd.instructorNames = next.join(', ');
    }
  }
  if (renameOwnerLabel && data.ownerName !== newName) upd.ownerName = newName;
  if (Array.isArray(data.sessionNotes) && data.sessionNotes.some(n => n && isOld(n.instructor))) {
    upd.sessionNotes = data.sessionNotes.map(n =>
      n && isOld(n.instructor) ? { ...n, instructor: newName } : n
    );
  }
  return upd;
}

/**
 * The caller's OWN verified email, read straight from Firebase Auth — never from
 * the store, a session document, or any other caller-supplied value. Same source
 * and same guarantee CreateSessionModal uses to stamp `ownerEmail` on a new
 * session: ensureInstructorAuth resolves only for a live, verified
 * salesforce.com identity, so this can never return someone else's address.
 * Returns null when there is no such identity.
 */
async function verifiedInstructorEmail() {
  const user = await ensureInstructorAuth();
  const email = user && user.email ? String(user.email).trim().toLowerCase() : '';
  return email || null;
}

/** Rename failure that knows how far it got, so the caller can say so accurately. */
class SessionRenameError extends Error {
  constructor(stage, cause) {
    super(`Session rename failed while ${stage}`);
    this.name = 'SessionRenameError';
    this.stage = stage;
    this.cause = cause;
  }
}

/**
 * Rewrite the instructor's name within a SINGLE session (names are per-session):
 *  - session instructors / instructorNames, plus ownerName for the owner only
 *  - session notes authored under a prior name
 *  - question answers ("previous replies") authored under a prior name
 * Other instructors and students keep their names — `oldNamesSet` and
 * `renameOwnerLabel` come from resolveSessionRenamePlan and are what confine the
 * rewrite to the caller. Returns the changed session update so the caller can patch
 * the local store for an instant UI refresh.
 *
 * Failure is staged so the message can be true: `reading the session`,
 * `confirming your sign-in` and `updating the session` all mean nothing was
 * renamed at all — each happens before or at the single session write — while
 * `answersFailed` means the session WAS renamed and only the past replies are
 * behind. Rewriting the replies is NOT atomic across batches — a failure in the
 * middle leaves earlier batches applied, which is why the caller offers a retry
 * rather than claiming success.
 */
async function propagateSessionRename({ db, sessionCode, oldNamesSet, newName, renameOwnerLabel }) {
  const ref = db.collection('sessions').doc(sessionCode);
  const oldNames = [...oldNamesSet];

  let doc;
  try {
    doc = await ref.get();
  } catch (e) {
    throw new SessionRenameError('reading the session', e);
  }
  if (!doc.exists) return { changedSessions: [], oldNames, answersFailed: false };
  const data = doc.data() || {};

  const changedSessions = [];
  const upd = buildSessionRenameUpdates(data, oldNamesSet, newName, { renameOwnerLabel });

  // A session created before email-based ownership has no `ownerEmail`, so
  // `ownerNameOk` in firestore.rules has nothing to recognise the owner by and
  // rejects the `ownerName` write — which fails the WHOLE rename, since it is one
  // multi-field update. The rules' own repair path is to stamp the caller's own
  // verified email in that same write, so do exactly that: it makes the write
  // legal and migrates the document as a side effect.
  //
  // Reaching here already means the caller owns the session, because the builder
  // sets `ownerName` only under renameOwnerLabel. This adds no way to take a
  // session over: the only address ever written is the caller's own verified one,
  // and a document that already has an `ownerEmail` is left alone.
  if ('ownerName' in upd && !hasOwnerEmail(data)) {
    let ownerEmail;
    try {
      ownerEmail = await verifiedInstructorEmail();
    } catch (e) {
      throw new SessionRenameError('confirming your sign-in', e);
    }
    // Without it the update below is denied anyway, so stop while "nothing was
    // renamed" is still true and the caller can say why.
    if (!ownerEmail) throw new SessionRenameError('confirming your sign-in');
    upd.ownerEmail = ownerEmail;
  }

  if (Object.keys(upd).length) {
    // Committed on its own and first: the session document is the rename the
    // instructor actually asked for, so its success or failure is what decides
    // whether "nothing was renamed" is a true statement.
    try {
      await ref.update(upd);
    } catch (e) {
      throw new SessionRenameError('updating the session', e);
    }
    changedSessions.push({ id: sessionCode, updates: upd });
  }

  // Firestore cannot query "answers contains an entry whose instructor is X", so
  // finding past replies means reading every question in the session. The one cheap
  // narrowing available is to skip the read entirely when no prior name is left to
  // replace.
  const replaceable = new Set(oldNames.filter(n => n && n !== newName));
  if (!replaceable.size) return { changedSessions, oldNames, answersFailed: false };

  try {
    const qSnap = await ref.collection('questions').get();
    const writes = [];
    qSnap.forEach(qd => {
      const q = qd.data() || {};
      if (Array.isArray(q.answers) && q.answers.some(a => a && replaceable.has(a.instructor))) {
        const answers = q.answers.map(a =>
          a && replaceable.has(a.instructor) ? { ...a, instructor: newName } : a
        );
        writes.push({ ref: qd.ref, data: { answers } });
      }
    });
    for (const group of chunkArray(writes, 400)) {
      const batch = db.batch();
      group.forEach(w => batch.update(w.ref, w.data));
      await batch.commit();
    }
  } catch (e) {
    console.warn('Rewriting past replies after the rename failed:', e);
    return { changedSessions, oldNames, answersFailed: true };
  }

  return { changedSessions, oldNames, answersFailed: false };
}

/**
 * Patch the in-memory store so a rename shows immediately without a reload.
 * `rewriteAnswers` is false when the reply rewrite failed: showing the new name on
 * replies Firestore still stores under the old one would be a lie.
 */
function applyRenameToStore(oldNames, newName, changedSessions, { rewriteAnswers = true } = {}) {
  const oldSet = new Set((oldNames || []).filter(Boolean));
  const store = useInstructorStore.getState();
  const changedMap = new Map((changedSessions || []).map(c => [c.id, c.updates]));
  const mergedSessions = store.allSessions.map(s =>
    changedMap.has(s.id) ? { ...s, ...changedMap.get(s.id) } : s
  );
  store.setAllSessions(mergedSessions);

  if (!rewriteAnswers) return;

  const pages = store.questionPages.map(p => ({
    ...p,
    questions: (p.questions || []).map(q =>
      Array.isArray(q.answers) && q.answers.some(a => a && oldSet.has(a.instructor))
        ? { ...q, answers: q.answers.map(a => (a && oldSet.has(a.instructor) ? { ...a, instructor: newName } : a)) }
        : q
    ),
  }));
  store.setQuestionPages(pages);
}

export function readInstructorActiveSessionFromStorage() {
  try {
    let v = sessionStorage.getItem(INSTR_ACTIVE_SESSION_KEY);
    if (v) return v;
    v = sessionStorage.getItem(INSTR_ACTIVE_SESSION_LEGACY);
    if (v) {
      sessionStorage.setItem(INSTR_ACTIVE_SESSION_KEY, v);
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
    }
    return v;
  } catch (e) { return null; }
}

export function readInstructorNameFromStorage() {
  try {
    let v = sessionStorage.getItem(INSTR_NAME_KEY);
    if (v) return v;
    v = sessionStorage.getItem(INSTR_NAME_LEGACY);
    if (v) {
      sessionStorage.setItem(INSTR_NAME_KEY, v);
      sessionStorage.removeItem(INSTR_NAME_LEGACY);
    }
    return v;
  } catch (e) { return null; }
}

export function writeInstructorNameToStorage(name) {
  try {
    sessionStorage.setItem(INSTR_NAME_KEY, name);
    sessionStorage.removeItem(INSTR_NAME_LEGACY);
  } catch (e) {}
}

export function readIsDemoFromStorage() {
  try {
    let v = sessionStorage.getItem(INSTR_DEMO_FLAG);
    if (v != null) return v;
    v = sessionStorage.getItem(INSTR_DEMO_LEGACY);
    if (v != null) {
      sessionStorage.setItem(INSTR_DEMO_FLAG, v);
      sessionStorage.removeItem(INSTR_DEMO_LEGACY);
    }
    return v;
  } catch (e) { return null; }
}

export function writeIsDemoToStorage(val) {
  try {
    sessionStorage.setItem(INSTR_DEMO_FLAG, val);
    sessionStorage.removeItem(INSTR_DEMO_LEGACY);
  } catch (e) {}
}

export function clearInstructorBrowserSessionKeys() {
  try {
    sessionStorage.removeItem(INSTR_NAME_KEY);
    sessionStorage.removeItem(INSTR_NAME_LEGACY);
    sessionStorage.removeItem(INSTR_DEMO_FLAG);
    sessionStorage.removeItem(INSTR_DEMO_LEGACY);
    sessionStorage.removeItem(INSTR_ACTIVE_SESSION_KEY);
    sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
  } catch (e) {}
}

export function persistInstructorActiveSession(code) {
  try {
    if (code) {
      sessionStorage.setItem(INSTR_ACTIVE_SESSION_KEY, code);
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
    } else {
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_KEY);
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
    }
  } catch (e) {}
}

export function instructorOnboardingWelcomePending() {
  try {
    if (sessionStorage.getItem(INSTR_ONBOARDING_WELCOME_KEY) === '1') return true;
    if (sessionStorage.getItem(INSTR_ONBOARDING_LEGACY) === '1') {
      sessionStorage.setItem(INSTR_ONBOARDING_WELCOME_KEY, '1');
      sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
      return true;
    }
    return false;
  } catch (e) { return false; }
}

export function clearInstructorOnboardingWelcomeFlag() {
  try {
    sessionStorage.removeItem(INSTR_ONBOARDING_WELCOME_KEY);
    sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
  } catch (e) {}
}

export function setInstructorOnboardingWelcomeFlag() {
  try {
    sessionStorage.setItem(INSTR_ONBOARDING_WELCOME_KEY, '1');
    sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
  } catch (e) {}
}

export function getDemoHiddenSessionIds() {
  try {
    const fromNew = sessionStorage.getItem(DEMO_SESSIONS_HIDDEN_KEY);
    const fromLeg = sessionStorage.getItem(DEMO_SESSIONS_HIDDEN_LEGACY);
    const raw = fromNew || fromLeg;
    if (!raw) return [];
    if (fromLeg && !fromNew) {
      sessionStorage.setItem(DEMO_SESSIONS_HIDDEN_KEY, raw);
      sessionStorage.removeItem(DEMO_SESSIONS_HIDDEN_LEGACY);
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

/**
 * Restore fresh demo data + demo UI state. The single source of truth for BOTH
 * Reset Demo buttons (instructor top bar and the student-view overlay) so they
 * can never drift. Everything here is in-memory / sessionStorage only — no
 * Firestore writes ever happen in demo mode.
 */
export function resetDemoData() {
  // Un-hide the demo session so it reappears in the list.
  try { sessionStorage.removeItem(DEMO_SESSIONS_HIDDEN_KEY); } catch (e) {}
  // Re-seed session + questions + feedback and reset filters/sort/search/drafts
  // and bump the remount nonce for the overlay's local state.
  useInstructorStore.getState().resetDemoState();
  persistInstructorActiveSession(DEMO_SESSION_CODE);
  useInstructorStore.getState().showToast('Demo data reset!');
}

export function useInstructorAuth() {
  const { db } = useFirebase();

  // Establish the instructor identity by display name. The email is taken from
  // the *verified Firebase user* (never from a caller-supplied / URL value), so
  // ownership stays pinned to the Google account when signed in and falls back
  // to a name-based id for local/demo access. `name` is only the display name.
  const continueAs = useCallback(async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Please enter the name you want to go by.';
    // Read the verified email straight from Firebase Auth, if present.
    const user = firebaseCurrentUser();
    const email = user && !user.isAnonymous && user.emailVerified && user.email
      ? String(user.email).toLowerCase()
      : null;
    const { ownerId, legacyOwnerId } = resolveInstructorIds({ email, name: trimmed });
    useInstructorStore.getState().setInstructorIdentity({ ownerId, legacyOwnerId, email });
    useInstructorStore.getState().setCurrentInstructor(trimmed);
    writeInstructorNameToStorage(trimmed);
    writeDisplayNameOverride(ownerId, trimmed);
    return null; // success
  }, []);

  // Set the GLOBAL default display name — used for new sessions and as the fallback
  // when a session has no per-session name. Does not touch existing sessions.
  const setGlobalDisplayName = useCallback((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Please enter a name.';
    const ownerId = useInstructorStore.getState().instructorOwnerId;
    useInstructorStore.getState().setCurrentInstructor(trimmed);
    writeInstructorNameToStorage(trimmed);
    writeDisplayNameOverride(ownerId, trimmed);
    return null; // success
  }, []);

  /**
   * Rename yourself within ONE session only (names are per-session). Rewrites your
   * roster entry, notes, and answers in that session, plus the owner label if you
   * own it; other instructors' names and other sessions are untouched.
   *
   * Only `ownerName` persists a per-session name, so for a co-instructor this
   * rewrites what they have already posted while their NEXT post still uses their
   * global default (myNameForSession falls back to it for non-owners). Storing a
   * co-instructor's per-session name needs a schema change; today the dashboard
   * routes only owners here.
   *
   * Returns null on full success, `{ error }` when NOTHING was renamed, or
   * `{ warning }` when the session was renamed but past replies were not.
   */
  const renameInSession = useCallback(async (sessionCode, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return { error: 'Please enter a name.' };
    const state = useInstructorStore.getState();
    const session = state.allSessions.find(s => s.id === sessionCode);
    if (!session) return { error: 'Select a session first.' };
    const plan = resolveSessionRenamePlan({
      session,
      currentInstructor: state.currentInstructor,
      identity: instructorIdentityFromState(state),
      newName: trimmed,
    });
    if (plan.status === 'no-change') return null;
    if (plan.status === 'ambiguous') {
      return {
        error: `Nothing was renamed \u2014 you and the session owner both post as \u201c${plan.myName}\u201d here, so a rename cannot tell your past posts apart from theirs.`,
      };
    }
    if (plan.status === 'name-taken') {
      return {
        error: `Nothing was renamed \u2014 the session owner already posts as \u201c${trimmed}\u201d here. Pick a different name.`,
      };
    }
    const oldNamesSet = new Set(plan.oldNames);

    if (state.isDemoMode || !db) {
      // Same builder, same plan, so demo and live can't disagree about what a
      // rename touches. The legacy `ownerEmail` stamp is deliberately absent:
      // it exists only to satisfy a Firestore rule, there is no verified
      // identity here, and demo mode never writes to Firestore.
      const upd = buildSessionRenameUpdates(session, oldNamesSet, trimmed, {
        renameOwnerLabel: plan.renameOwnerLabel,
      });
      applyRenameToStore(plan.oldNames, trimmed, [{ id: sessionCode, updates: upd }]);
      return null;
    }

    let result;
    try {
      result = await propagateSessionRename({
        db,
        sessionCode,
        oldNamesSet,
        newName: trimmed,
        renameOwnerLabel: plan.renameOwnerLabel,
      });
    } catch (e) {
      console.warn('Session rename failed:', e);
      // Every stage that can throw here happens before or at the single session
      // write, so all three messages may say nothing was renamed.
      const stage = e && e.stage;
      if (stage === 'reading the session') {
        return { error: 'Could not load this session, so nothing was renamed. Check your connection and try again.' };
      }
      if (stage === 'confirming your sign-in') {
        return { error: 'Nothing was renamed \u2014 this session predates email-based ownership, so renaming yourself here needs a confirmed salesforce.com sign-in. Sign in again and retry.' };
      }
      return { error: 'Nothing was renamed \u2014 the session could not be updated. Try again.' };
    }

    applyRenameToStore(result.oldNames, trimmed, result.changedSessions, {
      rewriteAnswers: !result.answersFailed,
    });
    if (result.answersFailed) {
      // A rename that had nothing to change on the session document itself (a
      // co-instructor who is not on the roster and wrote no notes) reached none of
      // its targets when the replies failed, so it cannot claim a partial success.
      return result.changedSessions.length
        ? { warning: 'Renamed for this session, but some past replies still show your old name. Rename again to finish updating them.' }
        : { error: 'Nothing was renamed \u2014 your past replies could not be updated. Try again.' };
    }
    return null; // success
  }, [db]);

  const logout = useCallback(async () => {
    // End the Firebase session BEFORE the caller navigates anywhere, so the token is
    // already invalid by then. signOutInstructor swallows its own errors.
    await signOutInstructor();
    clearInstructorBrowserSessionKeys();
    persistInstructorActiveSession(null);
    setInstructorOnboardingWelcomeFlag();
    useInstructorStore.getState().resetForLogin();
  }, []);

  const enterDemo = useCallback(() => {
    // Identity matches DEMO_SESSION.ownerId so the instructor "owns" the demo
    // session (Lead chip renders, per-session rename works, all in-memory). There
    // is no email to set and none is needed: DEMO_SESSION carries no ownerEmail,
    // so instructorOwnsSession takes its ownerId path here.
    useInstructorStore.getState().setCurrentInstructor(DEMO_INSTRUCTOR_NAME);
    useInstructorStore.getState().setInstructorIdentity({ ownerId: DEMO_INSTRUCTOR_OWNER_ID });
    useInstructorStore.getState().setIsDemoMode(true);
    writeInstructorNameToStorage(DEMO_INSTRUCTOR_NAME);
    writeIsDemoToStorage('true');
    clearDemoSessionPatch();
  }, []);

  return { continueAs, setGlobalDisplayName, renameInSession, logout, enterDemo };
}
