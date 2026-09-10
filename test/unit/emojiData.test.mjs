/**
 * Unit tests for the emoji keyword layer behind both format toolbars.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * The keyword dataset is ~265 kB that used to ride the entry bundle every
 * workshop attendee downloads before first paint. It now arrives through a
 * dynamic import(), which makes three things load-bearing and worth pinning:
 * nothing is fetched until a picker asks, several pickers opening at once share
 * one fetch, and glyphs stay usable while the fetch is in flight.
 *
 * `emojilib` is stubbed through a module hook so the assertions do not depend on
 * a 1,900-entry third-party dataset. Everything under test is the real source on
 * disk. The stub deliberately keys "❤️" with the VS16 variation selector and "🖐"
 * without one, because the picker's glyph literals disagree with emojilib on both
 * and the normalizing lookup is what papers over it.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', '..', 'src');

const EMOJILIB_STUB = `
export default {
  '\u{1F600}': ['grinning_face', 'smile', 'happy'],
  '\u2764\uFE0F': ['red_heart', 'love', 'like'],
  '\u2705': ['check_mark_button', 'ok', 'agree'],
  '\u{1F590}': ['hand_with_fingers_splayed'],
};
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'emojilib') {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(EMOJILIB_STUB),
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  buildEmojiIndex,
  emojiKeywordsReady,
  emojiSearchText,
  filterEmojiChars,
  getEmojiIndex,
  loadEmojiKeywords,
  subscribeEmojiKeywords,
} = await import(pathToFileURL(resolve(SRC, 'lib/emojiData.js')).href);

// "❤" and "🖐️" are spelled the way the toolbars spell them, which is not the way
// emojilib keys them. "🦄" is a glyph the dataset has never heard of.
const CHARS = ['\u{1F600}', '\u2764', '\u2705', '\u{1F590}\uFE0F', '\u{1F984}'];

let notified = 0;
let notifiedAfterUnsubscribe = 0;

// ── Before the dataset lands ────────────────────────────────────────────────

test('importing the module fetches nothing', () => {
  assert.equal(emojiKeywordsReady(), false);
  assert.equal(emojiSearchText('\u{1F600}'), '');
  assert.equal(getEmojiIndex(CHARS).size, 0);
});

test('the picker is fully browsable before any keywords arrive', () => {
  const index = getEmojiIndex(CHARS);
  assert.deepEqual(filterEmojiChars(CHARS, '', index), CHARS);
  assert.deepEqual(filterEmojiChars(CHARS, '   ', index), CHARS);
  // Search is the only thing that degrades: it matches nothing rather than
  // throwing or emptying the glyph list.
  assert.deepEqual(filterEmojiChars(CHARS, 'smile', index), []);
});

// ── Loading ─────────────────────────────────────────────────────────────────

test('two pickers opening at once share one import, and subscribers fire once', async () => {
  const unsubscribe = subscribeEmojiKeywords(() => { notifiedAfterUnsubscribe++; });
  unsubscribe();
  subscribeEmojiKeywords(() => { notified++; });

  const first = loadEmojiKeywords();
  const second = loadEmojiKeywords();
  assert.equal(first, second, 'concurrent callers must share the in-flight promise');

  await first;
  assert.equal(emojiKeywordsReady(), true);
  assert.equal(notified, 1);
  assert.equal(notifiedAfterUnsubscribe, 0, 'unsubscribe must actually detach');
});

test('loading again after the data is in does not re-notify', async () => {
  await loadEmojiKeywords();
  assert.equal(notified, 1);
});

// ── Keyword lookup ──────────────────────────────────────────────────────────

test('keywords are lowercased and underscores become spaces', () => {
  assert.equal(emojiSearchText('\u{1F600}'), 'grinning face smile happy');
});

test('a glyph missing the VS16 selector still finds its keywords', () => {
  assert.equal(emojiSearchText('\u2764'), 'red heart love like');
});

test('a glyph carrying an extra VS16 selector still finds its keywords', () => {
  assert.equal(emojiSearchText('\u{1F590}\uFE0F'), 'hand with fingers splayed');
});

test('an unknown glyph searches as empty rather than throwing', () => {
  assert.equal(emojiSearchText('\u{1F984}'), '');
  assert.equal(emojiSearchText(''), '');
  assert.equal(emojiSearchText(null), '');
});

// ── Index ───────────────────────────────────────────────────────────────────

test('buildEmojiIndex covers every glyph it is given', () => {
  const index = buildEmojiIndex(CHARS);
  assert.equal(index.size, CHARS.length);
  assert.equal(index.get('\u2705'), 'check mark button ok agree');
  assert.equal(index.get('\u{1F984}'), '');
  assert.equal(buildEmojiIndex(null).size, 0);
});

test('getEmojiIndex builds one index per glyph list and reuses it', () => {
  const a = getEmojiIndex(CHARS);
  assert.equal(getEmojiIndex(CHARS), a, 'repeat calls must not re-index');
  assert.equal(a.get('\u{1F600}'), 'grinning face smile happy');

  const other = ['\u2705'];
  const b = getEmojiIndex(other);
  assert.notEqual(b, a, 'a different glyph list gets its own index');
  assert.equal(b.get('\u2705'), 'check mark button ok agree');
});

// ── Filtering ───────────────────────────────────────────────────────────────

test('filterEmojiChars matches on any keyword, as a substring', () => {
  const index = getEmojiIndex(CHARS);
  assert.deepEqual(filterEmojiChars(CHARS, 'smile', index), ['\u{1F600}']);
  assert.deepEqual(filterEmojiChars(CHARS, 'HEART', index), ['\u2764']);
  assert.deepEqual(filterEmojiChars(CHARS, 'gree', index), ['\u2705']);
});

test('filterEmojiChars AND-matches every word in the query', () => {
  const index = getEmojiIndex(CHARS);
  assert.deepEqual(filterEmojiChars(CHARS, 'red heart', index), ['\u2764']);
  assert.deepEqual(filterEmojiChars(CHARS, 'red grinning', index), []);
});

test('filterEmojiChars falls back to a direct lookup with no index', () => {
  assert.deepEqual(filterEmojiChars(CHARS, 'smile'), ['\u{1F600}']);
});
