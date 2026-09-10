/**
 * Unit tests for the student full-session corpus hook.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * The pure helpers are tested directly. The hook itself is driven by the tiny
 * host below, which installs its own dispatcher in React's internals slot so the
 * real hook can run without a DOM: the regressions this file guards are all
 * about *timing* (a read for the session the student just left, a StrictMode
 * double mount), and those only show up when effects actually run.
 *
 * Read cost is asserted on purpose. Each fetch bills up to FULL_CORPUS_MAX + 1
 * document reads against a session that can hold hundreds of students, so "how
 * many reads did that take" is a correctness property here, not a detail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {
  FULL_CORPUS_MAX,
  viewNeedsFullCorpus,
  capFetchedCorpus,
  corpusScopeNotice,
  useFullQuestionCorpus,
} from '../../src/student/hooks/useFullQuestionCorpus.js';

// ── Pure helpers ─────────────────────────────────────────────────────────────

test('viewNeedsFullCorpus only fires for whole-session views', () => {
  assert.equal(viewNeedsFullCorpus('all', 'recent', ''), false);
  assert.equal(viewNeedsFullCorpus('all', 'recent', 'firewall'), true);
  assert.equal(viewNeedsFullCorpus('all', 'votes', ''), true);
  assert.equal(viewNeedsFullCorpus('pinned', 'recent', ''), true);
  assert.equal(viewNeedsFullCorpus('answered', 'recent', ''), true);
  assert.equal(viewNeedsFullCorpus('unanswered', 'recent', ''), true);
});

test('a session sitting exactly on the cap is not truncated', () => {
  // The old check was `length >= FULL_CORPUS_MAX`, which called a complete
  // 300-question session truncated and warned attendees about nothing.
  const capped = capFetchedCorpus(makeQuestions(FULL_CORPUS_MAX));
  assert.equal(capped.truncated, false);
  assert.equal(capped.questions.length, FULL_CORPUS_MAX);
});

test('the probe document past the cap marks the corpus truncated and is dropped', () => {
  const capped = capFetchedCorpus(makeQuestions(FULL_CORPUS_MAX + 1));
  assert.equal(capped.truncated, true);
  assert.equal(capped.questions.length, FULL_CORPUS_MAX);
  assert.equal(capped.questions[FULL_CORPUS_MAX - 1].id, `q-${FULL_CORPUS_MAX - 1}`);
});

test('a short session is passed through untouched', () => {
  const questions = makeQuestions(4);
  const capped = capFetchedCorpus(questions);
  assert.equal(capped.truncated, false);
  assert.equal(capped.questions, questions);
});

test('no scope notice while the corpus is complete', () => {
  assert.equal(corpusScopeNotice('all', 'votes', '', false), '');
  assert.equal(corpusScopeNotice('pinned', 'recent', '', false), '');
});

test('no scope notice on the paginated default view even when truncated', () => {
  // The recent/all feed pages through the session, so the cap does not apply.
  assert.equal(corpusScopeNotice('all', 'recent', '', true), '');
});

test('a truncated Top voted view warns that an older question could rank higher', () => {
  const msg = corpusScopeNotice('all', 'votes', '', true);
  assert.match(msg, /more votes/);
  assert.match(msg, new RegExp(String(FULL_CORPUS_MAX)));
});

test('truncated filter and search views each say what they cover', () => {
  assert.match(corpusScopeNotice('pinned', 'recent', '', true), /newest 300/);
  assert.match(corpusScopeNotice('all', 'recent', 'vpc', true), /Search covers/);
});

// ── Hook behaviour ───────────────────────────────────────────────────────────

const KEY = 'all|votes|nosearch';

test('a session switch mid-fetch still loads the new session', async () => {
  // Regression: the in-flight guard used to be a bare boolean. Session B's
  // effect saw it set, returned without fetching, and nothing re-ran the effect
  // once session A's read landed — so B sat on "Checking the whole session…"
  // for as long as the student stayed there.
  const { db, resolveFor } = fakeDb();
  const host = mountHook(({ code }) => useFullQuestionCorpus(code, db, true, KEY), {
    code: 'SQA-AAAA',
  });
  assert.deepEqual(readCodes(db), ['SQA-AAAA']);

  host.setProps({ code: 'SQA-BBBB' });
  assert.deepEqual(readCodes(db), ['SQA-AAAA'], 'no second read while one is on the wire');

  resolveFor('SQA-AAAA', snapshotOf(3, 'a'));
  await host.settle();
  assert.deepEqual(readCodes(db), ['SQA-AAAA', 'SQA-BBBB'], 'B fetches once A settles');

  resolveFor('SQA-BBBB', snapshotOf(2, 'b'));
  await host.settle();

  assert.deepEqual(host.result.corpus.map((q) => q.id), ['b-0', 'b-1']);
  assert.equal(host.result.corpusLoading, false);
  assert.equal(db.calls.length, 2, 'exactly one read per session');
});

test('a read for the session the student left never paints under the new one', async () => {
  const { db, resolveFor } = fakeDb();
  const host = mountHook(({ code }) => useFullQuestionCorpus(code, db, true, KEY), {
    code: 'SQA-AAAA',
  });
  host.setProps({ code: 'SQA-BBBB' });
  resolveFor('SQA-AAAA', snapshotOf(3, 'a'));
  await host.settle();

  assert.deepEqual(host.result.corpus, [], 'session A questions must not appear under B');
  assert.equal(host.result.corpusLoading, true, 'B is still waiting on its own read');
});

test('the corpus loads on a StrictMode double mount, with one read', async () => {
  const { db, resolveFor } = fakeDb();
  const host = mountHook(
    ({ code }) => useFullQuestionCorpus(code, db, true, KEY),
    { code: 'SQA-AAAA' },
    { strict: true },
  );
  resolveFor('SQA-AAAA', snapshotOf(2, 'a'));
  await host.settle();

  assert.equal(db.calls.length, 1, 'the double-invoked effect must not double-read');
  assert.deepEqual(host.result.corpus.map((q) => q.id), ['a-0', 'a-1']);
  assert.equal(host.result.corpusLoading, false);
});

test('flipping between corpus views inside the TTL reuses the fetched corpus', async () => {
  const { db, resolveFor } = fakeDb();
  const host = mountHook(({ key }) => useFullQuestionCorpus('SQA-AAAA', db, true, key), {
    key: 'all|votes|nosearch',
  });
  resolveFor('SQA-AAAA', snapshotOf(2, 'a'));
  await host.settle();

  host.setProps({ key: 'pinned|recent|nosearch' });
  host.setProps({ key: 'answered|recent|nosearch' });
  host.setProps({ key: 'all|votes|nosearch' });
  await host.settle();

  assert.equal(db.calls.length, 1, 'toggling views must not re-read the session');
  assert.equal(host.result.corpusLoading, false);
});

test('a view change during a fetch is served by that fetch, not a second one', async () => {
  const { db, resolveFor } = fakeDb();
  const host = mountHook(({ key }) => useFullQuestionCorpus('SQA-AAAA', db, true, key), {
    key: 'all|votes|nosearch',
  });
  host.setProps({ key: 'pinned|recent|nosearch' });
  resolveFor('SQA-AAAA', snapshotOf(2, 'a'));
  await host.settle();

  assert.equal(db.calls.length, 1);
  assert.deepEqual(host.result.corpus.map((q) => q.id), ['a-0', 'a-1']);
  assert.equal(host.result.corpusLoading, false);
});

test('the read asks for one document past the cap', async () => {
  const { db, resolveFor } = fakeDb();
  const host = mountHook(() => useFullQuestionCorpus('SQA-AAAA', db, true, KEY), {});
  assert.equal(db.calls[0].limit, FULL_CORPUS_MAX + 1);
  resolveFor('SQA-AAAA', snapshotOf(FULL_CORPUS_MAX + 1, 'a'));
  await host.settle();

  assert.equal(host.result.corpus.length, FULL_CORPUS_MAX);
  assert.equal(host.result.corpusTruncated, true);
});

test('a failed read leaves the board alone and does not retry in a loop', async () => {
  const { db, rejectFor } = fakeDb();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const host = mountHook(() => useFullQuestionCorpus('SQA-AAAA', db, true, KEY), {});
    rejectFor('SQA-AAAA', new Error('unavailable'));
    await host.settle();

    assert.equal(db.calls.length, 1, 'one failure must not become a retry storm');
    assert.deepEqual(host.result.corpus, []);
    assert.equal(host.result.corpusLoading, false);
  } finally {
    console.warn = warn;
  }
});

test('a disabled view and a missing db never read, and never spin', async () => {
  const { db } = fakeDb();
  const disabled = mountHook(() => useFullQuestionCorpus('SQA-AAAA', db, false, KEY), {});
  assert.equal(db.calls.length, 0);
  assert.equal(disabled.result.corpusLoading, false);

  // Demo mode reaches the hook with a null db and must stay entirely local.
  const demo = mountHook(() => useFullQuestionCorpus('SQA-AAAA', null, true, KEY), {});
  assert.equal(demo.result.corpusLoading, false);
  assert.deepEqual(demo.result.corpus, []);
});

test('an upvote is patched into the fetched corpus', async () => {
  const { db, resolveFor } = fakeDb();
  const host = mountHook(() => useFullQuestionCorpus('SQA-AAAA', db, true, KEY), {});
  resolveFor('SQA-AAAA', snapshotOf(2, 'a'));
  await host.settle();

  host.result.patchCorpusQuestion('a-1', (q) => ({ ...q, votes: 99 }));
  await host.settle();
  assert.equal(host.result.corpus.find((q) => q.id === 'a-1').votes, 99);
});

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeQuestions(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `q-${i}` }));
}

function snapshotOf(count, prefix) {
  return {
    docs: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`,
      data: () => ({ text: `${prefix} question ${i}`, votes: i }),
    })),
  };
}

function readCodes(db) {
  return db.calls.map((c) => c.code);
}

/** Fake compat Firestore exposing only the chain the hook walks. */
function fakeDb() {
  const settlers = new Map();
  const db = {
    calls: [],
    collection: () => ({
      doc: (code) => ({
        collection: () => ({
          orderBy: () => ({
            limit: (limit) => ({
              get: () => {
                db.calls.push({ code, limit });
                return new Promise((resolve, reject) => {
                  settlers.set(code, { resolve, reject });
                });
              },
            }),
          }),
        }),
      }),
    }),
  };
  return {
    db,
    resolveFor(code, snap) {
      settlers.get(code).resolve(snap);
    },
    rejectFor(code, err) {
      settlers.get(code).reject(err);
    },
  };
}

/**
 * Tiny hook host. React dispatches every hook call through the `H` slot on its
 * internals object, so installing our own implementation there runs the real
 * hook module with no renderer and no DOM.
 */
const ReactInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
assert.ok(
  ReactInternals && 'H' in ReactInternals,
  'React internals dispatcher slot missing — the hook host needs updating for this React version',
);

function depsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function mountHook(hookFn, initialProps, { strict = false } = {}) {
  const slots = [];
  const pending = [];
  let cursor = 0;
  let props = initialProps;
  let result;
  let dirty = false;
  let flushing = false;

  const dispatcher = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[i];
      return [
        slot.value,
        (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next;
          if (Object.is(value, slot.value)) return; // React bails out on an equal value
          slot.value = value;
          dirty = true;
          if (!flushing) flush(false);
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { ref: { current: initial } };
      return slots[i].ref;
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !depsEqual(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !depsEqual(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useEffect(create, deps) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { deps: null, destroy: undefined, first: true };
      const slot = slots[i];
      const changed = slot.first || !depsEqual(slot.deps, deps);
      slot.deps = deps;
      slot.first = false;
      if (changed) pending.push(slot, create);
    },
  };

  function renderOnce() {
    cursor = 0;
    pending.length = 0;
    const previous = ReactInternals.H;
    ReactInternals.H = dispatcher;
    try {
      result = hookFn(props);
    } finally {
      ReactInternals.H = previous;
    }
  }

  function commitEffects(doubleInvoke) {
    const queued = pending.slice();
    pending.length = 0;
    for (let i = 0; i < queued.length; i += 2) {
      const slot = queued[i];
      const create = queued[i + 1];
      if (slot.destroy) slot.destroy();
      slot.destroy = create() || undefined;
      // StrictMode mounts, unmounts, then mounts again.
      if (doubleInvoke) {
        if (slot.destroy) slot.destroy();
        slot.destroy = create() || undefined;
      }
    }
  }

  function flush(doubleInvoke) {
    flushing = true;
    let guard = 0;
    try {
      do {
        dirty = false;
        renderOnce();
        commitEffects(doubleInvoke);
        if (++guard > 50) throw new Error('render loop did not settle');
      } while (dirty);
    } finally {
      flushing = false;
    }
  }

  flush(strict);

  return {
    get result() {
      return result;
    },
    setProps(next) {
      props = next;
      dirty = true;
      flush(false);
    },
    /** Drain promise callbacks; each re-enters flush on its own. */
    async settle() {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
