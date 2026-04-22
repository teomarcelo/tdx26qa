import { esc } from './richText.js';

function listAnswerEntries(q) {
  if (q.answers && q.answers.length) return q.answers;
  if (q.answer && String(q.answer).trim()) {
    return [{ text: q.answer, imageUrls: q.answerImageUrls }];
  }
  return [];
}

/** True when there is a non-empty text reply or at least one answer image in the app. */
export function questionHasWrittenReply(q) {
  return listAnswerEntries(q).some(function (a) {
    const imgs = Array.isArray(a.imageUrls) && a.imageUrls.length;
    if (imgs) return true;
    const t = (a.text || '').trim();
    return !!(t && t !== '(Image)');
  });
}

/** True when we should show the "Answered verbally" pill (explicit flag or legacy answered-without-text). */
export function questionShowVerbalAnsweredBadge(q) {
  if (q.status !== 'answered') return false;
  if (q.answeredVerbally === true) return true;
  if (q.answeredVerbally === false) return false;
  return !questionHasWrittenReply(q);
}

const TIP_VERBAL = 'Marked answered without a written reply in the app.';
const TIP_WRITTEN = 'A written reply is shown below.';

/** One or more green pills for answered questions (verbal, written, or both). */
export function htmlAnsweredStatusBadges(q) {
  const showVerbal = questionShowVerbalAnsweredBadge(q);
  const showWritten = questionHasWrittenReply(q);
  const parts = [];
  if (showVerbal) {
    parts.push(
      `<span class="q-badge badge-answered badge-answered-verbal" title="${esc(TIP_VERBAL)}">Answered verbally</span>`,
    );
  }
  if (showWritten) {
    parts.push(`<span class="q-badge badge-answered" title="${esc(TIP_WRITTEN)}">Answered</span>`);
  }
  if (!parts.length) {
    parts.push('<span class="q-badge badge-answered">Answered</span>');
  }
  return parts.join('');
}
