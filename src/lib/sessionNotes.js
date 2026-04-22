/** Max “Important” sidebar notes per session (Firestore array size guard). */
export const SESSION_SIDEBAR_NOTES_MAX = 15;
/** Max named https links stored on a single session note. */
export const SESSION_NOTE_LINKS_MAX = 12;

function normalizeNoteLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(l => l && typeof l === 'object')
    .map(l => ({
      url: String(l.url || l.href || '').trim(),
      label: String(l.label || l.name || '').trim(),
    }))
    .filter(l => /^https:\/\//i.test(l.url))
    .slice(0, SESSION_NOTE_LINKS_MAX);
}

/**
 * Normalize session document → ordered note objects.
 * Prefers `sessionNotes` array; otherwise one synthetic note from legacy fields.
 */
export function getSessionNotesFromDoc(s) {
  if (!s) return [];
  if (Array.isArray(s.sessionNotes) && s.sessionNotes.length) {
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
  const t = String(s.sessionNoteTitle || '').trim();
  const b = String(s.sessionNoteBody || '').trim();
  const urls = Array.isArray(s.sessionNoteImageUrls)
    ? s.sessionNoteImageUrls.map(u => String(u).trim()).filter(Boolean)
    : [];
  if (!t && !b && !urls.length) return [];
  return [{
    id: 'legacy',
    order: 0,
    title: s.sessionNoteTitle || '',
    body: s.sessionNoteBody || '',
    imageUrls: urls,
    links: [],
    show: s.sessionNoteShow !== false,
  }];
}

/** Notes visible on the student board (master switch + per-note show + non-empty). */
export function getStudentVisibleSessionNotes(s) {
  if (!s || s.sessionNoteShow === false) return [];
  return getSessionNotesFromDoc(s).filter(
    n => n.show !== false && (
      String(n.title || '').trim() ||
      String(n.body || '').trim() ||
      (n.imageUrls || []).length ||
      (n.links || []).length
    )
  );
}
