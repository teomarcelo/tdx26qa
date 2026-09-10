import { useState, useEffect, useRef } from 'react';
import useInstructorStore from '../store/useInstructorStore.js';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import { ensureInstructorAuth } from '../../lib/auth.js';

export default function DeleteModal() {
  const { db } = useFirebase();
  const deleteTargetId = useInstructorStore(s => s.deleteTargetId);
  const closeDeleteModal = useInstructorStore(s => s.closeDeleteModal);
  const isDemoMode = useInstructorStore(s => s.isDemoMode);
  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const removeQuestionFromPages = useInstructorStore(s => s.removeQuestionFromPages);
  const showToast = useInstructorStore(s => s.showToast);

  const [inProgress, setInProgress] = useState(false);
  const cancelBtnRef = useRef(null);
  const openerRef = useRef(null);

  // Focus the non-destructive action first, close on Escape, restore focus on close.
  // Escape is bound in the BUBBLE phase so the image lightbox's capture-phase
  // handler still closes only itself when both are open.
  useEffect(() => {
    if (!deleteTargetId) return undefined;
    openerRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => {
      if (cancelBtnRef.current) {
        try { cancelBtnRef.current.focus(); } catch (e) {}
      }
    });
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeDeleteModal();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && typeof opener.focus === 'function') {
        try { opener.focus(); } catch (e) {}
      }
    };
  }, [deleteTargetId, closeDeleteModal]);

  if (!deleteTargetId) return null;

  const confirmDelete = async () => {
    if (!deleteTargetId || inProgress) return;
    const rid = deleteTargetId;

    if (isDemoMode) {
      removeQuestionFromPages(rid);
      showToast('Question deleted.');
      closeDeleteModal();
      return;
    }

    if (!db) { showToast('Firebase not available.'); closeDeleteModal(); return; }
    // Deleting a question requires a verified salesforce.com user (isSalesforce()
    // in the rules). Await auth so a pre-auth render / anon session can't 403.
    if (!(await ensureInstructorAuth())) {
      showToast('Sign in with your salesforce.com Google account to delete questions.');
      return;
    }
    setInProgress(true);
    try {
      await db.collection('sessions').doc(activeSessionCode).collection('questions').doc(rid).delete();
      removeQuestionFromPages(rid);
      showToast('Question deleted.');
      closeDeleteModal();
    } catch (err) {
      console.error(err);
      const msg = (err && err.code === 'permission-denied')
        ? 'Firestore denied delete. In Firebase → Firestore → Rules, allow delete on questions (see SETUP.md).'
        : ('Could not delete: ' + (err && err.message ? err.message : 'unknown error'));
      showToast(msg);
      closeDeleteModal();
    } finally {
      setInProgress(false);
    }
  };

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => { if (e.target === e.currentTarget) closeDeleteModal(); }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-question-title"
        aria-describedby="delete-question-body"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-title" id="delete-question-title">Delete this question?</div>
        <div className="modal-body" id="delete-question-body">This action can't be undone. The question and any answer will be permanently removed.</div>
        <div className="modal-footer">
          <button ref={cancelBtnRef} className="btn-ghost" onClick={closeDeleteModal}>Cancel</button>
          <button className="btn-danger" onClick={confirmDelete} disabled={inProgress}>
            {inProgress ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
