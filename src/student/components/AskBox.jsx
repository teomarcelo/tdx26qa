import { useState, useRef, useCallback } from 'react';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import firebase from '../../lib/firebaseCompat.js';
import { ensureAnonymousStudent, currentUid } from '../../lib/auth.js';
import FormatToolbar from './FormatToolbar.jsx';
import { insertSlackFormat, insertEmoji } from '../utils/formatHelpers.js';
import {
  newPasteId,
  questionImageUrlsFromPending,
  questionPasteStoragePath,
  revokePendingBlobUrl,
  runStudentQuestionImagePaste,
  stripEmbeddedImageUrls,
} from '../../lib/imagePaste.js';
import useStudentDemoStore, { DEMO_STUDENT_USER_ID } from '../demo/useStudentDemoStore.js';
import { createPendingSubmissions, submissionFingerprint } from '../lib/pendingSubmissions.js';

function genId() {
  return newPasteId();
}

/**
 * How long to wait for a question write before handing the UI back.
 *
 * Firestore's compat `add()` does NOT reject when the device is offline: the write
 * sits in the local queue and the promise stays pending indefinitely, so nothing
 * ever clears `submitting` and the Submit button dies until a reload.
 */
const SUBMIT_TIMEOUT_MS = 12000;

/** Marker for "the write is still queued", as opposed to a real failure. */
class SubmitStillPendingError extends Error {}

/** Plain-language reason a question write was rejected. */
function formatSubmitError(err) {
  const code = String((err && (err.code || err.name)) || '').toLowerCase();
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return 'Your question was not accepted. Ask your instructor to check the session, then try again.';
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return 'Could not send your question. Check your connection and try again.';
  }
  return 'Could not post your question. Your text is still here — try again.';
}

/**
 * Ask box component: textarea, format toolbar, image paste previews, anon toggle, submit.
 *
 * Manages:
 *  - text state (controlled textarea)
 *  - pendingImages state: array of { pid, url, blobUrl, uploading }
 *  - postAnonymously toggle
 *  - image paste upload via Firebase Storage
 */
export default function AskBox({ sessionCode, userId, userName, showToast, onSubmitDone, isDemoMode = false }) {
  const { db, storage } = useFirebase();
  const prependDemoQuestion = useStudentDemoStore((s) => s.prependQuestion);
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState([]);
  const [postAnonymously, setPostAnonymously] = useState(
    !userName || userName === 'Anonymous',
  );
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef(null);
  const textareaId = 'q-text';
  // Submissions whose Firestore write has not settled yet. Lives in a ref so it
  // survives every re-render of the ask box for as long as the student is in the
  // session, which is exactly as long as an offline write can stay queued.
  const pendingSubmitsRef = useRef(null);
  if (!pendingSubmitsRef.current) pendingSubmitsRef.current = createPendingSubmissions();

  // --- Image upload to Firebase Storage ---
  // Memoized over the same values handlePaste already depends on, so it stays
  // stable exactly as long as handlePaste does.
  const uploadImage = useCallback(
    (jpegBlob) => {
      if (!storage || !sessionCode) return Promise.reject(new Error('no storage'));
      return storage
        .ref(questionPasteStoragePath(sessionCode, userId))
        .put(jpegBlob, { contentType: 'image/jpeg' })
        .then((snap) => snap.ref.getDownloadURL());
    },
    [storage, sessionCode, userId],
  );

  const handlePaste = useCallback(
    (e) =>
      runStudentQuestionImagePaste(e, {
        sessionCode,
        storage,
        isDemoMode,
        showToast,
        uploadImage,
        setPendingImages,
      }),
    [sessionCode, storage, showToast, isDemoMode, uploadImage],
  );

  function removePendingImage(pid) {
    setPendingImages((prev) => {
      const row = prev.find((r) => r.pid === pid);
      revokePendingBlobUrl(row);
      return prev.filter((r) => r.pid !== pid);
    });
  }

  function clearPendingImages() {
    setPendingImages((prev) => {
      prev.forEach(revokePendingBlobUrl);
      return [];
    });
  }

  // --- Submit question ---
  async function handleSubmit() {
    let t = text.trim();
    if (!t && !pendingImages.length) return;
    // Exact textarea contents at submit time, used to decide later whether the
    // box still holds this question or the student has moved on.
    const submittedText = text;

    // Demo mode: prepend the question to the in-memory store. Stamp the demo
    // authorId and track it in sessionStorage (same key the real flow uses) so
    // the "Edit" affordance appears on the student's own question. Never touch
    // Firestore, Storage, or Auth.
    if (isDemoMode) {
      if (!t) return;
      const displayName = postAnonymously
        ? 'Anonymous'
        : userName && userName !== 'Anonymous'
        ? userName
        : 'Anonymous';
      const demoId = 'sdemo-' + genId() + '-' + Date.now();
      prependDemoQuestion({
        id: demoId,
        text: t,
        authorName: displayName,
        authorEmail: '',
        authorId: DEMO_STUDENT_USER_ID,
        createdAt: new Date(),
        status: 'pending',
        pinned: false,
        votes: 0,
        voters: [],
        answer: '',
      });
      try {
        const key = 'sqa_my_questions_' + String(sessionCode || '').replace(/[^A-Z0-9_-]/gi, '');
        const myQs = JSON.parse(sessionStorage.getItem(key) || '[]');
        myQs.push(demoId);
        sessionStorage.setItem(key, JSON.stringify(myQs));
      } catch (e) {}
      setText('');
      clearPendingImages();
      showToast('Question submitted!');
      if (onSubmitDone) onSubmitDone();
      return;
    }

    if (pendingImages.some((r) => !r.url)) {
      showToast('Wait for images to finish uploading, then submit.');
      return;
    }

    const imageUrls = questionImageUrlsFromPending(pendingImages);
    if (pendingImages.length && imageUrls.length !== pendingImages.length) {
      showToast('Wait for all images to finish uploading, then submit again.');
      return;
    }

    t = stripEmbeddedImageUrls(t, imageUrls);

    let textOut = t.trim();
    if (!textOut && imageUrls.length) textOut = '';
    else if (!textOut && !imageUrls.length) textOut = '(Image)';

    const displayName = postAnonymously
      ? 'Anonymous'
      : userName && userName !== 'Anonymous'
      ? userName
      : 'Anonymous';

    // Refuse only this exact question while its write is still outstanding. The
    // 12s timeout below hands the button back before an offline write lands, and
    // without this a second press queued a second document: both then flushed on
    // reconnect and the same question appeared twice on the board.
    const pendingSubmits = pendingSubmitsRef.current;
    const fingerprint = submissionFingerprint(textOut, imageUrls);
    if (!pendingSubmits.reserve(fingerprint)) {
      showToast('That question is already sending — it posts as soon as you are back online.');
      return;
    }

    setSubmitting(true);
    let submitTimer = null;
    try {
      // Ensure a silent anonymous identity so the write carries a Firebase uid
      // the rules can bind to. Falls back gracefully if auth is unavailable.
      await ensureAnonymousStudent();
      const authUid = currentUid();

      const payload = {
        text: textOut,
        authorName: displayName || 'Anonymous',
        authorEmail: '',
        // authorId (localStorage id) is kept for continuity with existing docs;
        // authorUid is the new Firebase-auth-backed owner used by strict rules.
        authorId: userId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
        pinned: false,
        votes: 0,
        voters: [],
        answer: '',
      };
      if (authUid) payload.authorUid = authUid;
      if (imageUrls.length) payload.imageUrls = imageUrls;

      // Document id minted on the client (works offline) and written with set()
      // rather than add(), so this submission addresses one specific document
      // instead of appending a new one every time it is written.
      const docRef = db
        .collection('sessions')
        .doc(sessionCode)
        .collection('questions')
        .doc();

      // Firestore write. Kept in its own variable so the timeout below can hand
      // the UI back WITHOUT cancelling it: the queued write still flushes when
      // connectivity returns, and rememberMyQuestion runs whenever it lands.
      const addPromise = docRef.set(payload);
      addPromise.then(
        () => pendingSubmits.release(fingerprint),
        () => pendingSubmits.release(fingerprint),
      );

      const stillQueued = await Promise.race([
        addPromise.then(() => false),
        new Promise((_resolve, reject) => {
          submitTimer = setTimeout(() => reject(new SubmitStillPendingError()), SUBMIT_TIMEOUT_MS);
        }),
      ]).catch((err) => {
        if (!(err instanceof SubmitStillPendingError)) throw err;
        // Offline (or very slow): stop blocking the student. Keep following the
        // queued write so they still learn how it ended.
        addPromise.then(
          () => {
            rememberMyQuestion(docRef.id);
            // Clear the box only if it still holds exactly what was sent, so
            // anything they typed while waiting is left alone.
            setText((cur) => (cur === submittedText ? '' : cur));
            clearPendingImages();
            showToast('Your question posted.');
            if (onSubmitDone) onSubmitDone();
          },
          (err2) => {
            console.warn('Queued submit question error:', err2);
            showToast(formatSubmitError(err2));
          },
        );
        return true;
      });

      if (stillQueued) {
        showToast('Still sending — this posts as soon as you are back online. No need to submit again.');
        return;
      }

      rememberMyQuestion(docRef.id);

      setText('');
      clearPendingImages();
      showToast('Question submitted!');
      if (onSubmitDone) onSubmitDone();
    } catch (e) {
      // Realistic causes: tightened Firestore rules, App Check enforcement, or
      // anonymous sign-in switched off. Silence here read as a dead button and
      // the student just kept tapping Submit.
      console.warn('Submit question error:', e);
      // Nothing is outstanding once the write has failed, so let them try again.
      pendingSubmits.release(fingerprint);
      showToast(formatSubmitError(e));
    } finally {
      if (submitTimer) clearTimeout(submitTimer);
      setSubmitting(false);
    }
  }

  /** Track a question as "mine" so the Edit affordance appears on it. */
  function rememberMyQuestion(questionId) {
    if (!questionId) return;
    const key = 'sqa_my_questions_' + String(sessionCode || '').replace(/[^A-Z0-9_-]/gi, '');
    try {
      const myQs = JSON.parse(sessionStorage.getItem(key) || '[]');
      myQs.push(questionId);
      sessionStorage.setItem(key, JSON.stringify(myQs));
    } catch (e) {}
  }

  function handleInsertFormat(mode) {
    if (textareaRef.current) {
      insertSlackFormat(textareaRef.current, mode);
      setText(textareaRef.current.value);
    }
  }

  function handleInsertEmoji(ch) {
    if (textareaRef.current) {
      insertEmoji(textareaRef.current, ch);
      setText(textareaRef.current.value);
    }
  }

  const anonLabel = postAnonymously
    ? 'Anonymous'
    : userName && userName !== 'Anonymous'
    ? userName
    : 'Anonymous';

  return (
    <div className="ask-box">
      <div className="ask-box-header">Ask a question</div>
      <FormatToolbar
        targetId={textareaId}
        targetRef={textareaRef}
        onInsertFormat={handleInsertFormat}
        onInsertEmoji={handleInsertEmoji}
        onClear={() => { setText(''); if (textareaRef.current) textareaRef.current.focus(); }}
      />
      <textarea
        id={textareaId}
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        placeholder="What's on your mind? Ask anything about the session…"
        rows={3}
      />

      {/* Image previews */}
      <div
        id="q-image-previews"
        className={`paste-preview-row${pendingImages.length ? ' has-images' : ''}`}
        aria-live="polite"
      >
        {pendingImages.map((row) => (
          <span key={row.pid} className="paste-preview-item" data-pid={row.pid}>
            <img
              alt=""
              referrerPolicy="no-referrer"
              src={row.blobUrl || row.url || ''}
            />
            <button
              type="button"
              className="paste-preview-remove"
              aria-label="Remove image"
              onClick={() => removePendingImage(row.pid)}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div
        className="ask-footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        {/* Anonymous toggle */}
        <label
          id="anon-toggle-label"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            userSelect: 'none',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
          }}
        >
          <div
            id="anon-toggle"
            onClick={() => setPostAnonymously((p) => !p)}
            style={{
              width: '36px',
              height: '20px',
              borderRadius: '20px',
              background: postAnonymously ? 'var(--border)' : 'var(--accent)',
              position: 'relative',
              transition: 'background 0.2s',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            <div
              id="anon-knob"
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: '2px',
                left: '2px',
                transition: 'transform 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                transform: postAnonymously ? 'translateX(0)' : 'translateX(16px)',
              }}
            />
          </div>
          <span id="anon-label-text">
            Post as{' '}
            <strong
              id="anon-name-preview"
              style={{ color: postAnonymously ? 'var(--text-muted)' : 'var(--accent)' }}
            >
              {anonLabel}
            </strong>
          </span>
        </label>

        <button
          className="btn-submit"
          id="submit-btn"
          disabled={submitting}
          onClick={handleSubmit}
        >
          Submit question
        </button>
      </div>
    </div>
  );
}
