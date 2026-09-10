/**
 * Unit tests for answer identity resolution.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * Co-instructors share a session, so the answer transactions in the instructor
 * QuestionCard resolve identity against the freshly-read array instead of trusting
 * a rendered index. A wrong or over-eager match here deletes or overwrites another
 * instructor's reply during a live workshop, so these cases are load-bearing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerIdentity,
  resolveAnswerIndex,
  newAnswerId,
  ANSWER_MATCH_NONE,
  ANSWER_MATCH_AMBIGUOUS,
} from '../../src/instructor/lib/answerIdentity.js';

const TS = '2026-08-17T18:04:11.123Z';

/** What the card does: identity of the clicked reply, resolved against the server copy. */
const resolveClicked = (server, index) => resolveAnswerIndex(server, answerIdentity(server[index]));

test('two replies written in the same millisecond resolve to their own index', () => {
  // Regression: keying on `ts` alone matched the first reply with that timestamp, so
  // deleting your own reply removed a co-instructor's.
  const server = [
    { instructor: 'Alex', text: 'Use the flow builder.', ts: TS },
    { instructor: 'Jordan', text: 'Check the debug log first.', ts: TS },
  ];
  assert.deepEqual(resolveClicked(server, 0), { index: 0 });
  assert.deepEqual(resolveClicked(server, 1), { index: 1 });
});

test('same millisecond and same author still resolves by text', () => {
  const server = [
    { instructor: 'Alex', text: 'first thought', ts: TS },
    { instructor: 'Alex', text: 'corrected answer', ts: TS },
  ];
  assert.deepEqual(resolveClicked(server, 1), { index: 1 });
});

test('an id resolves exactly even when timestamps collide', () => {
  const server = [
    { id: 'a_1', instructor: 'Alex', text: 'a', ts: TS },
    { id: 'a_2', instructor: 'Jordan', text: 'b', ts: TS },
  ];
  assert.deepEqual(resolveClicked(server, 1), { index: 1 });
});

test('an id survives a co-instructor inserting a reply ahead of it', () => {
  const identity = answerIdentity({ id: 'a_2', instructor: 'Jordan', text: 'b', ts: TS });
  const server = [
    { id: 'a_9', instructor: 'Sam', text: 'posted since the card rendered', ts: TS },
    { id: 'a_1', instructor: 'Alex', text: 'a', ts: TS },
    { id: 'a_2', instructor: 'Jordan', text: 'b', ts: TS },
  ];
  assert.deepEqual(resolveAnswerIndex(server, identity), { index: 2 });
});

test('indistinguishable legacy replies refuse instead of resolving to the first', () => {
  const server = [
    { instructor: 'Instructor', text: 'See the slides.', ts: null },
    { instructor: 'Instructor', text: 'See the slides.', ts: null },
  ];
  assert.deepEqual(resolveClicked(server, 1), { reason: ANSWER_MATCH_AMBIGUOUS });
  assert.equal(resolveClicked(server, 1).index, undefined, 'must not hand back an index');
});

test('attached images distinguish otherwise identical legacy replies', () => {
  const server = [
    { instructor: 'Alex', text: '(Image)', ts: TS, imageUrls: ['https://x/1.jpg'] },
    { instructor: 'Alex', text: '(Image)', ts: TS, imageUrls: ['https://x/2.jpg'] },
  ];
  assert.deepEqual(resolveClicked(server, 0), { index: 0 });
  assert.deepEqual(resolveClicked(server, 1), { index: 1 });
});

test('a reply that was rewritten server-side is reported gone, not matched loosely', () => {
  const identity = answerIdentity({ instructor: 'Alex', text: 'old text', ts: TS });
  const server = [{ id: 'a_1', instructor: 'Alex', text: 'new text', ts: '2026-08-17T18:09:00.000Z' }];
  assert.deepEqual(resolveAnswerIndex(server, identity), { reason: ANSWER_MATCH_NONE });
});

test('an id-less identity does not match a reply that has since been given an id', () => {
  // Every write that adds an id also writes a fresh ts, so such a reply is a later
  // version of something else — matching it would overwrite a co-instructor's edit.
  const identity = answerIdentity({ instructor: 'Alex', text: 'same text', ts: TS });
  const server = [{ id: 'a_1', instructor: 'Alex', text: 'same text', ts: TS }];
  assert.deepEqual(resolveAnswerIndex(server, identity), { reason: ANSWER_MATCH_NONE });
});

test('empty and missing inputs resolve to nothing rather than index 0', () => {
  assert.deepEqual(resolveAnswerIndex([], answerIdentity({ id: 'a_1' })), { reason: ANSWER_MATCH_NONE });
  assert.deepEqual(resolveAnswerIndex(undefined, answerIdentity({ id: 'a_1' })), { reason: ANSWER_MATCH_NONE });
  assert.deepEqual(resolveAnswerIndex([{ id: 'a_1' }], null), { reason: ANSWER_MATCH_NONE });
  assert.equal(answerIdentity(null), null);
});

test('a null hole in the answers array is skipped, not matched', () => {
  const server = [null, { id: 'a_1', instructor: 'Alex', text: 'a', ts: TS }];
  assert.deepEqual(resolveAnswerIndex(server, answerIdentity(server[1])), { index: 1 });
});

test('newAnswerId does not repeat within a burst of saves', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(newAnswerId());
  assert.equal(ids.size, 500);
});
