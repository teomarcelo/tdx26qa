import { useState, useEffect, useRef, useCallback } from 'react';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import {
  normalizeSessionCodeFromJoinInput,
} from '../../lib/sessionCode.js';
import { ensureAnonymousStudent } from '../../lib/auth.js';
import {
  IS_STUDENT_DEMO,
  DEMO_SESSION_CODE,
  DEMO_STUDENT_USER_ID,
  DEMO_STUDENT_USER_NAME,
  freshDemoSession,
} from '../demo/useStudentDemoStore.js';
import {
  applyDemoSessionPatch,
  readDemoSessionPatch,
  subscribeDemoSessionPatch,
} from '../../lib/demoSessionSync.js';

const LS_STUDENT_UID = 'sqa_student_uid';
const LS_STUDENT_UID_LEGACY = 'tdx_student_uid';
const LS_LAST_SESSION = 'sqa_student_last_code';
const LS_LAST_SESSION_LEGACY = 'tdx_student_last_code';
const LS_NAME = 'sqa_name';
const LS_NAME_LEGACY = 'tdx_name';
const SS_LEGACY_UID = 'tdx_uid';

function safeLsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function safeLsSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) {}
}
function safeLsRemove(k) {
  try { localStorage.removeItem(k); } catch (e) {}
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Resolves or generates a stable student user ID from localStorage
 * (same browser profile across refreshes; not a login).
 */
function resolveUserId() {
  let legacyUid = null;
  try { legacyUid = sessionStorage.getItem(SS_LEGACY_UID); } catch (e) {}
  const uid = safeLsGet(LS_STUDENT_UID) || safeLsGet(LS_STUDENT_UID_LEGACY) || legacyUid || genId();
  safeLsSet(LS_STUDENT_UID, uid);
  if (safeLsGet(LS_STUDENT_UID_LEGACY)) safeLsRemove(LS_STUDENT_UID_LEGACY);
  if (legacyUid) {
    try { sessionStorage.removeItem(SS_LEGACY_UID); } catch (e) {}
  }
  return uid;
}

/**
 * Reads the stored display name, migrating legacy key if needed.
 */
function resolveStoredName() {
  const nNew = safeLsGet(LS_NAME);
  const nLeg = safeLsGet(LS_NAME_LEGACY);
  const stored = (nNew || nLeg || '').trim();
  if (!nNew && nLeg) {
    safeLsSet(LS_NAME, nLeg);
    safeLsRemove(LS_NAME_LEGACY);
  }
  return stored;
}

/**
 * Per-session sessionStorage key for "my questions" tracking.
 */
export function myQsKey(sessionCode) {
  return 'sqa_my_questions_' + String(sessionCode || '').replace(/[^A-Z0-9_-]/gi, '');
}

function migrateLegacyStudentMyQuestions(sessionCode) {
  if (!sessionCode) return;
  const nk = myQsKey(sessionCode);
  try {
    if (sessionStorage.getItem(nk)) return;
    const legacyPerSession = 'tdx_my_questions_' + String(sessionCode).replace(/[^A-Z0-9_-]/gi, '');
    const fromPerSessionLegacy = sessionStorage.getItem(legacyPerSession);
    if (fromPerSessionLegacy) {
      sessionStorage.setItem(nk, fromPerSessionLegacy);
      sessionStorage.removeItem(legacyPerSession);
      return;
    }
    const leg = sessionStorage.getItem('tdx_my_questions');
    if (leg) {
      sessionStorage.setItem(nk, leg);
      sessionStorage.removeItem('tdx_my_questions');
    }
  } catch (e) {}
}

/**
 * Manages join / auto-rejoin / leave state for the student app.
 *
 * Returns:
 *   appState: 'restoring' | 'join' | 'app'
 *   sessionCode, currentSession, userName, userId
 *   storedName (pre-filled in name input)
 *   joinError, joining
 *   handleJoin(suffixValue, nameValue)
 *   handleLeave()
 */
export function useStudentSession() {
  const { db } = useFirebase();

  // Resolved on first render; stable for the lifetime of the page. In demo mode
  // we use a fixed demo id and never touch localStorage for identity.
  const userIdRef = useRef(IS_STUDENT_DEMO ? DEMO_STUDENT_USER_ID : resolveUserId());
  const userId = userIdRef.current;

  const [storedName] = useState(() => resolveStoredName());
  const [appState, setAppState] = useState('restoring'); // 'restoring' | 'join' | 'app'
  const [sessionCode, setSessionCode] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [userName, setUserName] = useState('Anonymous');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);

  // Live session listener unsubscribe ref
  const unsubSessionRef = useRef(null);

  // --- Auto-rejoin on mount ---
  useEffect(() => {
    function bailToJoin() {
      try { document.documentElement.classList.remove('std-restoring-session'); } catch (e) {}
      setAppState('join');
    }

    // Demo mode: bypass Firestore and auth. Drop the student into the shared
    // demo session. A BroadcastChannel/localStorage patch keeps the student
    // board in step when the instructor demo changes the lead (the iframe is a
    // separate JS heap, so the instructor store never reaches it on its own).
    if (IS_STUDENT_DEMO) {
      setUserName(DEMO_STUDENT_USER_NAME);
      setSessionCode(DEMO_SESSION_CODE);
      const applyPatch = (patch) => {
        setCurrentSession(applyDemoSessionPatch(freshDemoSession(), patch));
      };
      applyPatch(readDemoSessionPatch());
      try { document.documentElement.classList.remove('std-restoring-session'); } catch (e) {}
      setAppState('app');
      const unsubPatch = subscribeDemoSessionPatch(applyPatch);
      return () => { unsubPatch(); };
    }

    if (!db) {
      bailToJoin();
      return;
    }

    // Start silent anonymous auth as early as possible so a stable uid is ready
    // before the student's first write (question / upvote / feedback). Fire and
    // forget: reads don't need it and it degrades gracefully if unavailable.
    ensureAnonymousStudent();

    // URL param ?code=SQA-XXXX takes priority over localStorage (used by instructor preview iframe)
    let urlCode = null;
    try {
      const p = new URLSearchParams(window.location.search);
      urlCode = p.get('code');
    } catch (e) {}

    let raw = urlCode || safeLsGet(LS_LAST_SESSION) || safeLsGet(LS_LAST_SESSION_LEGACY);
    // migrate legacy key
    if (raw && safeLsGet(LS_LAST_SESSION_LEGACY) && !safeLsGet(LS_LAST_SESSION)) {
      safeLsSet(LS_LAST_SESSION, String(raw).trim());
      safeLsRemove(LS_LAST_SESSION_LEGACY);
    }
    if (!raw) { bailToJoin(); return; }

    const code = normalizeSessionCodeFromJoinInput(String(raw).trim());
    if (!code) {
      safeLsRemove(LS_LAST_SESSION);
      safeLsRemove(LS_LAST_SESSION_LEGACY);
      bailToJoin();
      return;
    }

    db.collection('sessions').doc(code).get().then((doc) => {
      if (!doc.exists) {
        safeLsRemove(LS_LAST_SESSION);
        safeLsRemove(LS_LAST_SESSION_LEGACY);
        bailToJoin();
        return;
      }
      const nm = resolveStoredName();
      setUserName(nm || 'Anonymous');
      setSessionCode(code);
      setCurrentSession(doc.data());
      migrateLegacyStudentMyQuestions(code);
      safeLsSet(LS_LAST_SESSION, code);
      safeLsRemove(LS_LAST_SESSION_LEGACY);
      try { document.documentElement.classList.remove('std-restoring-session'); } catch (e) {}
      setAppState('app');
    }).catch(() => { bailToJoin(); });
     
  }, [db]);

  // --- Live session listener (re-subscribes when sessionCode or db changes) ---
  useEffect(() => {
    // Demo mode has no Firestore session doc to listen to; the session is the
    // static in-memory fixture set above.
    if (IS_STUDENT_DEMO) return;
    if (!db || !sessionCode || appState !== 'app') return;

    if (typeof unsubSessionRef.current === 'function') {
      unsubSessionRef.current();
      unsubSessionRef.current = null;
    }

    const unsub = db.collection('sessions').doc(sessionCode).onSnapshot(
      (snap) => {
        if (!snap.exists) return;
        const payload = snap.data();
        if (payload && typeof payload === 'object') {
          setCurrentSession(payload);
        }
      },
      (err) => {
        console.warn('Student session listener error:', err);
      },
    );
    unsubSessionRef.current = unsub;

    return () => {
      if (typeof unsubSessionRef.current === 'function') {
        unsubSessionRef.current();
        unsubSessionRef.current = null;
      }
    };
  }, [db, sessionCode, appState]);

  // --- Join ---
  const handleJoin = useCallback(async (codeValue, nameValue) => {
    // In demo mode joining is disabled — there is no Firestore to query. This
    // only matters if a user hits "Leave" inside the preview iframe; it must
    // never fall through to a real db read.
    if (IS_STUDENT_DEMO) {
      setJoinError('Joining is disabled in the demo preview.');
      return;
    }
    if (!db) {
      setJoinError('Not connected to Firebase.');
      return;
    }
    const nm = (nameValue || '').trim() || 'Anonymous';
    if (nm !== 'Anonymous') {
      safeLsSet(LS_NAME, nm);
      safeLsRemove(LS_NAME_LEGACY);
    }
    // Ensure the anonymous identity exists before the student can post/upvote.
    ensureAnonymousStudent();
    setJoining(true);
    setJoinError('');
    try {
      const doc = await db.collection('sessions').doc(codeValue).get();
      if (!doc.exists) {
        setJoinError('Session not found. Check the code and try again.');
        setJoining(false);
        return;
      }
      setUserName(nm);
      setSessionCode(codeValue);
      setCurrentSession(doc.data());
      migrateLegacyStudentMyQuestions(codeValue);
      safeLsSet(LS_LAST_SESSION, codeValue);
      safeLsRemove(LS_LAST_SESSION_LEGACY);
      setJoining(false);
      setAppState('app');
    } catch (e) {
      setJoinError('Connection error. Please try again.');
      setJoining(false);
    }
  }, [db]);

  // --- Leave ---
  const handleLeave = useCallback(() => {
    if (typeof unsubSessionRef.current === 'function') {
      unsubSessionRef.current();
      unsubSessionRef.current = null;
    }
    safeLsRemove(LS_LAST_SESSION);
    safeLsRemove(LS_LAST_SESSION_LEGACY);
    try { document.documentElement.classList.remove('std-restoring-session'); } catch (e) {}
    setSessionCode(null);
    setCurrentSession(null);
    setJoinError('');
    setJoining(false);
    setAppState('join');
  }, []);

  return {
    appState,
    sessionCode,
    currentSession,
    userName,
    userId,
    storedName,
    joinError,
    joining,
    handleJoin,
    handleLeave,
    isDemoMode: IS_STUDENT_DEMO,
  };
}
