/**
 * Unit tests for the ask-box duplicate-submission guard.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * This is what stands between an offline student pressing Submit twice and the
 * same question appearing twice on the board in front of the room, so the "same
 * question" and "different question" boundaries are load-bearing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  submissionFingerprint,
  createPendingSubmissions,
} from '../../src/student/lib/pendingSubmissions.js';

test('the same words with the same attachments are the same submission', () => {
  assert.equal(
    submissionFingerprint('Why does the flow fail?', ['https://x/a.jpg']),
    submissionFingerprint('Why does the flow fail?', ['https://x/a.jpg']),
  );
});

test('attachment order does not create a new submission', () => {
  assert.equal(
    submissionFingerprint('same', ['https://x/a.jpg', 'https://x/b.jpg']),
    submissionFingerprint('same', ['https://x/b.jpg', 'https://x/a.jpg']),
  );
});

test('edited text or a different attachment is a different submission', () => {
  assert.notEqual(submissionFingerprint('one', []), submissionFingerprint('one?', []));
  assert.notEqual(
    submissionFingerprint('one', []),
    submissionFingerprint('one', ['https://x/a.jpg']),
  );
});

test('text and attachments cannot be confused for one another', () => {
  // Naive concatenation would make these two collide.
  assert.notEqual(
    submissionFingerprint('a', ['b']),
    submissionFingerprint('ab', []),
  );
});

test('a missing or empty attachment list is handled', () => {
  assert.equal(submissionFingerprint('q', undefined), submissionFingerprint('q', []));
  assert.equal(submissionFingerprint(undefined, []), submissionFingerprint('', []));
});

test('an identical submission is refused while its write is outstanding', () => {
  const pending = createPendingSubmissions();
  const fp = submissionFingerprint('Is this recorded?', []);
  assert.equal(pending.reserve(fp), true);
  assert.equal(pending.reserve(fp), false, 'the second press must not write');
  assert.equal(pending.size, 1);
});

test('a different question still goes through while one is queued', () => {
  const pending = createPendingSubmissions();
  assert.equal(pending.reserve(submissionFingerprint('first', [])), true);
  assert.equal(pending.reserve(submissionFingerprint('second', [])), true);
  assert.equal(pending.size, 2, 'the ask box is never locked, only deduplicated');
});

test('releasing lets the same question be asked again later', () => {
  const pending = createPendingSubmissions();
  const fp = submissionFingerprint('Can you repeat that?', []);
  pending.reserve(fp);
  pending.release(fp);
  assert.equal(pending.has(fp), false);
  assert.equal(pending.reserve(fp), true, 'a settled write must not block a real repeat');
});

test('releasing an unknown submission is harmless', () => {
  const pending = createPendingSubmissions();
  pending.release('never-reserved');
  assert.equal(pending.size, 0);
});

test('each ask box gets its own set of outstanding submissions', () => {
  const a = createPendingSubmissions();
  const b = createPendingSubmissions();
  const fp = submissionFingerprint('shared text', []);
  a.reserve(fp);
  assert.equal(b.reserve(fp), true);
});
