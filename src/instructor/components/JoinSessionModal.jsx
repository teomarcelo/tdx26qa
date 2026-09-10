import { useState, useEffect, useRef } from 'react';
import firebase from '../../lib/firebaseCompat.js';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import useInstructorStore from '../store/useInstructorStore.js';
import {
  SESSION_JOIN_PREFIX,
  syncJoinSuffixInput,
  buildSessionCodeFromJoinRow,
  setJoinRowFromSessionCode,
  JOIN_CODE_ROW_CLASS,
  JOIN_CODE_ROW_LEGACY_TDX_CLASS,
} from '../../lib/sessionCode.js';
import { nameToId } from '../hooks/useInstructorAuth.js';
import { instructorDirectoryEntry } from '../../lib/sessionInstructors.js';
import { ensureInstructorAuth } from '../../lib/auth.js';
import SaveButton from './SaveButton.jsx';

export default function JoinSessionModal() {
  const { db } = useFirebase();
  const open = useInstructorStore(s => s.joinSessionModalOpen);
  const setOpen = useInstructorStore(s => s.setJoinSessionModalOpen);
  const currentInstructor = useInstructorStore(s => s.currentInstructor);
  const setAllSessions = useInstructorStore(s => s.setAllSessions);
  const setActiveSessionCode = useInstructorStore(s => s.setActiveSessionCode);
  const showToast = useInstructorStore(s => s.showToast);

  const [error, setError] = useState('');
  const suffixRef = useRef(null);
  const openerRef = useRef(null);

  // Reset the field, focus it, close on Escape, and hand focus back to whatever
  // opened the dialog. Escape is registered in the BUBBLE phase on purpose: the
  // image lightbox handles Escape in the capture phase and stops propagation, so
  // when both are open only the topmost overlay closes.
  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    setError('');
    if (suffixRef.current) setJoinRowFromSessionCode(suffixRef.current, '');

    const raf = requestAnimationFrame(() => {
      if (suffixRef.current) {
        try { suffixRef.current.focus(); } catch (e) {}
      }
    });
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
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
  }, [open, setOpen]);

  const handleInput = () => {
    if (suffixRef.current) syncJoinSuffixInput(suffixRef.current);
  };

  const handleJoin = async () => {
    setError('');
    const sufEl = suffixRef.current;
    const row = sufEl && sufEl.closest('.' + JOIN_CODE_ROW_CLASS);
    const code = buildSessionCodeFromJoinRow(sufEl);
    if (!code || code === SESSION_JOIN_PREFIX) {
      setError('Enter the four characters after SQA- (or paste a full TDX- code).');
      return false;
    }
    if (row && !row.classList.contains(JOIN_CODE_ROW_LEGACY_TDX_CLASS)) {
      const suf = String(sufEl.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (suf.length < 4) {
        setError('Enter all four characters after SQA-.');
        return false;
      }
    }
    // Joining registers the instructor as a co-instructor (session update +
    // instructor doc write), all of which require a verified salesforce.com user
    // in the rules. Await auth before touching Firestore.
    if (!(await ensureInstructorAuth())) {
      setError('Sign in with your salesforce.com Google account to join a session.');
      return false;
    }
    try {
      const doc = await db.collection('sessions').doc(code).get();
      if (!doc.exists) { setError('Session not found. Check the code.'); return false; }
      const ownerId = useInstructorStore.getState().instructorOwnerId || nameToId(currentInstructor || '');
      const joinPayload = {
        joinedSessions: firebase.firestore.FieldValue.arrayUnion(code),
        sessionsHiddenFromList: firebase.firestore.FieldValue.arrayRemove(code),
      };
      // Remember the session on the instructor's own doc so it comes back in "My
      // sessions" after a reload. update() fails when the doc does not exist yet, so
      // fall back to a merged set. Awaited and caught: this used to be fire-and-
      // forget with an uncaught fallback chain, which produced an unhandled
      // rejection and a session that quietly vanished on the next reload.
      let instructorDocSaved = true;
      try {
        await db.collection('instructors').doc(ownerId).update(joinPayload);
      } catch (updateErr) {
        try {
          const idoc = await db.collection('instructors').doc(ownerId).get();
          const d = idoc.exists ? idoc.data() : {};
          const joined = Array.isArray(d.joinedSessions) ? [...new Set([...d.joinedSessions, code])] : [code];
          const hidden = Array.isArray(d.sessionsHiddenFromList) ? d.sessionsHiddenFromList.filter(c => c !== code) : [];
          await db.collection('instructors').doc(ownerId).set(
            { joinedSessions: joined, sessionsHiddenFromList: hidden },
            { merge: true }
          );
        } catch (setErr) {
          console.warn('Could not record the joined session on the instructor doc:', setErr);
          instructorDocSaved = false;
        }
      }

      // Co-instructors are automatic: register the joiner on the session roster so
      // students (and the lead) see who's teaching. Identity is verified via
      // Firebase Auth (Google), so we record the display name AND append the
      // verified email to instructorEmails so the rules authorize their writes.
      const data = doc.data() || {};
      const roster = Array.isArray(data.instructors)
        ? data.instructors.map(n => String(n || '').trim()).filter(Boolean)
        : String(data.instructorNames || '').split(',').map(n => n.trim()).filter(Boolean);
      const myName = (currentInstructor || '').trim();
      const myEmail = (useInstructorStore.getState().instructorEmail || '').trim().toLowerCase();
      let nextRoster = roster;
      const rosterUpdate = {};
      if (myName && !roster.includes(myName)) {
        nextRoster = [...roster, myName];
        rosterUpdate.instructors = nextRoster;
        rosterUpdate.instructorNames = nextRoster.join(', ');
      }
      // Add the joiner's email to the co-instructor allow-list (rules use this).
      if (myEmail) {
        rosterUpdate.instructorEmails = firebase.firestore.FieldValue.arrayUnion(myEmail);
        const directoryEntry = instructorDirectoryEntry(myEmail, myName);
        if (directoryEntry) {
          rosterUpdate[`instructorDirectory.${directoryEntry.key}`] = directoryEntry.value;
        }
      }
      // This write is what actually grants co-instructor access, so it is awaited and
      // its failure is reported. Swallowing it meant "Joined session SQA-XXXX"
      // followed by every privileged action failing mid-workshop with a sign-in
      // message that pointed at the wrong cause.
      if (Object.keys(rosterUpdate).length) {
        try {
          await db.collection('sessions').doc(code).update(rosterUpdate);
        } catch (rosterErr) {
          console.warn('Join session roster update failed:', rosterErr);
          setError(
            rosterErr && rosterErr.code === 'permission-denied'
              ? 'You can read this session but could not be added as a co-instructor, so answering and pinning would fail. Ask the session owner to add you.'
              : 'Could not register you on this session. Check your connection and try again.'
          );
          return false;
        }
      }
      const sessionData = { id: code, ...data, instructors: nextRoster, instructorNames: nextRoster.join(', ') };
      const latestSessions = useInstructorStore.getState().allSessions;
      if (!latestSessions.find(s => s.id === code)) {
        setAllSessions([sessionData, ...latestSessions]);
      }
      setActiveSessionCode(code);
      setOpen(false);
      showToast(instructorDocSaved
        ? 'Joined session ' + code
        : `Joined ${code}, but it may not be listed after a reload. Rejoin with the code if it disappears.`);
      return true;
    } catch (e) {
      console.warn('Join session failed:', e);
      setError('Could not join that session. Check your connection and try again.');
      return false;
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-session-title"
        style={{ maxWidth: 420 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-title" id="join-session-title">Join a session</div>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.1rem', lineHeight: 1.5 }}>
          <strong>SQA-</strong> is fixed on the left — type the last four characters, or paste a full <strong>SQA-</strong> or legacy <strong>TDX-</strong> code.
        </p>
        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', display: 'block' }}>
            Session code
          </label>
          <div className={`${JOIN_CODE_ROW_CLASS} join-code-row--modal`}>
            <span className="join-code-prefix" aria-hidden="true">SQA-</span>
            <input
              ref={suffixRef}
              id="join-session-code"
              className={`mini-input join-code-suffix`}
              type="text"
              maxLength={8}
              placeholder="AB12"
              autoComplete="off"
              spellCheck={false}
              onInput={handleInput}
              onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
            />
          </div>
        </div>
        {error && <p className="error-msg" role="alert" style={{ fontSize: '0.82rem', color: 'var(--warn)', minHeight: '1.2rem', marginBottom: '0.5rem' }}>{error}</p>}
        <div className="modal-footer">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <SaveButton className="save-btn" style={{ padding: '0.55rem 1.25rem', marginTop: 0 }} onClick={handleJoin}>Join</SaveButton>
        </div>
      </div>
    </div>
  );
}
