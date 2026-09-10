/**
 * QuestionsList — renders filtered/sorted question cards and pagination.
 */
import { useMemo } from 'react';
import { QUESTIONS_PAGE_SIZE } from '../../constants/app.js';
import { filterCorpusByFuseSearch } from '../../lib/questionSearch.js';
import useInstructorStore from '../store/useInstructorStore.js';
import { useQuestions } from '../hooks/useQuestions.js';
import QuestionCard from './QuestionCard.jsx';
import {
  instructorOnboardingWelcomePending,
  clearInstructorOnboardingWelcomeFlag,
} from '../hooks/useInstructorAuth.js';

function getSearchHaystack(q) {
  const bits = [q.text, q.authorName, q.authorEmail];
  const answers = q.answers && q.answers.length ? q.answers : (q.answer ? [{ text: q.answer, instructor: 'Instructor' }] : []);
  answers.forEach(a => {
    bits.push(a.text, a.instructor);
    if (Array.isArray(a.imageUrls)) bits.push(a.imageUrls.join(' '));
  });
  return bits.filter(Boolean).join('\n');
}

function WelcomeState() {
  return (
    <div className="empty-state instructor-welcome">
      <h3>Welcome — pick a session</h3>
      <p className="instructor-welcome-lead">
        In the sidebar under <strong>My sessions</strong>, use <strong>+ New session</strong> to start a session (you'll get a short session code), or <strong>Join session</strong> if you already have a code from another host.
      </p>
      <ul>
        <li>Select a session in the list to load its questions, stats, and settings in this panel.</li>
        <li>Share the session code with students so they can join from the student page and post questions.</li>
        <li>New to the layout? From the sign-in screen, use <strong>Try the demo</strong> for sample questions (no Firebase required).</li>
      </ul>
    </div>
  );
}

function SelectSessionState() {
  return (
    <div className="empty-state instructor-welcome">
      <p className="instructor-welcome-lead">Select a session from <strong>My sessions</strong> to continue.</p>
    </div>
  );
}

export default function QuestionsList() {
  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const allQuestions = useInstructorStore(s => s.allQuestions);
  const questionPages = useInstructorStore(s => s.questionPages);
  const currentPage = useInstructorStore(s => s.currentPage);
  const currentFilter = useInstructorStore(s => s.currentFilter);
  const currentSort = useInstructorStore(s => s.currentSort);
  const searchQuery = useInstructorStore(s => s.searchQuery);
  const instructorSessionsHydrated = useInstructorStore(s => s.instructorSessionsHydrated);
  const questionsHydrated = useInstructorStore(s => s.questionsHydrated);
  const allSessions = useInstructorStore(s => s.allSessions);
  const instructorOlderBeyondLoadExhausted = useInstructorStore(s => s.instructorOlderBeyondLoadExhausted);
  const setCurrentSort = useInstructorStore(s => s.setCurrentSort);
  const setSearchQuery = useInstructorStore(s => s.setSearchQuery);

  const { goToPage, goPreviousPage, goNextPage } = useQuestions();

  // Build filtered + sorted question list
  const displayedQuestions = useMemo(() => {
    // Get all cached questions for search (across all pages)
    const m = new Map();
    questionPages.forEach(p => { (p.questions || []).forEach(q => m.set(q.id, q)); });
    const corpus = Array.from(m.values());

    // Use the full cross-page cache when searching, when sorting by votes (so
    // highly-voted older questions bubble up above newer lower-voted ones), and
    // when a status filter is on. A filter scoped to the current page contradicts
    // the session-wide count in the stats tile — 3 pending here, 7 on the next
    // page — and hides pending questions the instructor is trying to find. The
    // student board already filters over its full corpus; this matches it.
    const useCorpus = !!searchQuery || currentSort === 'votes' || currentFilter !== 'all';
    let qs = useCorpus
      ? (searchQuery ? filterCorpusByFuseSearch(corpus, searchQuery, getSearchHaystack) : [...corpus])
      : [...allQuestions];

    if (currentFilter === 'pinned') qs = qs.filter(q => q.pinned);
    else if (currentFilter === 'answered') qs = qs.filter(q => q.status === 'answered');
    else if (currentFilter === 'pending') qs = qs.filter(q => q.status !== 'answered');

    qs.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (currentSort === 'votes') return (b.votes || 0) - (a.votes || 0);
      const at = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
      const bt = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
      return bt - at;
    });

    return qs;
  }, [allQuestions, questionPages, currentFilter, currentSort, searchQuery]);

  // Pagination state
  const searching = !!searchQuery;
  const numLoaded = questionPages.length;
  const cur = questionPages[currentPage];
  const canPrev = currentPage > 0;
  const canNextCached = currentPage < numLoaded - 1;
  const canNextFetch = !instructorOlderBeyondLoadExhausted && !!(cur && cur.endSnap && cur.questions.length >= QUESTIONS_PAGE_SIZE);
  const canNext = canNextCached || canNextFetch;
  // The phantom slot loads the next page from Firestore, which only lands where its
  // number says when the instructor is already on the last loaded page. Offering it
  // from page 1 of 3 sent them to page 2 while the label and aria-label promised 4.
  const lastLoaded = questionPages[numLoaded - 1];
  const showPhantomNext = currentPage === numLoaded - 1
    && !instructorOlderBeyondLoadExhausted
    && !!(lastLoaded && lastLoaded.endSnap && lastLoaded.questions.length >= QUESTIONS_PAGE_SIZE);
  const totalSlots = numLoaded + (showPhantomNext ? 1 : 0);
  const maxNums = 5;
  let lo = 0, hi = totalSlots;
  if (totalSlots > maxNums) {
    const half = Math.floor(maxNums / 2);
    lo = Math.max(0, Math.min(currentPage - half, totalSlots - maxNums));
    hi = lo + maxNums;
  }
  const showPagination = !searching && !!activeSessionCode && numLoaded > 0;

  // No session selected
  if (!activeSessionCode) {
    const showWelcome = instructorOnboardingWelcomePending() || (instructorSessionsHydrated && !allSessions.length);
    if (showWelcome) {
      clearInstructorOnboardingWelcomeFlag();
    }
    return (
      <div className="main-panel" id="instr-main-panel">
        <div id="questions-list">
          {showWelcome ? <WelcomeState /> : <SelectSessionState />}
        </div>
      </div>
    );
  }

  const paginationHtml = showPagination ? (
    <div className="pagination-nav-cluster">
      <button
        type="button"
        className="page-nav-btn instr-p-prev"
        disabled={!canPrev}
        onClick={goPreviousPage}
      >
        Previous
      </button>
      {Array.from({ length: hi - lo }, (_, idx) => {
        const i = lo + idx;
        const isAct = i === currentPage;
        if (i < numLoaded) {
          return (
            <button
              key={i}
              type="button"
              className={`pagination-page-btn${isAct ? ' active' : ''}`}
              onClick={() => goToPage(i)}
            >
              {i + 1}
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className="pagination-page-btn"
            title="Load older questions"
            aria-label={`Go to page ${i + 1}`}
            onClick={goNextPage}
          >
            {i + 1}
          </button>
        );
      })}
      <button
        type="button"
        className="page-nav-btn instr-p-next"
        disabled={!canNext}
        onClick={goNextPage}
      >
        Next
      </button>
    </div>
  ) : null;

  return (
    <div className="main-panel" id="instr-main-panel">
      {/* Chrome: header, pagination, search */}
      <div
        id="instr-questions-chrome"
        className="instr-questions-chrome is-visible"
        aria-hidden="false"
      >
        <div className="panel-header">
          <div className="panel-title" id="panel-title">Questions</div>
          <div className="sort-row" style={{ marginLeft: 'auto' }}>
            <button
              className={`sort-btn${currentSort === 'recent' ? ' active' : ''}`}
              onClick={() => setCurrentSort('recent')}
            >
              Recent
            </button>
            <button
              className={`sort-btn${currentSort === 'votes' ? ' active' : ''}`}
              onClick={() => setCurrentSort('votes')}
            >
              Most voted
            </button>
          </div>
        </div>

        {showPagination && (
          <div id="instr-pagination-top" className="q-pagination-num-wrap visible" aria-label="Question pages" style={{ display: 'flex' }}>
            {paginationHtml}
          </div>
        )}

        <div className="questions-search-row">
          <input
            type="search"
            id="instr-questions-search"
            className="questions-search-input"
            placeholder="Search questions…"
            autoComplete="off"
            aria-label="Search questions and answers"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button
            type="button"
            className="top-btn"
            onClick={() => setSearchQuery('')}
            style={{ flexShrink: 0 }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Questions */}
      <div id="questions-list">
        {!questionsHydrated ? (
          <div className="empty-state">
            <p>Loading questions…</p>
          </div>
        ) : displayedQuestions.length === 0 ? (
          <div className="empty-state">
            <p>{searchQuery
              ? 'No matches in loaded questions. Load more pages or clear the search.'
              : 'No questions in this view.'
            }</p>
          </div>
        ) : (
          displayedQuestions.map(q => (
            <QuestionCard key={q.id} q={q} />
          ))
        )}
      </div>

      {showPagination && (
        <div id="instr-pagination-bottom" className="q-pagination-num-wrap visible" aria-label="Question pages" style={{ display: 'flex' }}>
          {paginationHtml}
        </div>
      )}
    </div>
  );
}
