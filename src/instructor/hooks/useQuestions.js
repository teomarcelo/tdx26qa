import { useEffect, useRef } from 'react';
import { QUESTIONS_PAGE_SIZE } from '../../constants/app.js';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import useInstructorStore from '../store/useInstructorStore.js';

/**
 * Page 0's last document is the cursor every older page was fetched from. When a
 * student posts, page 0 shifts and that cursor moves, so the older pages we already
 * hold describe a window that no longer starts where page 0 ends — the questions
 * in between belong to no page at all.
 */
function boundaryIdOf(page) {
  return page && page.endSnap ? page.endSnap.id : null;
}

function page0BoundaryMoved(prevPage0, nextEndSnap) {
  if (!prevPage0) return false;
  return boundaryIdOf(prevPage0) !== (nextEndSnap ? nextEndSnap.id : null);
}

// Outcomes of a healing walk that are not a page index.
const HEAL_SESSION_CHANGED = -1;
const HEAL_BOUNDARY_UNSTABLE = -2;

/** Restarts allowed when page 0 moves while a healing walk is fetching. */
const HEAL_RESTART_LIMIT = 3;

function hasStalePagesUpTo(pages, targetIdx) {
  for (let i = 1; i <= targetIdx && i < pages.length; i++) {
    if (pages[i] && pages[i].stale) return true;
  }
  return false;
}

export function useQuestions() {
  const { db } = useFirebase();
  const unsubRef = useRef(null);

  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const isDemoMode = useInstructorStore(s => s.isDemoMode);

  // Subscribe to questions when active session changes (non-demo)
  useEffect(() => {
    // Clean up previous listener
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    // Demo mode seeds questionPages directly (useSessions.loadDemoSessions), so
    // clearing here would wipe the demo feed it just populated.
    if (isDemoMode) return;

    // Clear before subscribing, not after the snapshot returns: the outgoing
    // session's questions would otherwise stay on screen under the incoming
    // session's header for the length of the round trip.
    useInstructorStore.getState().resetQuestionsForSession();

    if (!activeSessionCode || !db) return;

    const unsub = db.collection('sessions').doc(activeSessionCode).collection('questions')
      .orderBy('createdAt', 'desc')
      .limit(QUESTIONS_PAGE_SIZE)
      .onSnapshot(snap => {
        const questions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

        useInstructorStore.getState().setQuestionsHydrated(true);

        const state = useInstructorStore.getState();
        // Only page 0 is live. Older pages keep their cached contents (search and
        // the votes sort read every page, so dropping them here would starve those
        // views) but are marked stale when page 0's boundary moves, and refetched
        // on navigation.
        const boundaryMoved = page0BoundaryMoved(state.questionPages[0], endSnap);
        const olderPages = state.questionPages.slice(1).map(p => (
          boundaryMoved && p ? { ...p, stale: true } : p
        ));
        const newPages = [{ questions, endSnap, stale: false }, ...olderPages];
        useInstructorStore.getState().setQuestionPages(newPages);
        if (state.currentPage === 0) {
          useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(questions.length < QUESTIONS_PAGE_SIZE);
        }
      }, err => {
        // Mark hydrated on failure too, otherwise the loading state never clears
        // and a permissions or network error reads as an indefinite hang.
        console.error('Questions subscription failed:', err);
        useInstructorStore.getState().setQuestionsHydrated(true);
        useInstructorStore.getState().showToast('Could not load questions. Check your connection.');
      });

    unsubRef.current = unsub;
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [activeSessionCode, isDemoMode, db]);

  /** One page of questions immediately older than `cursorDoc`. */
  const fetchPageAfter = async (sessionCode, cursorDoc) => {
    const snap = await db.collection('sessions').doc(sessionCode).collection('questions')
      .orderBy('createdAt', 'desc')
      .startAfter(cursorDoc)
      .limit(QUESTIONS_PAGE_SIZE)
      .get();
    return {
      questions: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      endSnap: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
      stale: false,
    };
  };

  /**
   * One pass over stale pages 1..targetIdx, refetching each off the page before it.
   * Returns the highest page index that still exists afterwards,
   * HEAL_SESSION_CHANGED when the session changed mid-fetch and the result must be
   * discarded, or HEAL_BOUNDARY_UNSTABLE when page 0 moved while a fetch was in
   * flight, which invalidates that result and everything the walk healed before it.
   */
  const healStalePagesOnce = async (targetIdx) => {
    const sessionCode = useInstructorStore.getState().activeSessionCode;
    let reachable = targetIdx;

    for (let i = 1; i <= reachable; i++) {
      const state = useInstructorStore.getState();
      if (state.activeSessionCode !== sessionCode) return HEAL_SESSION_CHANGED;
      const page = state.questionPages[i];
      if (page && !page.stale) continue;

      const prev = state.questionPages[i - 1];
      if (!prev || !prev.endSnap) {
        // The page before this one no longer fills a full page, so there is
        // nothing older to show.
        useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(true);
        useInstructorStore.getState().setQuestionPagesAndPage(state.questionPages.slice(0, i), i - 1);
        return i - 1;
      }

      // Page 0's boundary is the generation this fetch is issued against: a
      // question arriving while it is in flight moves that boundary and re-stales
      // every page behind it. Committing the result anyway is what reopens the
      // pagination gap — the questions between the old and the new boundary would
      // sit on no page, with the stale flag cleared so nothing heals them.
      const boundary = boundaryIdOf(state.questionPages[0]);
      const fresh = await fetchPageAfter(sessionCode, prev.endSnap);
      const latest = useInstructorStore.getState();
      if (latest.activeSessionCode !== sessionCode) return HEAL_SESSION_CHANGED;
      if (boundaryIdOf(latest.questionPages[0]) !== boundary) return HEAL_BOUNDARY_UNSTABLE;

      if (!fresh.questions.length) {
        useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(true);
        useInstructorStore.getState().setQuestionPagesAndPage(latest.questionPages.slice(0, i), i - 1);
        return i - 1;
      }

      const pages = [...latest.questionPages];
      pages[i] = fresh;
      if (fresh.questions.length < QUESTIONS_PAGE_SIZE) {
        // A short page is the last one: anything cached beyond it was paged off a
        // cursor that no longer exists.
        pages.length = i + 1;
        useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(true);
        reachable = Math.min(reachable, i);
      }
      useInstructorStore.getState().setQuestionPagesAndPage(pages, latest.currentPage);
    }

    const pageCount = useInstructorStore.getState().questionPages.length;
    return Math.min(reachable, Math.max(0, pageCount - 1));
  };

  /**
   * Heal stale pages 1..targetIdx, re-deriving from the current page-0 boundary
   * whenever an arrival moved it mid-walk. Bounded rather than looping until the
   * feed settles: a busy workshop can move the boundary indefinitely, and each
   * restart costs a page of reads per stale page. When the restarts run out the
   * pages are left stale, so the next navigation picks the heal back up.
   */
  const refreshStalePagesUpTo = async (targetIdx) => {
    for (let attempt = 0; attempt < HEAL_RESTART_LIMIT; attempt++) {
      const reachable = await healStalePagesOnce(targetIdx);
      if (reachable !== HEAL_BOUNDARY_UNSTABLE) return reachable;
    }
    return HEAL_BOUNDARY_UNSTABLE;
  };

  const goToPage = async (zeroBased) => {
    const state = useInstructorStore.getState();
    if (state.questionsLoading) return;
    if (zeroBased < 0 || zeroBased >= state.questionPages.length || !state.questionPages[zeroBased]) return;
    const target = state.questionPages[zeroBased];
    // Re-selecting the page you are on is a no-op unless it went stale, in which
    // case it is the instructor's way of pulling the fresh window.
    if (zeroBased === state.currentPage && !target.stale) return;

    if (!hasStalePagesUpTo(state.questionPages, zeroBased) || state.isDemoMode || !db) {
      useInstructorStore.getState().setCurrentPage(zeroBased);
      return;
    }

    useInstructorStore.getState().setQuestionsLoading(true);
    try {
      const reachable = await refreshStalePagesUpTo(zeroBased);
      if (reachable === HEAL_SESSION_CHANGED) return; // the new session's snapshot owns the state
      if (reachable === HEAL_BOUNDARY_UNSTABLE) {
        useInstructorStore.getState().showToast('New questions kept arriving. Try that page again.');
        return;
      }
      useInstructorStore.getState().setCurrentPage(reachable);
    } catch (e) {
      console.error('Refreshing older question pages failed:', e);
      useInstructorStore.getState().showToast('Could not refresh older questions. Try again.');
    } finally {
      useInstructorStore.getState().setQuestionsLoading(false);
    }
  };

  const goPreviousPage = async () => {
    const state = useInstructorStore.getState();
    if (state.currentPage <= 0) return;
    await goToPage(state.currentPage - 1);
  };

  const goNextPage = async () => {
    const state = useInstructorStore.getState();
    if (state.questionsLoading) return;

    // If there's a cached next page, just go there (goToPage refetches it first if
    // a new question shifted the window since it was cached).
    if (state.currentPage < state.questionPages.length - 1) {
      await goToPage(state.currentPage + 1);
      return;
    }

    // Otherwise load older from Firestore
    await loadOlderPage();
  };

  const loadOlderPage = async () => {
    let state = useInstructorStore.getState();
    if (!state.activeSessionCode || state.isDemoMode || state.questionsLoading) return;
    if (state.instructorOlderBeyondLoadExhausted) return;

    // Page off a cursor that is still consistent with page 0: if the pages up to
    // here went stale, refresh them first, otherwise the new page repeats or skips
    // questions relative to the pages around it.
    if (hasStalePagesUpTo(state.questionPages, state.currentPage)) {
      await goToPage(state.currentPage);
      state = useInstructorStore.getState();
      if (state.instructorOlderBeyondLoadExhausted) return;
      // Still stale means the heal gave up (or an arrival landed right after it).
      // Paging off a cursor that no longer joins page 0 is the gap this avoids;
      // goToPage has already said so, so just leave it for the next attempt.
      if (hasStalePagesUpTo(state.questionPages, state.currentPage)) return;
    }

    const cur = state.questionPages[state.currentPage];
    if (!cur || !cur.endSnap || cur.questions.length < QUESTIONS_PAGE_SIZE) return;

    useInstructorStore.getState().setQuestionsLoading(true);
    try {
      const fresh = await fetchPageAfter(state.activeSessionCode, cur.endSnap);
      const latest = useInstructorStore.getState();
      if (latest.activeSessionCode !== state.activeSessionCode) return;

      if (!fresh.questions.length) {
        useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(true);
        return;
      }

      const nextIdx = state.currentPage + 1;
      const newPages = [...latest.questionPages];
      newPages[nextIdx] = fresh;

      useInstructorStore.getState().setInstructorOlderBeyondLoadExhausted(fresh.questions.length < QUESTIONS_PAGE_SIZE);
      useInstructorStore.getState().setQuestionPagesAndPage(newPages, nextIdx);
    } catch (e) {
      console.error('Load older questions failed:', e);
      useInstructorStore.getState().showToast('Could not load older questions. Try again.');
    } finally {
      useInstructorStore.getState().setQuestionsLoading(false);
    }
  };

  return { goToPage, goPreviousPage, goNextPage };
}
