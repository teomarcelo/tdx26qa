/**
 * Session-notes draft helpers shared by the notes editor and the Dashboard
 * hydration effect.
 *
 * Session notes are a single array field on the session document, and two
 * instructors can have the editor open at once, so a save cannot just write the
 * local draft over the top. These helpers give the editor a three-way merge and
 * give the Dashboard a way to ask "is there unsaved work here?" before it
 * re-hydrates the draft from a snapshot.
 */
import { getSessionNotesFromDoc } from '../../lib/sessionNotes.js';

/**
 * Canonical, comparable shape for a note (drops editor-only fields like
 * editorCollapsed and empty notes) so unsaved changes can be detected.
 */
export function canonicalNotes(notes) {
  return (notes || [])
    .map(n => ({
      id: String(n.id || ''),
      title: String(n.title || '').trim(),
      body: String(n.body || '').trim(),
      imageUrls: Array.isArray(n.imageUrls) ? n.imageUrls.map(u => String(u).trim()).filter(Boolean) : [],
      links: (Array.isArray(n.links) ? n.links : [])
        .map(l => ({ url: String((l && (l.url || l.href)) || '').trim(), label: String((l && (l.label || l.name)) || '').trim() }))
        .filter(l => /^https?:\/\//i.test(l.url)),
      show: n.show !== false,
      instructor: String(n.instructor || '').trim(),
    }))
    .filter(n => n.title || n.body || n.imageUrls.length || n.links.length);
}

function sameNotes(a, b) {
  return JSON.stringify(canonicalNotes(a)) === JSON.stringify(canonicalNotes(b));
}

/** True when the draft (or the master show toggle) differs from the saved session. */
export function notesDraftIsDirty(session, draft, sessionNoteShow) {
  if (!session) return false;
  const savedShow = session.sessionNoteShow !== false;
  if (sessionNoteShow !== savedShow) return true;
  return !sameNotes(draft, getSessionNotesFromDoc(session));
}

/** True when a co-instructor changed the notes since this draft was hydrated. */
export function remoteNotesChangedSinceBase(base, remote) {
  return !sameNotes(base, remote);
}

/**
 * Three-way merge of a notes save.
 *
 * `base` is the remote array the draft was hydrated from, `remote` is the array as
 * it is right now, `draft` is what this instructor is saving.
 *
 * DELETION SEMANTICS (deliberate choice): a note is only deleted when it was in
 * `base` — i.e. this instructor actually had it on screen and removed it. A note
 * that appeared in `remote` after the draft was hydrated was never visible here, so
 * it is preserved rather than silently deleted by a save that predates it. Per-note
 * edits are last-write-wins, and the caller surfaces a notice when `remote` moved.
 *
 * The alternative (tombstones) would need a `deleted` flag that the student-facing
 * reader in src/lib/sessionNotes.js would have to learn to filter, and tombstones
 * would accumulate against the per-session note cap.
 *
 * DUPLICATE REMOTE IDS: `remote` can carry the same id twice — getSessionNotesFromDoc
 * falls back to a positional `n<i>` id for a note that has none, which can collide
 * with a real one. Each id-matching rule above describes ONE note, so it is applied
 * only to the first remote note carrying that id; a second is a different note and is
 * kept, under a fresh id when that one is already taken.
 */
function uniqueNoteId(id, used) {
  let n = 2;
  while (used.has(`${id}_${n}`)) n++;
  return `${id}_${n}`;
}

export function mergeSessionNotes({ base, remote, draft }) {
  const baseIds = new Set((base || []).map(n => String(n && n.id)));
  const draftIds = new Set((draft || []).map(n => String(n && n.id)));
  const merged = [...(draft || [])];
  const usedIds = new Set(merged.map(n => String(n && n.id)));
  const seenRemoteIds = new Set();

  (remote || []).forEach(n => {
    if (!n) return;
    const id = String(n.id);
    const firstWithThisId = !seenRemoteIds.has(id);
    seenRemoteIds.add(id);

    if (firstWithThisId) {
      if (draftIds.has(id)) return;  // this instructor's version of the note wins
      if (baseIds.has(id)) return;   // it was on screen here and was removed on purpose
      merged.push(n);                // added by a co-instructor after the draft loaded
      usedIds.add(id);
      return;
    }

    // A note sharing an already-used id: keep it, but re-key it so both notes stay
    // addressable — the editor keys its cards by id and the next merge would
    // otherwise resolve the pair as one note again.
    const kept = usedIds.has(id) ? { ...n, id: uniqueNoteId(id, usedIds) } : n;
    usedIds.add(String(kept.id));
    merged.push(kept);
  });

  return merged.map((n, i) => ({ ...n, order: i }));
}
