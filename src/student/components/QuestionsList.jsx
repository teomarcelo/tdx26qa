import QuestionCard from './QuestionCard.jsx';
import { filterCorpusByFuseSearch } from '../../lib/questionSearch.js';
import { viewNeedsFullCorpus, corpusScopeNotice } from '../hooks/useFullQuestionCorpus.js';

/**
 * Sorts and filters the questions array then renders QuestionCard items.
 * Pinned questions always sort to the top regardless of sort mode.
 */
export default function QuestionsList({
  questions,
  allCachedQuestions,
  corpusLoading = false,
  corpusTruncated = false,
  searchQuery,
  filter,
  sort,
  userId,
  sessionCode,
  lockedIds,
  onUpvote,
  onEdit,
}) {
  // Filtering and vote-sorting only the current page would hide matches that live
  // elsewhere in the session (a pinned question two pages back, a high-vote older
  // question). Those views read `allCachedQuestions`, which AppScreen fills from a
  // dedicated session-wide query rather than from the ten-question page cache. The
  // default recent/all view keeps per-page pagination behavior.
  const useFullCorpus = viewNeedsFullCorpus(filter, sort, searchQuery);
  const corpus = useFullCorpus ? allCachedQuestions : questions;

  let qs = searchQuery
    ? filterCorpusByFuseSearch(corpus, searchQuery, getQuestionSearchHaystack)
    : corpus.slice();

  // Apply filter
  if (filter === 'pinned') qs = qs.filter((q) => q.pinned);
  if (filter === 'answered') qs = qs.filter((q) => q.status === 'answered');
  if (filter === 'unanswered') qs = qs.filter((q) => q.status !== 'answered');

  // Sort: pinned first always, then by votes or newest
  qs.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (sort === 'votes') return (b.votes || 0) - (a.votes || 0);
    const at = a.createdAt
      ? a.createdAt.toDate
        ? a.createdAt.toDate()
        : new Date(a.createdAt)
      : new Date(0);
    const bt = b.createdAt
      ? b.createdAt.toDate
        ? b.createdAt.toDate()
        : new Date(b.createdAt)
      : new Date(0);
    return bt - at;
  });

  // Every corpus-driven view stops at the same cap, not just search: past it,
  // "Top voted" is ranking the newest slice, so say so rather than let the list
  // look like the whole session. Empty until a session actually runs past the
  // cap, which almost none do.
  const scopeNotice = corpusScopeNotice(filter, sort, searchQuery, corpusTruncated);
  const notice = scopeNotice ? (
    <p className="corpus-scope-notice">{scopeNotice}</p>
  ) : null;

  if (!qs.length) {
    // While the session-wide query is still in flight, "nothing here" would be a
    // guess. Say we are still looking instead.
    const emptyMsg = useFullCorpus && corpusLoading
      ? 'Checking the whole session…'
      : searchQuery
      ? corpusTruncated
        ? 'No matches in the questions we could load. Try a shorter search term.'
        : 'No matches for that search. Try different words or clear the search.'
      : 'No questions here yet.';
    return (
      <>
        {notice}
        <div className="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p>{emptyMsg}</p>
        </div>
      </>
    );
  }

  return (
    <>
      {notice}
      {qs.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          userId={userId}
          sessionCode={sessionCode}
          isLocked={lockedIds.has(q.id)}
          onUpvote={onUpvote}
          onEdit={onEdit}
        />
      ))}
    </>
  );
}

function getQuestionSearchHaystack(q) {
  const bits = [q.text, q.authorName];
  // Mirrors QuestionCard: the plural array is always searchable, the forgeable
  // singular `answer` only once the question is actually answered. Without this,
  // search would match text the card does not render.
  const answers =
    q.answers && q.answers.length
      ? q.answers
      : q.status === 'answered' && q.answer
      ? [{ text: q.answer, instructor: 'Instructor' }]
      : [];
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    bits.push(a.text, a.instructor);
    if (Array.isArray(a.imageUrls)) bits.push(a.imageUrls.join(' '));
  }
  return bits.filter(Boolean).join('\n');
}
