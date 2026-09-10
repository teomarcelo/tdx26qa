import { useState, useEffect, useRef, useCallback } from 'react';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import { QUESTIONS_PAGE_SIZE } from '../../constants/app.js';
import useStudentDemoStore, { IS_STUDENT_DEMO } from '../demo/useStudentDemoStore.js';

/**
 * Manages paginated question fetching for the student board.
 *
 * Page 0 is driven by a LIVE onSnapshot listener (instant updates; Firestore
 * charges mainly for changed docs, not a full re-read every interval). Older
 * pages (1..n) are still fetched on demand with cursor `.get()` calls.
 *
 * Cache/pagination behavior is preserved:
 *  - Pagination uses a pages array: each page has { questions, endSnap }.
 *  - Older cached pages are served without a re-fetch when navigating back.
 *  - Whenever page 0 refreshes while it is the visible page, older cached pages
 *    are dropped (their cursors may be stale) — matching the prior poll logic.
 *
 * That last point means the page cache is NOT a view of the session: it holds
 * the visible page and, at most, whatever older pages have survived since the
 * last page-0 refresh. Anything that needs the whole session (search, the votes
 * sort, the Pinned/Answered/Unanswered filters) must go through
 * useFullQuestionCorpus instead of filtering this cache, or it will silently
 * answer from ten questions. Dropping the older pages here is what keeps the
 * `startAfter` cursors honest, so it stays.
 *
 * Demo mode (no `db`) is unaffected: no listener is attached and the board is
 * populated by the store, exactly as before.
 *
 * `pollSkipUntilRef` is retained for signature/coordination with useUpvote but
 * is no longer used to gate a polling interval (there is none).
 */
export function useQuestions(sessionCode, pollSkipUntilRef) {  
  const { db } = useFirebase();

  // Demo mode: the board is driven entirely by the in-memory demo store. This
  // subscription is a harmless no-op in the real flow (the store never changes),
  // and it is called unconditionally to respect the rules of hooks.
  const demoQuestions = useStudentDemoStore((s) => s.questions);

  const [questionPages, setQuestionPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadingRef = useRef(false);
  const unsubRef = useRef(null);
  // Latest page-0 snapshot, kept so returning to page 0 shows fresh live data.
  const latestPage0Ref = useRef(null);
  // Keep refs to currentPage/questionPages so callbacks read the latest values
  // without being in their deps (avoids stale closures in pagination callbacks).
  const currentPageRef = useRef(0);
  const questionPagesRef = useRef([]);

  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { questionPagesRef.current = questionPages; }, [questionPages]);

  const allQuestions = questionPages[currentPage]?.questions ?? [];

  /** Commit a fresh page-0 result, dropping stale older pages (cursor safety). */
  const commitPage0 = useCallback((questions, endSnap) => {
    setQuestionPages((prev) => {
      const next = prev.slice();
      next[0] = { questions, endSnap };
      return next.slice(0, 1);
    });
    setCurrentPage(0);
    setOlderExhausted(questions.length < QUESTIONS_PAGE_SIZE);
  }, []);

  /** One-shot refresh of page 0 (Refresh button / after submit). */
  const fetchFirstPage = useCallback(async () => {
    if (IS_STUDENT_DEMO) return;
    if (!db || !sessionCode) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const snap = await db
        .collection('sessions')
        .doc(sessionCode)
        .collection('questions')
        .orderBy('createdAt', 'desc')
        .limit(QUESTIONS_PAGE_SIZE)
        .get();

      const questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      latestPage0Ref.current = { questions, endSnap };
      commitPage0(questions, endSnap);
    } catch (e) {
      console.warn('useQuestions fetchFirstPage error:', e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [db, sessionCode, commitPage0]);

  /** Load or navigate to the next (older) page. */
  const goNextPage = useCallback(async () => {
    if (IS_STUDENT_DEMO) return;
    if (!db || !sessionCode || loadingRef.current) return;

    const cp = currentPageRef.current;
    const pages = questionPagesRef.current;
    const nextIdx = cp + 1;

    // Navigate to already-cached page without a fetch
    if (pages[nextIdx]) {
      setCurrentPage(nextIdx);
      return;
    }

    // Need to fetch the next page
    const cur = pages[cp];
    if (!cur || !cur.endSnap || cur.questions.length < QUESTIONS_PAGE_SIZE) return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const snap = await db
        .collection('sessions')
        .doc(sessionCode)
        .collection('questions')
        .orderBy('createdAt', 'desc')
        .startAfter(cur.endSnap)
        .limit(QUESTIONS_PAGE_SIZE)
        .get();

      if (!snap.docs.length) {
        setOlderExhausted(true);
        return;
      }
      const questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      setQuestionPages((pp) => {
        const next = pp.slice();
        next[nextIdx] = { questions, endSnap };
        return next;
      });
      setCurrentPage(nextIdx);
      setOlderExhausted(snap.docs.length < QUESTIONS_PAGE_SIZE);
    } catch (e) {
      console.warn('useQuestions goNextPage error:', e);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [db, sessionCode]);

  /**
   * Reconcile one question after a vote, without moving the student off the page
   * they are reading. Returns the fresh doc (or null) so a caller can patch its
   * own cache from the same single read instead of issuing a second one.
   *
   * fetchFirstPage() is deliberately NOT used here: it ends in commitPage0,
   * which calls setCurrentPage(0) and would throw a student browsing older
   * questions back to the newest page.
   */
  const refreshQuestionAfterVote = useCallback(async (id) => {
    if (IS_STUDENT_DEMO) return null;
    if (!db || !sessionCode || !id) return null;
    try {
      // One document read. The vote itself is applied server-side with
      // FieldValue.increment, so re-reading the doc is the only way to get the
      // authoritative tally without guessing the delta locally.
      const doc = await db
        .collection('sessions')
        .doc(sessionCode)
        .collection('questions')
        .doc(id)
        .get();
      if (!doc.exists) return null;
      const fresh = { id: doc.id, ...doc.data() };
      setQuestionPages((prev) =>
        prev.map((p) =>
          p && p.questions && p.questions.some((q) => q.id === id)
            ? { ...p, questions: p.questions.map((q) => (q.id === id ? fresh : q)) }
            : p,
        ),
      );
      return fresh;
    } catch (e) {
      console.warn('useQuestions refreshQuestionAfterVote error:', e);
      return null;
    }
  }, [db, sessionCode]);

  /** Navigate to previous (newer) page — cached; refresh page 0 from the listener. */
  const goPrevPage = useCallback(() => {
    const cp = currentPageRef.current;
    if (cp <= 0) return;
    const target = cp - 1;
    // Returning to page 0: show the freshest live snapshot and drop stale older pages.
    if (target === 0 && latestPage0Ref.current) {
      commitPage0(latestPage0Ref.current.questions, latestPage0Ref.current.endSnap);
      return;
    }
    setCurrentPage(target);
  }, [commitPage0]);

  /** Jump directly to a cached page by zero-based index. */
  const goToPage = useCallback((idx) => {
    if (idx === 0 && latestPage0Ref.current) {
      commitPage0(latestPage0Ref.current.questions, latestPage0Ref.current.endSnap);
      return;
    }
    const pages = questionPagesRef.current;
    if (idx < 0 || idx >= pages.length || !pages[idx]) return;
    setCurrentPage(idx);
  }, [commitPage0]);

  // --- Reset + live listener when the session (or db) changes ---
  useEffect(() => {
    // Demo mode never attaches a Firestore listener — the demo store is the feed.
    if (IS_STUDENT_DEMO) return;
    if (!sessionCode) return;

    // Reset all state for the new session
    setQuestionPages([]);
    setCurrentPage(0);
    setOlderExhausted(false);
    loadingRef.current = false;
    currentPageRef.current = 0;
    questionPagesRef.current = [];
    latestPage0Ref.current = null;

    // Tear down any prior listener
    if (typeof unsubRef.current === 'function') {
      try { unsubRef.current(); } catch (e) {}
      unsubRef.current = null;
    }

    if (!db) return; // demo / no config: store drives the board

    setLoading(true);
    // Live listener on the newest page. The initial snapshot fires immediately
    // with current docs, so no separate initial fetch is needed.
    const unsub = db
      .collection('sessions')
      .doc(sessionCode)
      .collection('questions')
      .orderBy('createdAt', 'desc')
      .limit(QUESTIONS_PAGE_SIZE)
      .onSnapshot(
        (snap) => {
          const questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
          latestPage0Ref.current = { questions, endSnap };
          // Only mutate the visible feed when the user is on page 0, so live
          // updates never disrupt someone reading an older page.
          if (currentPageRef.current === 0) {
            commitPage0(questions, endSnap);
          }
          setLoading(false);
        },
        (err) => {
          // Listener failure should not break the feed; leave any cached data in place.
          console.warn('useQuestions onSnapshot error:', err);
          setLoading(false);
        },
      );
    unsubRef.current = unsub;

    return () => {
      if (typeof unsubRef.current === 'function') {
        try { unsubRef.current(); } catch (e) {}
        unsubRef.current = null;
      }
    };
    // commitPage0 is stable; fetchFirstPage not needed here (listener populates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCode, db]);

  /** All questions across all cached pages (for stats / search). */
  const getAllCached = useCallback(() => {
    const m = new Map();
    questionPagesRef.current.forEach((p) => {
      (p.questions || []).forEach((q) => m.set(q.id, q));
    });
    return Array.from(m.values());
  }, []);

  /** Reset to page 0 and clear cache (for manual refresh). */
  const reset = useCallback(() => {
    setQuestionPages([]);
    setCurrentPage(0);
    setOlderExhausted(false);
    loadingRef.current = false;
    currentPageRef.current = 0;
    questionPagesRef.current = [];
  }, []);

  // Demo mode: serve the seeded questions from the in-memory store as a single
  // page. No cursors, no pagination, no listener — but the exact same return
  // shape the components consume, with the fetch/nav callbacks as safe no-ops.
  if (IS_STUDENT_DEMO) {
    const demoPages = [{ questions: demoQuestions, endSnap: null }];
    return {
      allQuestions: demoQuestions,
      questionPages: demoPages,
      currentPage: 0,
      olderExhausted: true,
      loading: false,
      fetchFirstPage,
      goNextPage,
      goPrevPage,
      goToPage,
      getAllCached: () => demoQuestions.slice(),
      refreshQuestionAfterVote,
      reset,
    };
  }

  return {
    allQuestions,
    questionPages,
    currentPage,
    olderExhausted,
    loading,
    fetchFirstPage,
    goNextPage,
    goPrevPage,
    goToPage,
    getAllCached,
    refreshQuestionAfterVote,
    reset,
  };
}
