/**
 * SessionNotesEditor — instructor notes shown to students on the student board.
 * Draft stored in Zustand (sessionNotesDraft). Save writes to Firestore.
 * Drag-to-reorder uses HTML5 DnD in a useEffect.
 * dangerouslySetInnerHTML is NOT used here — all content is controlled inputs.
 */
import { useEffect, useRef } from 'react';
import firebase from '../../../lib/firebaseCompat.js';
import { useFirebase } from '../../../shared/FirebaseContext.jsx';
import { ensureInstructorAuth } from '../../../lib/auth.js';
import { IMAGE_MAX_EDGE, IMAGE_JPEG_QUALITY } from '../../../constants/app.js';
import { extractImageUrlForQuestionPaste } from '../../../lib/clipboardImagePaste.js';
import useInstructorStore from '../../store/useInstructorStore.js';
import { SESSION_SIDEBAR_NOTES_MAX, SESSION_NOTE_LINKS_MAX, getSessionNotesFromDoc } from '../../../lib/sessionNotes.js';
import {
  mergeSessionNotes,
  notesDraftIsDirty,
  remoteNotesChangedSinceBase,
} from '../../lib/sessionNotesDraft.js';
import { myNameForSession } from '../../hooks/useInstructorAuth.js';
import FormatToolbar from '../FormatToolbar.jsx';
import SaveButton from '../SaveButton.jsx';

function newSessionNoteId() {
  return 'sn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// Thrown inside the save transaction and mapped to a message afterwards.
const SESSION_GONE = 'sqa/session-gone';

// ── Image paste helpers (same pipeline as the ask box / answer box) ──────────
/** Extract image File objects from a paste event's clipboard data. */
function collectImageFilesFromPaste(e) {
  const out = [];
  const cd = e.clipboardData;
  if (!cd) return out;
  if (cd.items && cd.items.length) {
    for (let i = 0; i < cd.items.length; i++) {
      const it = cd.items[i];
      if (it.kind === 'file' && it.type && it.type.indexOf('image') === 0) {
        const f = it.getAsFile();
        if (f && f.size > 0) out.push(f);
      }
    }
  }
  if (!out.length && cd.files && cd.files.length) {
    for (let j = 0; j < cd.files.length; j++) {
      if (cd.files[j].type && cd.files[j].type.indexOf('image') === 0 && cd.files[j].size > 0) {
        out.push(cd.files[j]);
      }
    }
  }
  return out;
}

/** Resize an image file/blob to a JPEG blob, capped at IMAGE_MAX_EDGE on the longest side. */
function resizeImageToJpegBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      const w = img.width, h = img.height;
      const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h, 1));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      c.toBlob(
        (blob) => { blob ? resolve(blob) : reject(new Error('encode')); },
        'image/jpeg',
        IMAGE_JPEG_QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('image')); };
    img.src = u;
  });
}

function NoteCard({ note, index, onUpdate, onRemove, onToggleCollapse, storage, sessionCode, isDemoMode, showToast }) {
  const bodyId = `sn-body-${note.id}`;
  const titleId = `sn-title-${note.id}`;

  const noteImages = Array.isArray(note.imageUrls)
    ? note.imageUrls.map(u => String(u || '').trim()).filter(Boolean)
    : [];

  const updateField = (field, value) => {
    onUpdate({ ...note, [field]: value });
  };

  const removeImage = (url) => {
    onUpdate({ ...note, imageUrls: noteImages.filter(u => u !== url) });
  };

  const appendImage = (url) => {
    // Read the latest note images at append time so multiple quick pastes don't
    // clobber each other.
    const current = Array.isArray(note.imageUrls) ? note.imageUrls : [];
    onUpdate({ ...note, imageUrls: [...current, url] });
  };

  // Upload a resized JPEG under sessions/{code}/images/ (same path family the
  // README specifies), returning the download URL.
  const uploadNoteImage = async (blob) => {
    const path = `sessions/${sessionCode}/images/note_${note.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const snap = await storage.ref(path).put(blob, { contentType: 'image/jpeg' });
    return snap.ref.getDownloadURL();
  };

  // Paste-to-upload for note images. Mirrors the ask box / answer box: image files
  // are resized + uploaded to Firebase Storage; a pasted https:// image link is
  // fetched, re-encoded, and uploaded (falling back to the raw URL if blocked).
  const handlePaste = async (e) => {
    const files = collectImageFilesFromPaste(e);
    const clipUrl = extractImageUrlForQuestionPaste(e, files.length > 0);
    if (!files.length && !clipUrl) return;

    if (isDemoMode) {
      e.preventDefault();
      showToast('Image paste: use a live session (demo has no Storage).');
      return;
    }
    if (!sessionCode) return;

    if (!storage) {
      // No Storage bound: keep an https:// link if one was pasted, else advise.
      if (clipUrl) {
        e.preventDefault();
        appendImage(clipUrl);
        showToast('Image link added (Storage not enabled—uses the hosted URL).');
        return;
      }
      e.preventDefault();
      showToast('Image files need Firebase Storage. Paste an https:// image link instead.');
      return;
    }

    e.preventDefault();

    if (files.length) {
      for (const file of files) {
        try {
          showToast('Uploading image…');
          const blob = await resizeImageToJpegBlob(file);
          const url = await uploadNoteImage(blob);
          appendImage(url);
          showToast('Image added to note. Save to keep it.');
        } catch (err) {
          console.warn('Note image upload failed:', err);
          showToast('Upload failed. Check Firebase Storage + rules (SETUP.md).');
        }
      }
      return;
    }

    if (clipUrl) {
      showToast('Uploading image…');
      try {
        const r = await fetch(clipUrl, { mode: 'cors' });
        if (!r.ok) throw new Error('Could not download image.');
        const blob0 = await r.blob();
        const jpeg = await resizeImageToJpegBlob(blob0);
        const url2 = await uploadNoteImage(jpeg);
        appendImage(url2);
        showToast('Image added to note. Save to keep it.');
      } catch (err) {
        console.warn('Note image link upload failed:', err);
        // Fall back to the raw URL so the instructor can still save something.
        appendImage(clipUrl);
        showToast('Using image link (upload was blocked). Save to keep the URL.');
      }
    }
  };

  const updateLink = (i, field, value) => {
    const links = (note.links || []).map((l, idx) => idx === i ? { ...l, [field]: value } : l);
    onUpdate({ ...note, links });
  };

  const addLink = () => {
    if ((note.links || []).length >= SESSION_NOTE_LINKS_MAX) return;
    onUpdate({ ...note, links: [...(note.links || []), { url: '', label: '' }] });
  };

  const removeLink = (i) => {
    onUpdate({ ...note, links: (note.links || []).filter((_, idx) => idx !== i) });
  };

  return (
    <div
      className={`session-note-edit-card${note.editorCollapsed ? ' sn-card-collapsed' : ''}`}
      data-note-id={note.id}
      draggable={false}
    >
      <div className="session-note-edit-card-head">
        <span
          className="sn-drag-handle"
          draggable={true}
          title="Drag to reorder"
          aria-label="Drag to reorder notes"
        >
          ⠿
        </span>
        <button
          type="button"
          className="sn-card-toggle"
          onClick={() => onToggleCollapse(note.id)}
          title="Expand or collapse this note"
          aria-expanded={!note.editorCollapsed}
          aria-label="Expand or collapse note editor"
        >
          <svg
            className="sn-card-toggle-chevron"
            width="14" height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div className="sn-card-head-text">
          <span className="sn-card-preview">{note.title || 'Untitled note'}</span>
          {note.instructor && <span className="sn-card-author">Added by {note.instructor}</span>}
        </div>
        <label className="sn-show-label">
          <input
            type="checkbox"
            className="sn-show"
            checked={note.show !== false}
            onChange={e => updateField('show', e.target.checked)}
          />
          {' '}Show
        </label>
        <button type="button" className="sn-remove-btn" onClick={() => onRemove(note.id)}>Remove</button>
      </div>

      {!note.editorCollapsed && (
        <div className="sn-card-body">
          <div className="form-field">
            <label>Title (optional)</label>
            <input
              className="mini-input sn-title-input"
              type="text"
              id={titleId}
              value={note.title || ''}
              placeholder="e.g. Wi‑Fi, slides"
              onChange={e => updateField('title', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Message</label>
            <FormatToolbar textareaId={bodyId} />
            <textarea
              className="mini-input mini-textarea sn-body-input"
              id={bodyId}
              placeholder="Announcements, reminders, resources… Paste a screenshot or image link to attach."
              value={note.body || ''}
              onChange={e => updateField('body', e.target.value)}
              onPaste={handlePaste}
            />
          </div>

          {/* Attached images (paste to add; × to remove; saved with the note) */}
          <div className="form-field sn-images-field">
            {noteImages.length > 0 && (
              <label className="sn-images-label">Attached images</label>
            )}
            <div className="sn-images-thumbs answer-paste-preview">
              {noteImages.map(url => (
                <span key={url} className="paste-preview-item">
                  <img src={url} alt="" referrerPolicy="no-referrer" />
                  <button
                    type="button"
                    className="paste-preview-remove"
                    aria-label="Remove image"
                    onClick={() => removeImage(url)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Links */}
          <div className="form-field sn-links-field">
            {(note.links || []).length > 0 && (
              <label className="sn-links-label">Named links (https only — shown as buttons on the student dashboard)</label>
            )}
            <div className="sn-links-rows">
              {(note.links || []).map((link, i) => (
                <div key={i} className="sn-link-row">
                  <input
                    className="mini-input sn-link-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={link.url || ''}
                    onChange={e => updateLink(i, 'url', e.target.value)}
                  />
                  <input
                    className="mini-input sn-link-label"
                    type="text"
                    placeholder="Button label (optional)"
                    value={link.label || ''}
                    onChange={e => updateLink(i, 'label', e.target.value)}
                  />
                  <button type="button" className="sn-link-remove-btn" title="Remove link" aria-label="Remove link" onClick={() => removeLink(i)}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="add-btn sn-add-link-row-btn" onClick={addLink}>+ Add link</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionNotesEditor() {
  const { db, storage } = useFirebase();
  const isDemoMode = useInstructorStore(s => s.isDemoMode);
  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const allSessions = useInstructorStore(s => s.allSessions);
  const setAllSessions = useInstructorStore(s => s.setAllSessions);
  const sessionNotesDraft = useInstructorStore(s => s.sessionNotesDraft);
  const setSessionNotesDraft = useInstructorStore(s => s.setSessionNotesDraft);
  const setSessionNotesBase = useInstructorStore(s => s.setSessionNotesBase);
  const sessionNoteShow = useInstructorStore(s => s.sessionNoteShow);
  const setSessionNoteShow = useInstructorStore(s => s.setSessionNoteShow);
  const currentInstructor = useInstructorStore(s => s.currentInstructor);
  const instructorOwnerId = useInstructorStore(s => s.instructorOwnerId);
  const instructorLegacyOwnerId = useInstructorStore(s => s.instructorLegacyOwnerId);
  const instructorEmail = useInstructorStore(s => s.instructorEmail);
  const showToast = useInstructorStore(s => s.showToast);

  const editorRef = useRef(null);

  // Unsaved-changes detection: compare the current draft (and master show toggle)
  // to the saved session doc.
  const activeSession = allSessions.find(x => x.id === activeSessionCode);
  const dirty = notesDraftIsDirty(activeSession, sessionNotesDraft, sessionNoteShow);

  // Wire HTML5 drag-and-drop for reordering
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    let draggingId = null;

    const onDragStart = (e) => {
      const h = e.target.closest('.sn-drag-handle');
      if (!h) return;
      const card = h.closest('.session-note-edit-card');
      if (!card) return;
      draggingId = card.getAttribute('data-note-id');
      e.dataTransfer.setData('text/plain', draggingId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    };

    const onDragEnd = () => {
      editor.querySelectorAll('.session-note-edit-card.is-dragging').forEach(c => c.classList.remove('is-dragging'));
      editor.querySelectorAll('.session-note-edit-card.sn-drag-over').forEach(c => c.classList.remove('sn-drag-over'));
      draggingId = null;
    };

    const onDragOver = (e) => {
      const card = e.target.closest('.session-note-edit-card');
      editor.querySelectorAll('.session-note-edit-card.sn-drag-over').forEach(c => {
        if (c !== card) c.classList.remove('sn-drag-over');
      });
      if (!card || card.classList.contains('is-dragging')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('sn-drag-over');
    };

    const onDrop = (e) => {
      const card = e.target.closest('.session-note-edit-card');
      if (!card) return;
      e.preventDefault();
      card.classList.remove('sn-drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      const toId = card.getAttribute('data-note-id');
      if (!fromId || !toId || fromId === toId) return;

      // Reorder in store
      const latestDraft = useInstructorStore.getState().sessionNotesDraft;
      const arr = [...latestDraft];
      let iFrom = arr.findIndex(n => n.id === fromId);
      let iTo = arr.findIndex(n => n.id === toId);
      if (iFrom < 0 || iTo < 0) return;
      const [item] = arr.splice(iFrom, 1);
      if (iFrom < iTo) iTo--;
      arr.splice(iTo, 0, item);
      arr.forEach((n, i) => { n.order = i; });
      setSessionNotesDraft(arr);
    };

    editor.addEventListener('dragstart', onDragStart);
    editor.addEventListener('dragend', onDragEnd);
    editor.addEventListener('dragover', onDragOver);
    editor.addEventListener('drop', onDrop);

    return () => {
      editor.removeEventListener('dragstart', onDragStart);
      editor.removeEventListener('dragend', onDragEnd);
      editor.removeEventListener('dragover', onDragOver);
      editor.removeEventListener('drop', onDrop);
    };
  }, [setSessionNotesDraft]);

  const addNote = () => {
    if (!activeSessionCode) { showToast('Select a session first.'); return; }
    if (sessionNotesDraft.length >= SESSION_SIDEBAR_NOTES_MAX) {
      showToast(`At most ${SESSION_SIDEBAR_NOTES_MAX} session notes.`);
      return;
    }
    const activeSession = allSessions.find(s => s.id === activeSessionCode);
    const myName = myNameForSession(activeSession, currentInstructor, {
      ownerId: instructorOwnerId,
      legacyOwnerId: instructorLegacyOwnerId,
      email: instructorEmail,
    });
    const collapsed = sessionNotesDraft.map(n => ({ ...n, editorCollapsed: true }));
    setSessionNotesDraft([
      ...collapsed,
      {
        id: newSessionNoteId(),
        order: collapsed.length,
        title: '',
        body: '',
        imageUrls: [],
        links: [],
        show: true,
        instructor: myName,
        editorCollapsed: false,
      },
    ]);
  };

  const updateNote = (updatedNote) => {
    setSessionNotesDraft(sessionNotesDraft.map(n => n.id === updatedNote.id ? updatedNote : n));
  };

  const removeNote = (noteId) => {
    const filtered = sessionNotesDraft.filter(n => n.id !== noteId);
    filtered.forEach((n, i) => { n.order = i; });
    if (filtered.length) {
      filtered.forEach((n, i) => { n.editorCollapsed = i !== filtered.length - 1; });
    }
    setSessionNotesDraft([...filtered]);
  };

  const toggleCollapse = (noteId) => {
    setSessionNotesDraft(sessionNotesDraft.map(n =>
      n.id === noteId ? { ...n, editorCollapsed: !n.editorCollapsed } : n
    ));
  };

  // After a successful save the MERGED array is the truth, not the local draft: it
  // can carry a note a co-instructor added while this editor was open.
  const applySavedNotesLocally = (savedNotes) => {
    const latest = useInstructorStore.getState();
    setAllSessions(latest.allSessions.map(s => (
      s.id === activeSessionCode
        ? {
            ...s,
            sessionNoteShow,
            sessionNotes: savedNotes,
            sessionNoteTitle: '',
            sessionNoteBody: '',
            sessionNoteImageUrls: [],
          }
        : s
    )));
    const collapsedById = new Map(latest.sessionNotesDraft.map(n => [n.id, n.editorCollapsed]));
    setSessionNotesDraft(savedNotes.map((n, i) => ({
      ...n,
      imageUrls: [...(n.imageUrls || [])],
      links: (n.links || []).map(l => ({ url: l.url, label: l.label || '' })),
      editorCollapsed: collapsedById.has(n.id)
        ? collapsedById.get(n.id)
        : (savedNotes.length > 1 ? i !== savedNotes.length - 1 : false),
    })));
    setSessionNotesBase(savedNotes);
  };

  const save = async () => {
    if (!activeSessionCode) { showToast('Select a session first.'); return false; }

    const persistNotes = sessionNotesDraft
      .filter(n =>
        String(n.title || '').trim() ||
        String(n.body || '').trim() ||
        (Array.isArray(n.imageUrls) && n.imageUrls.length) ||
        (Array.isArray(n.links) && n.links.length)
      )
      .map((n, i) => {
        const { editorCollapsed, ...rest } = { ...n, order: i };
        return {
          ...rest,
          links: (rest.links || [])
            .filter(l => /^https?:\/\//i.test(l.url))
            .slice(0, SESSION_NOTE_LINKS_MAX),
        };
      });

    const basePayload = {
      sessionNoteShow,
      sessionNoteTitle: '',
      sessionNoteBody: '',
      sessionNoteImageUrls: [],
    };

    if (isDemoMode) {
      applySavedNotesLocally(persistNotes);
      showToast('Session notes updated (demo).');
      return true;
    }

    if (!db) { showToast('Firebase not available.'); return false; }
    // Updating the session doc requires a verified salesforce.com user
    // (isSalesforce() in the rules). Await auth before writing.
    if (!(await ensureInstructorAuth())) {
      showToast('Sign in with your salesforce.com Google account to save notes.');
      return false;
    }

    const base = useInstructorStore.getState().sessionNotesBase;
    let mergedNotes = persistNotes;
    let remoteChanged = false;
    try {
      // Firestore transaction: sessionNotes is one array field, so writing the local
      // draft over the top loses whatever a co-instructor saved in between. The array
      // is re-read here and merged by note id (see mergeSessionNotes for the
      // deletion rule). The callback can run more than once, so everything derived
      // from the server copy is recomputed on each attempt.
      await db.runTransaction(async (tx) => {
        const ref = db.collection('sessions').doc(activeSessionCode);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error(SESSION_GONE);
        const remote = getSessionNotesFromDoc(snap.data() || {});
        remoteChanged = remoteNotesChangedSinceBase(base, remote);
        mergedNotes = mergeSessionNotes({ base, remote, draft: persistNotes });
        tx.update(ref, {
          ...basePayload,
          sessionNotes: mergedNotes,
          sessionNoteUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      applySavedNotesLocally(mergedNotes);
      if (remoteChanged) {
        showToast('Session notes saved. A co-instructor had also changed notes, so both sets were kept — check the list.');
      } else {
        showToast('Session notes saved.');
      }
      return true;
    } catch (e) {
      if (e && e.message === SESSION_GONE) {
        showToast('That session no longer exists, so the notes were not saved.');
        return false;
      }
      console.warn('Save session notes failed:', e);
      showToast('Could not save your notes. Try again.');
      return false;
    }
  };

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', marginBottom: '0.65rem', cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          id="session-note-show"
          style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
          checked={sessionNoteShow}
          onChange={e => setSessionNoteShow(e.target.checked)}
        />
        Show in student dashboard
      </label>

      <div id="session-notes-editor-host">
        <div ref={editorRef} id="session-notes-editor" className="session-notes-editor" aria-label="Instructor notes for students">
          {sessionNotesDraft.length === 0 ? (
            <p className="sn-empty-hint">No notes yet. Use <strong>+ Add note</strong>, then save.</p>
          ) : (
            sessionNotesDraft.map((note, i) => (
              <NoteCard
                key={note.id}
                note={note}
                index={i}
                onUpdate={updateNote}
                onRemove={removeNote}
                onToggleCollapse={toggleCollapse}
                storage={storage}
                sessionCode={activeSessionCode}
                isDemoMode={isDemoMode}
                showToast={showToast}
              />
            ))
          )}
        </div>
      </div>

      <button type="button" className="add-btn sn-add-note-btn" style={{ marginTop: '0.5rem', width: '100%' }} onClick={addNote}>
        + Add note
      </button>
      <div className="save-row" style={{ marginTop: '0.65rem' }}>
        <SaveButton className="save-btn" style={{ background: 'var(--accent)' }} onClick={save} dirty={dirty}>
          Save session notes
        </SaveButton>
        {dirty && (
          <span className="unsaved-badge"><span className="unsaved-dot" />Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
