/**
 * Emoji keyword search.
 *
 * `emojilib` maps a fully-qualified emoji glyph to an array of keywords
 * (e.g. "✅" -> ["check_mark_button","ok","agree","tick",...]). Our pickers use
 * base glyphs that sometimes omit the VS16 variation selector (U+FE0F), so we try
 * a few normalized forms when looking up a glyph.
 *
 * This is plain keyword/substring matching (fast, offline) — not ML "semantic"
 * search, which would be overkill for an emoji picker.
 *
 * The dataset is ~265 kB that only matters once someone opens a picker and types
 * in it, so it is pulled in with a dynamic import() and lands in its own chunk
 * rather than in the bundle every attendee downloads before first paint. Glyphs
 * never wait on it: the picker lists are plain literals in the toolbars, and
 * search matches nothing until the keywords arrive.
 */

const VS16 = '\uFE0F';

/** emojilib's glyph -> keywords map. Null until the dynamic import resolves. */
let keywords = null;
let loadPromise = null;
const readyListeners = new Set();

const EMPTY_INDEX = new Map();
// Keyed on the caller's glyph array so each picker list is indexed at most once
// per page. Only ever populated once the keywords are in, so there is no stale
// empty index to invalidate later.
const indexCache = new WeakMap();

/** True once keyword search can actually match something. */
export function emojiKeywordsReady() {
  return keywords !== null;
}

/** Called when the keywords land. Returns an unsubscribe function. */
export function subscribeEmojiKeywords(onReady) {
  readyListeners.add(onReady);
  return () => { readyListeners.delete(onReady); };
}

/**
 * Fetch the keyword dataset. Every picker on the page shares one in-flight
 * import, so opening two at once does not start two loads.
 *
 * A failed fetch resolves to null instead of rejecting, and clears the flight so a
 * later open can try again. Conference wifi drops mid-workshop; that has to cost
 * search, not the picker.
 */
export function loadEmojiKeywords() {
  if (keywords) return Promise.resolve(keywords);
  if (!loadPromise) {
    loadPromise = import('emojilib')
      .then(mod => {
        keywords = mod.default || mod;
        readyListeners.forEach(fn => { try { fn(); } catch (e) {} });
        return keywords;
      })
      .catch(err => {
        console.warn('Emoji keywords failed to load — search is off, glyphs still work.', err);
        loadPromise = null;
        return null;
      });
  }
  return loadPromise;
}

function lookupKeywords(ch) {
  if (!ch || !keywords) return null;
  return (
    keywords[ch] ||
    keywords[ch + VS16] ||
    keywords[ch.replace(new RegExp(VS16, 'g'), '')] ||
    null
  );
}

/** Lowercased, space-separated keyword string for one glyph (empty if unknown). */
export function emojiSearchText(ch) {
  const kw = lookupKeywords(ch);
  if (!kw || !kw.length) return '';
  return kw.join(' ').toLowerCase().replace(/[_-]+/g, ' ');
}

/** Build a Map(glyph -> searchText) once, so filtering doesn't re-lookup. */
export function buildEmojiIndex(chars) {
  const map = new Map();
  (chars || []).forEach(ch => map.set(ch, emojiSearchText(ch)));
  return map;
}

/**
 * Cached index for a picker's glyph list, shared by both toolbars.
 *
 * Indexing 1,035 glyphs is cheap once and wasteful eleven times: the instructor
 * page renders a toolbar per question plus one per session note, and each of them
 * used to run its own full pass on mount.
 */
export function getEmojiIndex(chars) {
  if (!chars || !keywords) return EMPTY_INDEX;
  let index = indexCache.get(chars);
  if (!index) {
    index = buildEmojiIndex(chars);
    indexCache.set(chars, index);
  }
  return index;
}

/**
 * Filter glyphs by a query. Multiple words are AND-matched (all must appear),
 * so "red heart" narrows to hearts. Empty query returns the full list.
 */
export function filterEmojiChars(chars, query, index) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return chars;
  const terms = q.split(/\s+/).filter(Boolean);
  return (chars || []).filter(ch => {
    const text = index ? index.get(ch) || '' : emojiSearchText(ch);
    if (!text) return false;
    return terms.every(t => text.includes(t));
  });
}
