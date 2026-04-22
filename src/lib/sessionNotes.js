/** Max instructor notes per session (Firestore array size guard). */
export const SESSION_SIDEBAR_NOTES_MAX = 15;
/** Max named http(s) links stored on a single session note. */
export const SESSION_NOTE_LINKS_MAX = 12;

function normalizeNoteLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(l => l && typeof l === 'object')
    .map(l => ({
      url: String(l.url || l.href || '').trim(),
      label: String(l.label || l.name || '').trim(),
    }))
    .filter(l => /^https?:\/\//i.test(l.url))
    .slice(0, SESSION_NOTE_LINKS_MAX);
}

/** Single legacy note from session root fields (no `sessionNotes` cards). */
function legacySessionNoteFromDoc(s) {
  if (!s) return null;
  const t = String(s.sessionNoteTitle || '').trim();
  const b = String(s.sessionNoteBody || '').trim();
  const urls = Array.isArray(s.sessionNoteImageUrls)
    ? s.sessionNoteImageUrls.map(u => String(u).trim()).filter(Boolean)
    : [];
  if (!t && !b && !urls.length) return null;
  return {
    id: 'legacy',
    order: 0,
    title: s.sessionNoteTitle || '',
    body: s.sessionNoteBody || '',
    imageUrls: urls,
    links: [],
    show: s.sessionNoteShow !== false,
  };
}

/**
 * Normalize session document → ordered note objects.
 * Prefers `sessionNotes` array; otherwise one synthetic note from legacy fields.
 */
export function getSessionNotesFromDoc(s) {
  if (!s) return [];
  if (Array.isArray(s.sessionNotes)) {
    if (s.sessionNotes.length > 0) {
      return s.sessionNotes
        .filter(n => n && typeof n === 'object')
        .map((n, i) => ({
          id: String(n.id || `n${i}`),
          order: typeof n.order === 'number' ? n.order : i,
          title: String(n.title || ''),
          body: String(n.body || ''),
          imageUrls: Array.isArray(n.imageUrls) ? n.imageUrls.map(u => String(u).trim()).filter(Boolean) : [],
          links: normalizeNoteLinks(n.links),
          show: n.show !== false,
        }))
        .sort((a, b) => a.order - b.order);
    }
    // Empty array = multi-note model with no cards; still surface legacy root fields if present
    // (e.g. older writes or partial migrations) so students are not stuck with a hidden notes toggle.
    const legacyOnly = legacySessionNoteFromDoc(s);
    return legacyOnly ? [legacyOnly] : [];
  }
  const leg = legacySessionNoteFromDoc(s);
  return leg ? [leg] : [];
}

/** Strip tags / nbsp so a note with only empty HTML still reads as empty. */
function plainishFromNoteField(raw) {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function noteHasStudentVisibleContent(n) {
  if (plainishFromNoteField(n.title)) return true;
  if (plainishFromNoteField(n.body)) return true;
  if ((n.imageUrls || []).length) return true;
  const links = Array.isArray(n.links) ? n.links : [];
  return links.some(l => {
    const u = String((l && (l.url || l.href)) || '').trim();
    return /^https?:\/\//i.test(u);
  });
}

/** Notes visible on the student board (master switch + per-note show + non-empty). */
export function getStudentVisibleSessionNotes(s) {
  if (!s || s.sessionNoteShow === false) return [];
  return getSessionNotesFromDoc(s).filter(
    n => n.show !== false && noteHasStudentVisibleContent(n),
  );
}
