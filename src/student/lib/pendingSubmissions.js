/**
 * Guard against one question being posted twice.
 *
 * Firestore's offline queue holds a write indefinitely, and AskBox hands the
 * Submit button back after SUBMIT_TIMEOUT_MS so an offline student is not stuck
 * staring at a dead button. That leaves a window where pressing Submit again
 * queues a *second* document for the same question, and both flush the moment
 * connectivity returns — duplicate questions on the board, in front of the room.
 *
 * This tracks which submissions still have a write outstanding, so an identical
 * one is refused while it is in flight. Anything the student genuinely retypes
 * has a different fingerprint and goes through as normal: the box is never
 * locked.
 */

/**
 * Identity of a submission: what actually reaches Firestore. The anonymity
 * toggle and the clock are deliberately excluded — the same words with the same
 * attachments are the same question, however it is labelled.
 */
export function submissionFingerprint(text, imageUrls) {
  const urls = Array.isArray(imageUrls) ? imageUrls.slice().sort() : [];
  return `${text == null ? '' : String(text)}\u0000${urls.join('\u0001')}`;
}

/** Set of submissions whose writes have not settled yet. */
export function createPendingSubmissions() {
  const outstanding = new Set();
  return {
    /**
     * Claim a submission before writing it. False means an identical question is
     * still on its way and this one must not be written.
     */
    reserve(fingerprint) {
      if (outstanding.has(fingerprint)) return false;
      outstanding.add(fingerprint);
      return true;
    },
    /**
     * Release the claim however the write ended. A rejected write has to stay
     * retryable, and the same question asked again later deserves its own row.
     */
    release(fingerprint) {
      outstanding.delete(fingerprint);
    },
    has(fingerprint) {
      return outstanding.has(fingerprint);
    },
    get size() {
      return outstanding.size;
    },
  };
}
