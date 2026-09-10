import { formatRichMessage, isHttpsUrl } from '../../lib/richText.js';
import { formatQuestionWhen } from '../../lib/formatQuestionWhen.js';
import { htmlAnsweredStatusBadges } from '../../lib/answeredBadge.js';
import { currentUid } from '../../lib/auth.js';

/**
 * normalizeQuestionImageUrls — extract https-only image URLs from the imageUrls field,
 * which can be an array, a string, or an object map (legacy formats).
 */
function normalizeQuestionImageUrls(q) {
  const raw = q.imageUrls;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((u) => String(u).trim()).filter(isHttpsUrl);
  if (typeof raw === 'string') return isHttpsUrl(raw) ? [raw.trim()] : [];
  if (typeof raw === 'object') {
    return Object.keys(raw)
      .sort()
      .map((k) => raw[k])
      .map((u) => String(u).trim())
      .filter(isHttpsUrl);
  }
  return [];
}

function isImageOnlyPlaceholderText(text) {
  const t = (text || '').trim().toLowerCase();
  return t === '(image)' || t === '(photo)';
}

/**
 * QuestionCard renders a single question in the feed.
 *
 * dangerouslySetInnerHTML is used for rich-text and badge HTML.
 * Safety: all user content passes through esc() inside formatRichMessage/htmlAnsweredStatusBadges,
 * which escapes &, <, >, " before any markup is injected.
 */
export default function QuestionCard({ question: q, userId, sessionCode, isLocked, onUpvote, onEdit }) {
  const mine = isMyQuestion(q.id, sessionCode);
  // A vote counts as "mine" whether it was recorded under the Firebase uid
  // (current model) or the legacy localStorage id (older votes).
  const authUid = currentUid();
  const voters = q.voters || [];
  const voted = voters.includes(userId) || (!!authUid && voters.includes(authUid));
  const voting = isLocked;

  const imageUrls = normalizeQuestionImageUrls(q);
  const rawText = q.text || '';
  const showBody =
    String(rawText).trim() &&
    !isImageOnlyPlaceholderText(rawText);

  // Build answers list (multi-answer or legacy single-answer).
  //
  // The status gate applies ONLY to the legacy singular `answer` string, because
  // that is the only forgeable answer field: it sits in the question-create
  // allowlist, so a student could ship a new question carrying text that renders
  // under an "Instructor" label. The plural `answers` array is not in that
  // allowlist and cannot be forged, so it renders whatever its status — which
  // keeps a real instructor answer visible after "Mark as pending".
  //
  // Requiring 'answered' is enough to kill the forgery: create pins status to
  // 'pending', and a student's only update path is hasOnly(['text','imageUrls']),
  // so they can never flip status. No instructor path has ever written this
  // field — every one of them writes `answers` and sets `answer: ''` in the
  // same update.
  const isAnswered = q.status === 'answered';
  const answers =
    q.answers && q.answers.length
      ? q.answers
      : isAnswered && q.answer
      ? [{ instructor: 'Instructor', text: q.answer, imageUrls: q.answerImageUrls }]
      : [];

  // Badges HTML (returned as HTML string, safe because esc() is applied inside)
  let badgesHtml = '';
  if (q.pinned) badgesHtml += '<span class="q-badge badge-pinned">Pinned</span>';
  if (isAnswered) {
    badgesHtml += htmlAnsweredStatusBadges(q);
  } else {
    badgesHtml += '<span class="q-badge badge-pending">Pending</span>';
  }

  return (
    <div className={`q-card${q.pinned ? ' pinned' : ''}${isAnswered ? ' answered' : ''}`}>
      <div className="q-card-header">
        <div className="q-meta">
          <span className="q-author">{q.authorName || 'Anonymous'}</span>
          <span className="q-time" title="Posted time">{formatQuestionWhen(q.createdAt)}</span>
          {/* dangerouslySetInnerHTML: badge HTML from htmlAnsweredStatusBadges uses esc() for all user text */}
          <span dangerouslySetInnerHTML={{ __html: badgesHtml }} />
        </div>
        {mine && (
          <button className="q-edit-btn" onClick={() => onEdit(q.id)}>
            Edit
          </button>
        )}
      </div>

      {/* Question body */}
      {showBody ? (
        /* dangerouslySetInnerHTML: formatRichMessage escapes all user content via esc() before adding markup */
        <div
          className="q-text q-text-rich rich-message"
          dangerouslySetInnerHTML={{ __html: formatRichMessage(rawText) }}
        />
      ) : isImageOnlyPlaceholderText(rawText) && !imageUrls.length ? (
        <div className="q-text q-text-rich q-text-muted">
          No image was saved—wait for the upload to finish before you submit, then try again.
        </div>
      ) : null}

      {/* Attached images */}
      {imageUrls.length > 0 && (
        <div className="q-attached-images">
          {imageUrls.map((u) => (
            <a key={u} className="attachment-img-link" href={u} target="_blank" rel="noopener noreferrer">
              <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </a>
          ))}
        </div>
      )}

      {/* Answers */}
      {answers.map((a, i) => {
        const ansImgUrls = Array.isArray(a.imageUrls)
          ? a.imageUrls.filter(isHttpsUrl)
          : [];
        return (
          <div key={i} className="q-answer">
            <div className="q-answer-label">{a.instructor || 'Instructor'}</div>
            {/* dangerouslySetInnerHTML: formatRichMessage escapes all user content via esc() before adding markup */}
            <div
              className="rich-message"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              dangerouslySetInnerHTML={{ __html: formatRichMessage(a.text || '') }}
            />
            {ansImgUrls.length > 0 && (
              <div className="q-attached-images">
                {ansImgUrls.map((u) => (
                  <a key={u} className="attachment-img-link" href={u} target="_blank" rel="noopener noreferrer">
                    <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="q-footer">
        <button
          type="button"
          className={`upvote-btn${voted ? ' upvoted' : ''}${voting ? ' loading' : ''}`}
          data-qid={q.id}
          aria-label={voting ? 'Saving vote…' : 'Upvote'}
          aria-busy={voting ? 'true' : 'false'}
          disabled={voting}
          onClick={() => onUpvote(q.id)}
        >
          <span className="upvote-spinner" aria-hidden="true" />
          <svg
            width="14" height="14"
            viewBox="0 0 24 24"
            fill={voted ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          <span className="upvote-saving">Saving…</span>
          <span className="upvote-count">{q.votes || 0}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Check if this question belongs to the current student (stored in sessionStorage).
 * Uses the session-scoped key so "mine" state is isolated per session.
 */
function isMyQuestion(id, sessionCode) {
  if (!sessionCode) return false;
  try {
    const key = 'sqa_my_questions_' + String(sessionCode).replace(/[^A-Z0-9_-]/gi, '');
    const arr = JSON.parse(sessionStorage.getItem(key) || '[]');
    return arr.includes(id);
  } catch (e) {}
  return false;
}
