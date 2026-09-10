import { useCallback, useEffect, useRef, useState } from 'react';
import { IS_STUDENT_DEMO } from '../demo/useStudentDemoStore.js';

/**
 * Hard cap on a corpus fetch. A workshop that somehow runs past this many
 * questions degrades to "the newest N", which is still vastly more than the ten
 * the local page cache holds — and the cap is what keeps the read cost of this
 * query bounded and predictable at event scale.
 */
export const FULL_CORPUS_MAX = 300;

/**
 * Minimum gap between corpus fetches for the same session. Toggling filters
 * back and forth, or flipping the sort a few times, must not turn into a query
 * storm: inside this window the previous result is reused.
 */
const FULL_CORPUS_TTL_MS = 20_000;

/**
 * True when the current view is answering a question about the whole session
 * rather than about the visible page. The page cache only ever holds the newest
 * ten questions, so these views cannot be served from it without silently
 * returning the wrong answer.
 */
export function viewNeedsFullCorpus(filter, sort, searchQuery) {
  return (
    !!searchQuery ||
    sort === 'votes' ||
    filter === 'answered' ||
    filter === 'pinned' ||
    filter === 'unanswered'
  );
}

/**
 * Split a corpus read into the capped corpus plus an exact truncation flag.
 *
 * The query below asks for one document more than the cap so this can tell a
 * session holding exactly FULL_CORPUS_MAX questions (nothing missing) from one
 * holding more (older questions absent). That probe document costs one extra
 * read per fetch and is never rendered; it buys a truncation flag that is exact
 * instead of one that cries wolf on the boundary.
 */
export function capFetchedCorpus(questions) {
  if (questions.length <= FULL_CORPUS_MAX) return { questions, truncated: false };
  return { questions: questions.slice(0, FULL_CORPUS_MAX), truncated: true };
}

/**
 * Plain-language warning for a view that answers a whole-session question from a
 * corpus that stopped at FULL_CORPUS_MAX. Empty for every view that is telling
 * the truth, which is nearly all of them: a session has to run past the cap
 * before an attendee sees anything.
 */
export function corpusScopeNotice(filter, sort, searchQuery, truncated) {
  if (!truncated) return '';
  if (!viewNeedsFullCorpus(filter, sort, searchQuery)) return '';
  if (searchQuery) {
    return `This session has a lot of questions. Search covers the newest ${FULL_CORPUS_MAX}.`;
  }
  if (sort === 'votes') {
    return `Ranked from the newest ${FULL_CORPUS_MAX} questions. This session has more, so an older question could have more votes.`;
  }
  return `Picked from the newest ${FULL_CORPUS_MAX} questions. This session has more, so older ones are not listed here.`;
}

/**
 * Fetches the session's questions once, on demand, for views that need the whole
 * corpus (search, votes sort, Pinned/Answered/Unanswered).
 *
 * BILLING-SENSITIVE (read before editing):
 * Every fetch here costs up to FULL_CORPUS_MAX + 1 document reads, and hundreds
 * of students can be on one session. Three things keep that bounded, and all
 * three are load-bearing:
 *   1. It only ever runs when `enabled` is true — the default recent/all feed
 *      never touches it.
 *   2. `requestKey` is a coarse token (which view is active), not the live search
 *      string, so typing does not refetch.
 *   3. FULL_CORPUS_TTL_MS floors the gap between fetches, and an in-flight guard
 *      collapses concurrent triggers.
 * There is deliberately NO polling interval: a student parked on "Top voted"
 * costs one fetch, not one per minute.
 *
 * The in-flight guard queues rather than drops. A trigger it turns away sets
 * `waitingOnFetch`, and the read that turned it away flips that back when it
 * settles, which re-runs this effect. A plain boolean guard silently swallowed
 * the trigger instead: switch session mid-fetch and the new session never
 * fetched at all, because nothing re-ran the effect once the old read finished.
 *
 * The query is `orderBy('createdAt','desc').limit(n)` — the same single-field
 * index the paginated feed already uses, so no composite index is involved.
 *
 * Demo mode (`db` is null) never fetches; the caller falls back to the in-memory
 * demo questions, which are a single complete page anyway.
 */
export function useFullQuestionCorpus(sessionCode, db, enabled, requestKey) {
  const [corpus, setCorpus] = useState([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // True while a trigger sits behind the in-flight guard. State rather than a
  // ref because flipping it is what re-runs the effect below.
  const [waitingOnFetch, setWaitingOnFetch] = useState(false);

  // The session on screen right now. A response for any other session is
  // dropped, so a slow read for the session the student just left can never
  // paint its questions under the new session's header.
  const activeCodeRef = useRef(null);
  // Session code of the read on the wire, or null. Identity rather than a bare
  // boolean, so a stale read can never be mistaken for the live one.
  const inFlightCodeRef = useRef(null);
  const fetchedAtRef = useRef(0);
  const fetchedCodeRef = useRef(null);

  // Drop a previous session's corpus immediately, so a stale board can never be
  // filtered under the incoming session's header.
  useEffect(() => {
    activeCodeRef.current = sessionCode;
    setCorpus([]);
    setTruncated(false);
    fetchedAtRef.current = 0;
    fetchedCodeRef.current = null;
  }, [sessionCode]);

  useEffect(() => {
    if (!enabled || IS_STUDENT_DEMO || !db || !sessionCode) {
      // Nothing is pending for this view, so it must not keep the spinner.
      setLoading(false);
      return undefined;
    }

    const fresh =
      fetchedCodeRef.current === sessionCode &&
      Date.now() - fetchedAtRef.current < FULL_CORPUS_TTL_MS;
    if (fresh) {
      setLoading(false);
      return undefined;
    }

    if (inFlightCodeRef.current) {
      // A read is already on the wire. Starting a second one here is the query
      // storm the guard exists to prevent, so queue behind it instead.
      setLoading(true);
      if (!waitingOnFetch) setWaitingOnFetch(true);
      return undefined;
    }

    const code = sessionCode;
    inFlightCodeRef.current = code;
    setLoading(true);

    // Single ordered read of the session's questions. Same ordering as the
    // paginated feed, so the two agree on what "newest" means. The +1 is the
    // truncation probe described on capFetchedCorpus.
    db.collection('sessions')
      .doc(code)
      .collection('questions')
      .orderBy('createdAt', 'desc')
      .limit(FULL_CORPUS_MAX + 1)
      .get()
      .then((snap) => {
        if (activeCodeRef.current !== code) return;
        const fetched = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const capped = capFetchedCorpus(fetched);
        fetchedAtRef.current = Date.now();
        fetchedCodeRef.current = code;
        setCorpus(capped.questions);
        setTruncated(capped.truncated);
      })
      .catch((e) => {
        // A failed corpus fetch must not blank the board: the caller keeps
        // showing the cached pages, so the view degrades to the old behaviour
        // rather than to an error screen.
        console.warn('useFullQuestionCorpus fetch error:', e);
      })
      .finally(() => {
        inFlightCodeRef.current = null;
        // Only the session on screen owns the spinner: a read that finished for
        // a session the student has left must not report "done" on behalf of the
        // session that replaced it, which is still waiting for its own read.
        if (activeCodeRef.current === code) setLoading(false);
        // Releases any trigger this read turned away. Set unconditionally: when
        // nothing was queued this is a no-op, so a failed read cannot become a
        // retry loop.
        setWaitingOnFetch(false);
      });

    return undefined;
  }, [db, sessionCode, enabled, requestKey, waitingOnFetch]);

  /** Apply a local change (an upvote) to the fetched corpus so it stays in step. */
  const patchCorpusQuestion = useCallback((id, updater) => {
    setCorpus((prev) => {
      if (!prev.some((q) => q.id === id)) return prev;
      return prev.map((q) => (q.id === id ? updater(q) : q));
    });
  }, []);

  return { corpus, corpusLoading: loading, corpusTruncated: truncated, patchCorpusQuestion };
}
