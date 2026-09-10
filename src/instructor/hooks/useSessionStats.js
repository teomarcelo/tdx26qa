import { useRef, useCallback, useEffect } from 'react';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import { fetchSessionQuestionCountStats } from '../../lib/sessionQuestionCounts.js';
import useInstructorStore from '../store/useInstructorStore.js';

// Collapses bursts of question changes (a page load, a wave of upvotes) into a
// single aggregate query.
const STATS_DEBOUNCE_MS = 400;

// Hard ceiling on how long the debounce may keep deferring. Every change to
// questionPages restarts the 400ms timer, and at event scale changes arrive faster
// than that, which froze the tiles indefinitely — precisely when the room is busy.
// Past this point the next schedule runs immediately.
const STATS_MAX_WAIT_MS = 5_000;

// Background refresh, mirroring the student hook: the live listener only watches
// page 0, so a co-instructor answering an older question would otherwise leave the
// tiles stale until the visible feed happens to change.
const STATS_REFRESH_MS = 60_000;

// Floor between two runs of the periodic refresh, so it can never stack on top of
// the change-driven refreshes above and amplify reads.
const STATS_REFRESH_MIN_GAP_MS = 30_000;

/**
 * Session-wide question counts for the sidebar tiles.
 *
 * BILLING-SENSITIVE (read before editing):
 * Each refresh issues three Firestore `count()` aggregate queries (total, answered,
 * pinned). The debounce plus the max wait bound the worst case at one refresh every
 * STATS_MAX_WAIT_MS — 12 refreshes, i.e. 36 aggregate reads, per minute per open
 * instructor tab, and only while questions are actually changing that fast. The
 * periodic refresh below adds nothing to that ceiling because it skips when a
 * refresh already ran inside STATS_REFRESH_MIN_GAP_MS, and skips entirely on a
 * hidden tab. Do not remove either guard.
 */
export function useSessionStats() {
  const { db } = useFirebase();
  const timerRef = useRef(null);
  // When the currently-deferred refresh was first asked for. Survives the effect
  // re-runs that call cancelPending(), which is what makes the max wait real.
  const pendingSinceRef = useRef(0);
  const lastRunAtRef = useRef(0);

  const getAllCachedQuestions = useCallback(() => {
    const { questionPages } = useInstructorStore.getState();
    const m = new Map();
    questionPages.forEach(p => { (p.questions || []).forEach(q => m.set(q.id, q)); });
    return Array.from(m.values());
  }, []);

  const applyFromCache = useCallback(() => {
    const qs = getAllCachedQuestions();
    useInstructorStore.getState().setStats({
      total: qs.length,
      answered: qs.filter(q => q.status === 'answered').length,
      pending: qs.filter(q => q.status !== 'answered').length,
      pinned: qs.filter(q => q.pinned).length,
    });
  }, [getAllCachedQuestions]);

  const runRefresh = useCallback(() => {
    pendingSinceRef.current = 0;
    lastRunAtRef.current = Date.now();
    const state = useInstructorStore.getState();
    const { activeSessionCode, isDemoMode, statsSerial } = state;
    if (!activeSessionCode || isDemoMode || !db) {
      applyFromCache();
      return;
    }

    const serialAtStart = statsSerial;
    fetchSessionQuestionCountStats(activeSessionCode)
      .then((stats) => {
        const current = useInstructorStore.getState();
        if (current.statsSerial !== serialAtStart || current.activeSessionCode !== activeSessionCode) return;
        current.setStats({
          total: stats.total,
          answered: stats.answered,
          pending: stats.pending,
          pinned: stats.pinned,
        });
      })
      .catch(() => {
        const current = useInstructorStore.getState();
        if (current.statsSerial !== serialAtStart || current.activeSessionCode !== activeSessionCode) return;
        applyFromCache();
      });
  }, [db, applyFromCache]);

  const scheduleRefresh = useCallback(() => {
    const state = useInstructorStore.getState();
    if (state.isDemoMode || !state.activeSessionCode || !db) {
      applyFromCache();
      return;
    }
    const now = Date.now();
    if (!pendingSinceRef.current) pendingSinceRef.current = now;
    // Shrink the debounce as the max wait runs out, so a continuous stream of
    // changes still produces a refresh roughly every STATS_MAX_WAIT_MS.
    const remaining = STATS_MAX_WAIT_MS - (now - pendingSinceRef.current);
    const delay = Math.max(0, Math.min(STATS_DEBOUNCE_MS, remaining));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runRefresh();
    }, delay);
  }, [db, runRefresh, applyFromCache]);

  const updateStats = useCallback(() => {
    const state = useInstructorStore.getState();
    if (state.isDemoMode || !state.activeSessionCode || !db) {
      applyFromCache();
      return;
    }
    scheduleRefresh();
  }, [db, applyFromCache, scheduleRefresh]);

  // Cancels only the deferred run, never the max-wait clock: the caller re-arms the
  // timer immediately, and resetting the clock here is what let the tiles starve.
  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Periodic safety net for changes the page-0 listener never sees.
  useEffect(() => {
    const interval = setInterval(() => {
      const state = useInstructorStore.getState();
      if (state.isDemoMode || !state.activeSessionCode || !db) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - lastRunAtRef.current < STATS_REFRESH_MIN_GAP_MS) return;
      runRefresh();
    }, STATS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [db, runRefresh]);

  return { updateStats, applyFromCache, cancelPending, runRefresh };
}
