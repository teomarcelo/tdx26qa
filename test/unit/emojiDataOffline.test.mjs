/**
 * Unit tests for the emoji picker when the keyword chunk never arrives.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * Separate file from emojiData.test.mjs on purpose: the module caches the dataset
 * for the lifetime of the page, and `node --test` gives each file its own process,
 * so this is the only way to observe a first load that fails.
 *
 * Conference wifi drops mid-workshop. A chunk that fails to load has to cost
 * keyword search and nothing else — no rejected promise nobody catches, no empty
 * picker, no crash on the way to a live audience.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', '..', 'src');

const FAILING_EMOJILIB_STUB = `throw new Error('simulated chunk load failure');`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'emojilib') {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(FAILING_EMOJILIB_STUB),
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  emojiKeywordsReady,
  emojiSearchText,
  filterEmojiChars,
  getEmojiIndex,
  loadEmojiKeywords,
  subscribeEmojiKeywords,
} = await import(pathToFileURL(resolve(SRC, 'lib/emojiData.js')).href);

const CHARS = ['\u{1F600}', '\u2764', '\u2705'];

let warned = 0;
let notified = 0;
const realWarn = console.warn;
console.warn = () => { warned++; };
test.after(() => { console.warn = realWarn; });

test('a failed load resolves instead of rejecting, and says so once', async () => {
  subscribeEmojiKeywords(() => { notified++; });
  const result = await loadEmojiKeywords();
  assert.equal(result, null);
  assert.equal(warned, 1);
  assert.equal(notified, 0, 'nothing is ready, so nothing should be announced');
  assert.equal(emojiKeywordsReady(), false);
});

test('the picker still lists every glyph after the failure', () => {
  const index = getEmojiIndex(CHARS);
  assert.equal(index.size, 0);
  assert.deepEqual(filterEmojiChars(CHARS, '', index), CHARS);
  assert.deepEqual(filterEmojiChars(CHARS, 'smile', index), []);
  assert.equal(emojiSearchText('\u{1F600}'), '');
});

test('a later open is free to try again', async () => {
  assert.equal(await loadEmojiKeywords(), null);
  assert.equal(emojiKeywordsReady(), false);
});
