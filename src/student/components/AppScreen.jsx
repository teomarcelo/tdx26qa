import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import { useQuestions } from '../hooks/useQuestions.js';
import { useUpvote } from '../hooks/useUpvote.js';
import { useSessionStats } from '../hooks/useSessionStats.js';
import { useFullQuestionCorpus, viewNeedsFullCorpus } from '../hooks/useFullQuestionCorpus.js';
import AskBox from './AskBox.jsx';
import QuestionsList from './QuestionsList.jsx';
import QuestionToolbar from './QuestionToolbar.jsx';
import Pagination from './Pagination.jsx';
import InstructorNotesFeed from './InstructorNotesFeed.jsx';
import SessionSidebar from './SessionSidebar.jsx';
import EditModal from './EditModal.jsx';
import FeedbackModal from './FeedbackModal.jsx';
import { isStudentInstructorNotesDashboardEnabled } from '../../lib/sessionNotes.js';
import { myQsKey } from '../hooks/useStudentSession.js';
import { copyRichCodeBlock as runCopyRichCodeBlock } from '../../lib/richText.js';
import { studentSessionDisplayTitle } from './SessionInfo.jsx';
import ImageLightbox from '../../shared/ImageLightbox.jsx';
import useStudentDemoStore from '../demo/useStudentDemoStore.js';

/**
 * AppScreen — the main Q&A interface shown after joining a session.
 *
 * Manages:
 *  - filter / sort / feed view state
 *  - search query
 *  - edit modal state
 *  - feedback modal state
 *  - toast display
 */
export default function AppScreen({
  sessionCode,
  currentSession,
  userName,
  userId,
  onLeave,
  isDemoMode = false,
}) {
  const { db } = useFirebase();
  const updateDemoQuestion = useStudentDemoStore((s) => s.updateQuestion);

  // --- Poll skip window (shared ref between useQuestions + useUpvote) ---
  const pollSkipUntilRef = useRef(0);

  // --- Questions ---
  const {
    allQuestions,
    questionPages,
    currentPage,
    olderExhausted,
    loading,
    fetchFirstPage,
    goNextPage,
    goPrevPage,
    goToPage,
    refreshQuestionAfterVote,
    reset: resetQuestions,
  } = useQuestions(sessionCode, pollSkipUntilRef);

  // --- Upvote ---
  const { lockedIds, handleUpvote } = useUpvote(pollSkipUntilRef);

  // --- All cached questions (stats fallback + newest-page overlay) ---
  // Memoized: useSessionStats keys an aggregate Firestore query off this value,
  // so rebuilding the array on every render would refetch (and bill) forever.
  const allCached = useMemo(() => {
    const m = new Map();
    questionPages.forEach((p) => {
      (p.questions || []).forEach((q) => m.set(q.id, q));
    });
    return Array.from(m.values());
  }, [questionPages]);
  const stats = useSessionStats(sessionCode, db, allCached);

  // --- Filter / sort / feed view ---
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [feedView, setFeedView] = useState('qa');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInputValue, setSearchInputValue] = useState('');

  // --- Full session corpus (search, votes sort, Pinned/Answered/Unanswered) ---
  // The page cache holds ten questions, so filtering it for these views returned
  // confidently wrong answers: "Pinned" read as empty while a question was pinned
  // on page two, and "Top voted" ranked the ten newest against each other. These
  // views now read the session, not the page.
  const needsFullCorpus = viewNeedsFullCorpus(filter, sort, searchQuery);
  // Coarse on purpose: which view is active, not what is typed in the search box.
  // Keying the fetch on the query text would re-read the session on every letter.
  const corpusRequestKey = `${filter}|${sort}|${searchQuery ? 'search' : 'nosearch'}`;
  const { corpus, corpusLoading, corpusTruncated, patchCorpusQuestion } =
    useFullQuestionCorpus(sessionCode, db, needsFullCorpus, corpusRequestKey);

  // Page 0 is driven by a live listener, so the cached pages carry fresher votes
  // and statuses than the one-shot corpus read. They win on conflict.
  const fullCorpus = useMemo(() => {
    if (!needsFullCorpus || !corpus.length) return allCached;
    const m = new Map();
    corpus.forEach((q) => m.set(q.id, q));
    allCached.forEach((q) => m.set(q.id, q));
    return Array.from(m.values());
  }, [needsFullCorpus, corpus, allCached]);

  // --- Edit modal ---
  const [editingQuestion, setEditingQuestion] = useState(null);

  // --- Feedback modal ---
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // --- Toast ---
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2500);
  }, []);

  // Wire rich-text copy button (delegated from document.body)
  useEffect(() => {
    function handleBodyClick(e) {
      const btn = e.target.closest && e.target.closest('.rich-copy-btn');
      if (!btn) return;
      e.preventDefault();
      runCopyRichCodeBlock(btn, showToast);
    }
    document.body.addEventListener('click', handleBodyClick);
    return () => document.body.removeEventListener('click', handleBodyClick);
  }, [showToast]);

  const notesEnabled = isStudentInstructorNotesDashboardEnabled(currentSession);

  // If notes become disabled while viewing them, switch back to QA
  useEffect(() => {
    if (!notesEnabled && feedView === 'notes') {
      setFeedView('qa');
    }
  }, [notesEnabled, feedView]);

  function handleSetFilter(f) {
    if (feedView === 'notes') setFeedView('qa');
    setFilter(f);
    setSort('recent');
  }

  function handleToggleSort() {
    if (feedView === 'notes') setFeedView('qa');
    setSort((s) => (s === 'votes' ? 'recent' : 'votes'));
  }

  function handleToggleNotes() {
    if (!notesEnabled) return;
    setFeedView((v) => (v === 'notes' ? 'qa' : 'notes'));
  }

  // --- Search ---
  const searchTimerRef = useRef(null);
  function handleSearchInput(e) {
    const val = e.target.value;
    setSearchInputValue(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(val.trim());
    }, 200);
  }

  function clearSearch() {
    setSearchInputValue('');
    setSearchQuery('');
  }

  // --- Manual refresh ---
  async function handleRefreshNow() {
    if (loading) { showToast('Still loading—try again in a second.'); return; }
    resetQuestions();
    try {
      // Also refresh the session doc (handled by the live listener in useStudentSession,
      // but a manual pull guarantees a fresh snapshot immediately)
      await fetchFirstPage();
      showToast('Board updated.');
    } catch (e) {
      showToast('Could not refresh. Check your connection.');
    }
  }

  // --- Upvote wiring ---
  /**
   * Reconcile the vote tally after a successful write.
   *
   * fetchFirstPage() is only safe from page 0: it ends in commitPage0, which
   * calls setCurrentPage(0), so calling it from an older page threw the student
   * back to the newest questions and lost their place. Anywhere else, re-read
   * just the voted question and patch it where it is cached.
   */
  async function handleVoteSaved(id) {
    const onFirstPage = currentPage === 0;
    if (onFirstPage) {
      fetchFirstPage();
      // Page 0 covers the visible feed; the corpus may hold this question too.
      if (!needsFullCorpus) return;
    }
    const fresh = await refreshQuestionAfterVote(id);
    if (fresh) patchCorpusQuestion(id, () => fresh);
  }

  function onUpvote(id) {
    const q =
      allQuestions.find((x) => x.id === id) ||
      fullCorpus.find((x) => x.id === id);
    handleUpvote(id, q, userId, sessionCode, () => handleVoteSaved(id), showToast);
  }

  // --- Edit ---
  function handleOpenEdit(id) {
    const q =
      allQuestions.find((x) => x.id === id) ||
      fullCorpus.find((x) => x.id === id);
    if (!q) return;
    setEditingQuestion(q);
  }

  async function handleSaveEdit({ text, imageUrls }) {
    if (!editingQuestion) return;
    const key = myQsKey(sessionCode);
    try {
      const myQs = JSON.parse(sessionStorage.getItem(key) || '[]');
      if (!myQs.includes(editingQuestion.id)) {
        showToast('You can only edit your own questions.');
        setEditingQuestion(null);
        return;
      }
    } catch (e) {}
    const urls = Array.isArray(imageUrls) ? imageUrls : [];
    // Demo mode: update the in-memory store; never call db or Storage.
    if (isDemoMode) {
      updateDemoQuestion(editingQuestion.id, (q) => ({ ...q, text, imageUrls: urls }));
      setEditingQuestion(null);
      showToast('Question updated.');
      return;
    }
    try {
      await db
        .collection('sessions')
        .doc(sessionCode)
        .collection('questions')
        .doc(editingQuestion.id)
        .update({ text, imageUrls: urls });
      setEditingQuestion(null);
      showToast('Question updated.');
      fetchFirstPage();
    } catch (e) {
      const code = String((e && (e.code || e.name)) || '').toLowerCase();
      if (code.includes('permission-denied') || code.includes('unauthenticated')) {
        showToast('Could not save this edit. You can only change your own questions.');
      } else {
        showToast('Could not save. Check your connection.');
      }
    }
  }

  // --- Submit question callback: switch to QA view + reset to page 0 ---
  function handleSubmitDone() {
    if (feedView === 'notes') setFeedView('qa');
    resetQuestions();
    fetchFirstPage();
  }

  const sessionTitle = studentSessionDisplayTitle(currentSession) || 'Session';

  // Hidden for every corpus-driven view, not just search: those views render the
  // whole session in one list, so page numbers would not govern what is on screen.
  const showPagination = !needsFullCorpus && !!(sessionCode && db && questionPages.length > 0);

  return (
    <div id="app-screen" style={{ display: 'block' }}>
      {/* Top bar */}
      <div className="top-bar">
        <div className="top-bar-left">
          <div className="top-bar-logo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <span className="top-bar-session" id="bar-session-name">{sessionTitle}</span>
          <span className="top-bar-code" id="bar-code">{sessionCode}</span>
        </div>
        <div className="top-bar-right">
          <button className="leave-btn" onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Main layout */}
      <div className="app-layout" id="student-app-layout">
        {/* Main column */}
        <div className="main-col">
          <AskBox
            sessionCode={sessionCode}
            userId={userId}
            userName={userName}
            showToast={showToast}
            onSubmitDone={handleSubmitDone}
            isDemoMode={isDemoMode}
          />

          {/* Search row */}
          <div className="student-qa-list-chrome">
            <div className="questions-search-row">
              <input
                type="search"
                id="questions-search"
                className="questions-search-input"
                placeholder="Search questions…"
                autoComplete="off"
                aria-label="Search questions and answers"
                value={searchInputValue}
                onChange={handleSearchInput}
              />
              <button type="button" className="load-more-btn" onClick={clearSearch}>
                Clear
              </button>
              <button
                type="button"
                className="refresh-btn refresh-btn--compact"
                id="refresh-now-btn"
                onClick={handleRefreshNow}
                title="Fetch the latest questions now"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Filter / sort toolbar */}
          <QuestionToolbar
            filter={filter}
            sort={sort}
            feedView={feedView}
            notesEnabled={notesEnabled}
            onSetFilter={handleSetFilter}
            onToggleSort={handleToggleSort}
            onToggleNotes={handleToggleNotes}
          />

          {/* Questions list */}
          <div className={`student-qa-list-chrome${feedView === 'notes' ? ' is-hidden' : ''}`}>
            <div
              id="student-pagination-top"
              className={`q-pagination-num-wrap${showPagination ? ' visible' : ''}`}
              aria-label="Question pages"
              style={{ display: showPagination ? 'flex' : 'none' }}
            >
              {showPagination && (
                <Pagination
                  questionPages={questionPages}
                  currentPage={currentPage}
                  olderExhausted={olderExhausted}
                  loading={loading}
                  onPrev={goPrevPage}
                  onNext={goNextPage}
                  onGoTo={goToPage}
                />
              )}
            </div>

            <div id="questions-list">
              {!sessionCode || (!allQuestions.length && !loading) ? (
                <div className="empty-state">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <p>No questions yet. Be the first to ask!</p>
                </div>
              ) : (
                <QuestionsList
                  questions={allQuestions}
                  allCachedQuestions={fullCorpus}
                  corpusLoading={corpusLoading}
                  corpusTruncated={corpusTruncated}
                  searchQuery={searchQuery}
                  filter={filter}
                  sort={sort}
                  userId={userId}
                  sessionCode={sessionCode}
                  lockedIds={lockedIds}
                  onUpvote={onUpvote}
                  onEdit={handleOpenEdit}
                />
              )}
            </div>

            <div
              id="student-pagination-bottom"
              className={`q-pagination-num-wrap${showPagination ? ' visible' : ''}`}
              aria-label="Question pages"
              style={{ display: showPagination ? 'flex' : 'none' }}
            >
              {showPagination && (
                <Pagination
                  questionPages={questionPages}
                  currentPage={currentPage}
                  olderExhausted={olderExhausted}
                  loading={loading}
                  onPrev={goPrevPage}
                  onNext={goNextPage}
                  onGoTo={goToPage}
                />
              )}
            </div>
          </div>

          {/* Instructor notes feed (toggled by QuestionToolbar) */}
          <InstructorNotesFeed
            currentSession={currentSession}
            visible={feedView === 'notes' && notesEnabled}
            showToast={showToast}
          />
        </div>

        {/* Sidebar (includes resizer) */}
        <SessionSidebar
          currentSession={currentSession}
          sessionCode={sessionCode}
          userId={userId}
          userName={userName}
          stats={stats}
          showToast={showToast}
          onOpenFeedback={() => setFeedbackOpen(true)}
        />
      </div>

      {/* Modals */}
      {editingQuestion && (
        <EditModal
          question={editingQuestion}
          sessionCode={sessionCode}
          userId={userId}
          isDemoMode={isDemoMode}
          showToast={showToast}
          onSave={handleSaveEdit}
          onClose={() => setEditingQuestion(null)}
        />
      )}
      {feedbackOpen && (
        <FeedbackModal
          sessionCode={sessionCode}
          onClose={() => setFeedbackOpen(false)}
          showToast={showToast}
          isDemoMode={isDemoMode}
        />
      )}

      {/* Toast */}
      <div className={`toast${toast ? ' show' : ''}`} id="toast">
        {toast}
      </div>

      {/* Attached-image viewer (intercepts plain clicks on attachment images) */}
      <ImageLightbox />
    </div>
  );
}
