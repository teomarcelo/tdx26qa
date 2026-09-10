/**
 * Identity of one reply inside a question's `answers` array.
 *
 * Co-instructors work the same session, so a save or a delete cannot commit to an
 * array index: the reply that sat at index 1 when the card rendered may be someone
 * else's by the time the transaction reads the document. The identity below is what
 * the transaction re-resolves against the server copy instead.
 *
 * Replies written from here on carry a unique `id`, which makes that resolution
 * exact. Replies already stored in production have no id — they carry only `ts`,
 * `instructor` and `text` — so they are matched on their whole payload. Two
 * different replies that merely share an ISO millisecond therefore stop colliding,
 * and a match that is still not unique means the candidates are indistinguishable
 * in every field the app writes. Those are REFUSED rather than resolved to the
 * first hit: deleting a co-instructor's reply mid-workshop is far worse than
 * telling the instructor the operation cannot be completed.
 */

/** Unique within one question's answers array; ids are never compared across questions. */
export function newAnswerId() {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Every field the client writes on an answer, so an id-less match is a match on
 * the whole reply and not on one field that happens to repeat.
 */
function legacyKey(a) {
  const imgs = Array.isArray(a.imageUrls) ? a.imageUrls.map(u => String(u)) : [];
  return [
    a.ts == null ? '' : String(a.ts),
    String(a.instructor || ''),
    String(a.text || ''),
    imgs.join('\u001f'),
  ].join('\u0000');
}

/** Identity descriptor for `a`, or null when there is nothing to identify. */
export function answerIdentity(a) {
  if (!a) return null;
  if (a.id) return { id: String(a.id) };
  return { legacyKey: legacyKey(a) };
}

export const ANSWER_MATCH_NONE = 'none';
export const ANSWER_MATCH_AMBIGUOUS = 'ambiguous';

/**
 * Locate `identity` in a freshly-read answers array. Returns `{ index }` only when
 * exactly one reply matches, otherwise `{ reason }`: ANSWER_MATCH_NONE when the
 * reply is gone or was rewritten, ANSWER_MATCH_AMBIGUOUS when two replies are
 * indistinguishable and picking either could hit the wrong one.
 *
 * An id-less identity deliberately does not match a reply that has an id: an id is
 * the canonical identity, and every write that adds one also writes a fresh `ts`,
 * so such a reply is a later version of a different thing.
 */
export function resolveAnswerIndex(answers, identity) {
  const arr = Array.isArray(answers) ? answers : [];
  if (!identity) return { reason: ANSWER_MATCH_NONE };

  const found = [];
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (!a) continue;
    const match = identity.id
      ? String(a.id || '') === identity.id
      : (!a.id && legacyKey(a) === identity.legacyKey);
    if (match) found.push(i);
  }

  if (found.length === 1) return { index: found[0] };
  return { reason: found.length ? ANSWER_MATCH_AMBIGUOUS : ANSWER_MATCH_NONE };
}
