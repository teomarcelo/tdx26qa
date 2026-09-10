import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import FormatToolbar from './FormatToolbar.jsx';
import { insertSlackFormat, insertEmoji } from '../utils/formatHelpers.js';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import {
  pendingRowsFromImageUrls,
  questionImageUrlsFromPending,
  questionPasteStoragePath,
  revokePendingBlobUrl,
  runStudentQuestionImagePaste,
  stripEmbeddedImageUrls,
} from '../../lib/imagePaste.js';

/**
 * Edit modal for the student's own question: text + the same image-paste
 * pipeline as the ask box (preview, add, remove). Closes on ESC.
 */
export default function EditModal({
  question,
  sessionCode,
  userId,
  isDemoMode = false,
  showToast,
  onSave,
  onClose,
}) {
  const { storage } = useFirebase();
  const [text, setText] = useState('');
  const [pendingImages, setPendingImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef(null);
  const textareaId = 'edit-text';

  useEffect(() => {
    if (!question) return;
    setText(question.text || '');
    setPendingImages(pendingRowsFromImageUrls(question.imageUrls));
  }, [question]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (question && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [question]);

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
        attachedToast: 'Image attached. Save to keep it.',
        linkFallbackToast: 'Using image link (download or upload was blocked). Save to keep the URL.',
      }),
    [sessionCode, storage, isDemoMode, showToast, uploadImage],
  );

  function removePendingImage(pid) {
    setPendingImages((prev) => {
      const row = prev.find((r) => r.pid === pid);
      revokePendingBlobUrl(row);
      return prev.filter((r) => r.pid !== pid);
    });
  }

  if (!question) return null;

  async function handleSave() {
    if (saving) return;
    if (pendingImages.some((r) => !r.url || r.uploading)) {
      showToast('Wait for images to finish uploading, then save.');
      return;
    }
    const imageUrls = questionImageUrlsFromPending(pendingImages);
    const trimmed = stripEmbeddedImageUrls(text, imageUrls).trim();
    if (!trimmed && !imageUrls.length) {
      showToast('Add some text or an image first.');
      return;
    }
    if (trimmed.length > 10000) {
      showToast('That question is too long. Shorten it and save again.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ text: trimmed, imageUrls });
    } finally {
      setSaving(false);
    }
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

  const modal = (
    <div
      className="modal-overlay open"
      id="edit-modal"
      aria-hidden="false"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
        <div className="modal-title" id="edit-modal-title">Edit your question</div>
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
          placeholder="Edit your question. Paste a screenshot to attach."
          style={{
            width: '100%',
            minHeight: '100px',
            padding: '0.75rem',
            border: '1.5px solid var(--border)',
            borderRadius: '8px',
            fontFamily: 'inherit',
            fontSize: '0.95rem',
            resize: 'vertical',
            outline: 'none',
          }}
        />
        <div
          id="edit-image-previews"
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
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-submit" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
