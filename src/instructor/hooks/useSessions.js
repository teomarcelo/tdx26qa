import { useEffect, useRef } from 'react';
import firebase from '../../lib/firebaseCompat.js';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import useInstructorStore, { DEMO_SESSION, DEMO_SESSION_CODE, DEMO_QUESTIONS_TEMPLATE } from '../store/useInstructorStore.js';
import {
  nameToId,
  readInstructorActiveSessionFromStorage,
  persistInstructorActiveSession,
  getDemoHiddenSessionIds,
  DEMO_SESSIONS_HIDDEN_KEY,
} from './useInstructorAuth.js';

function sessionCreatedAtMs(s) {
  const raw = s && s.createdAt;
  if (!raw) return 0;
  if (typeof raw.toDate === 'function') {
    try { const d = raw.toDate(); return d instanceof Date && !isNaN(d) ? d.getTime() : 0; } catch (e) { return 0; }
  }
  const d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d) ? 0 : d.getTime();
}

function mergeSessionLists(...lists) {
  const byId = new Map();
  lists.flat().forEach((s) => {
    if (s && s.id) byId.set(s.id, s);
  });
  return Array.from(byId.values()).sort((a, b) => sessionCreatedAtMs(b) - sessionCreatedAtMs(a));
}

export function useSessions() {
  const { db } = useFirebase();
  const unsubRef = useRef(null);

  const currentInstructor = useInstructorStore(s => s.currentInstructor);
  const instructorOwnerId = useInstructorStore(s => s.instructorOwnerId);
  const instructorLegacyOwnerId = useInstructorStore(s => s.instructorLegacyOwnerId);
  const instructorEmail = useInstructorStore(s => s.instructorEmail);
  const isDemoMode = useInstructorStore(s => s.isDemoMode);

  // Load sessions when instructor logs in
  useEffect(() => {
    if (!currentInstructor) return;
    if (isDemoMode) {
      loadDemoSessions();
      return;
    }
    if (!db) return;

    // Clean up previous listener
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    // Stable identity (email-based) plus the legacy name-based id, so sessions created
    // before the email-identity switch keep showing. Fall back to the display name id
    // if identity hasn't been set (e.g. legacy stored session with no SSO params).
    const ownerId = instructorOwnerId || nameToId(currentInstructor);
    const legacyId = instructorLegacyOwnerId && instructorLegacyOwnerId !== ownerId
      ? instructorLegacyOwnerId
      : null;
    const ownerIds = legacyId ? [ownerId, legacyId] : [ownerId];
    const sessionsQuery = ownerIds.length > 1
      ? db.collection('sessions').where('ownerId', 'in', ownerIds)
      : db.collection('sessions').where('ownerId', '==', ownerId);
    const myEmail = String(instructorEmail || '').trim().toLowerCase();

    const ownedRef = { current: [] };
    const listedRef = { current: [] };
    const joinedRef = { current: [] };
    const hiddenRef = { current: new Set() };
    let cancelled = false;
    let hiddenReady = false;

    const publish = () => {
      if (cancelled || !hiddenReady) return;
      const merged = mergeSessionLists(ownedRef.current, listedRef.current, joinedRef.current)
        .filter(s => s && !hiddenRef.current.has(s.id));
      useInstructorStore.getState().setAllSessions(merged);
      useInstructorStore.getState().setInstructorSessionsHydrated(true);
      tryRestoreActiveSession(merged);
    };

    const loadJoinedAndHidden = () => {
      Promise.all(ownerIds.map(id => db.collection('instructors').doc(id).get())).then(docs => {
        if (cancelled) return;
        const joinedSet = new Set();
        const hiddenArr = [];
        docs.forEach(doc => {
          if (!doc.exists) return;
          const d = doc.data() || {};
          if (Array.isArray(d.joinedSessions)) d.joinedSessions.forEach(c => joinedSet.add(c));
          if (Array.isArray(d.sessionsHiddenFromList)) hiddenArr.push(...d.sessionsHiddenFromList);
        });
        hiddenRef.current = new Set(hiddenArr);
        hiddenReady = true;
        const joinedCodes = [...joinedSet];
        if (!joinedCodes.length) {
          joinedRef.current = [];
          publish();
          return;
        }
        Promise.all(joinedCodes.map(code => db.collection('sessions').doc(code).get()))
          .then(docs => {
            if (cancelled) return;
            joinedRef.current = docs
              .filter(d => d.exists)
              .map(d => ({ id: d.id, ...d.data() }));
            publish();
          });
      });
    };

    const unsubOwned = sessionsQuery
      .onSnapshot(snap => {
        ownedRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        loadJoinedAndHidden();
      }, err => {
        console.error('loadSessions error:', err);
        useInstructorStore.getState().setAllSessions([]);
        useInstructorStore.getState().setInstructorSessionsHydrated(true);
        useInstructorStore.getState().showToast('Could not load your sessions. Check your connection.');
      });

    // After a lead transfer, ownerId no longer matches the previous owner, so
    // the query above would drop the session. instructorEmails still lists them.
    let unsubListed = () => {};
    if (myEmail) {
      unsubListed = db.collection('sessions')
        .where('instructorEmails', 'array-contains', myEmail)
        .onSnapshot(snap => {
          listedRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          publish();
        }, err => {
          console.warn('listed sessions listener error:', err);
        });
    }

    unsubRef.current = () => {
      cancelled = true;
      unsubOwned();
      unsubListed();
    };
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [currentInstructor, instructorOwnerId, instructorLegacyOwnerId, instructorEmail, isDemoMode, db]);


  function loadDemoSessions() {
    const hidden = getDemoHiddenSessionIds();
    const sessions = [DEMO_SESSION].filter(s => !hidden.includes(s.id));
    useInstructorStore.getState().setAllSessions(sessions);
    useInstructorStore.getState().setInstructorSessionsHydrated(true);

    if (sessions.length) {
      useInstructorStore.getState().setActiveSessionCode(DEMO_SESSION_CODE);
      const qs = DEMO_QUESTIONS_TEMPLATE.map(q => ({ ...q, voters: [...q.voters] }));
      useInstructorStore.getState().setQuestionPages([{ questions: qs, endSnap: null }]);
      useInstructorStore.getState().setCurrentPage(0);
      // Demo never subscribes, so nothing else would clear the loading state.
      useInstructorStore.getState().setQuestionsHydrated(true);
      useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(true);
      persistInstructorActiveSession(DEMO_SESSION_CODE);
    }
  }

  function tryRestoreActiveSession(sessions) {
    const current = useInstructorStore.getState();
    if (current.isDemoMode || current.activeSessionCode) return;
    let saved = null;
    try { saved = readInstructorActiveSessionFromStorage(); } catch (e) { return; }
    if (!saved || !sessions.length) return;
    if (sessions.some(s => s.id === saved)) {
      useInstructorStore.getState().setActiveSessionCode(saved);
    } else {
      try {
        sessionStorage.removeItem('sqa_instructor_active_session');
        sessionStorage.removeItem('tdx_instructor_active_session');
      } catch (e) {}
    }
  }

  const hideSession = async (sessionCode) => {
    const state = useInstructorStore.getState();
    const finishHide = () => {
      const wasActive = state.activeSessionCode === sessionCode;
      const newSessions = state.allSessions.filter(s => s.id !== sessionCode);
      useInstructorStore.getState().setAllSessions(newSessions);
      if (wasActive) {
        if (newSessions.length) {
          useInstructorStore.getState().setActiveSessionCode(newSessions[0].id);
        } else {
          useInstructorStore.getState().setActiveSessionCode(null);
          persistInstructorActiveSession(null);
        }
      }
      useInstructorStore.getState().showToast('Session hidden. Rejoin with the code anytime.');
    };

    if (state.isDemoMode) {
      const arr = getDemoHiddenSessionIds();
      if (!arr.includes(sessionCode)) arr.push(sessionCode);
      try {
        sessionStorage.setItem(DEMO_SESSIONS_HIDDEN_KEY, JSON.stringify(arr));
      } catch (e) {}
      finishHide();
      return;
    }

    if (!db) return;
    const ownerId = state.instructorOwnerId || nameToId(state.currentInstructor || '');
    try {
      // set(..., {merge:true}) so the doc is created if this is the instructor's first
      // write under the stable email-based id (older data lived under the legacy id).
      await db.collection('instructors').doc(ownerId).set({
        sessionsHiddenFromList: firebase.firestore.FieldValue.arrayUnion(sessionCode),
      }, { merge: true });
    } catch (e) {
      console.warn('Hide session failed:', e);
      useInstructorStore.getState().showToast('Could not update your session list. Try again.');
      return;
    }
    finishHide();
  };

  return { hideSession };
}
