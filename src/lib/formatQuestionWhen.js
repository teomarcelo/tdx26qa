/** @param {unknown} ts Firestore Timestamp-like (toDate), Date, or ISO-ish value */
export function formatQuestionWhen(ts) {
  if (!ts) return '';
  let date;
  try {
    date = ts.toDate ? ts.toDate() : new Date(ts);
  } catch (e) {
    return '';
  }
  // A malformed createdAt otherwise printed the literal string "Invalid Date"
  // next to the author's name on the card.
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
