import { useState, useEffect, useRef } from 'react';
import firebase from '../../lib/firebaseCompat.js';
import { useFirebase } from '../../shared/FirebaseContext.jsx';
import { ensureInstructorAuth } from '../../lib/auth.js';
import useInstructorStore from '../store/useInstructorStore.js';
import { SESSION_JOIN_PREFIX } from '../../lib/sessionCode.js';
import { emailToId, nameToId } from '../hooks/useInstructorAuth.js';
import { instructorDirectoryEntry } from '../../lib/sessionInstructors.js';
import { DEFAULT_STUDENT_ORG_CLAIM_URL } from '../../lib/sessionLaunch.js';
import SaveButton from './SaveButton.jsx';
import { sessionDateInputToDisplay } from '../../lib/sessionDateLocal.js';
import { DEFAULT_SESSION_TIMEZONE, SESSION_TIMEZONE_OPTIONS, initSessionTimezoneSelects } from '../../lib/sessionTimezones.js';

function formatDisplayTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = SESSION_JOIN_PREFIX;
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const CODE_ATTEMPTS = 5;

/**
 * Claim an unused session code and write the session under it.
 *
 * The four-character code space is ~1M, so collisions are rare but not
 * impossible, and a plain `.set()` would silently overwrite whatever session
 * already lives at that code (taking its questions subcollection with it).
 * The transaction makes the "is it free?" check and the write atomic.
 */
async function createSessionWithUniqueCode(db, payload) {
  return db.runTransaction(async (tx) => {
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const code = genCode();
      const ref = db.collection('sessions').doc(code);
      // All reads happen before the single write, as transactions require.
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, payload);
        return code;
      }
    }
    throw new Error('Could not find a free session code. Please try again.');
  });
}

export default function CreateSessionModal() {
  const { db } = useFirebase();
  const open = useInstructorStore(s => s.createSessionModalOpen);
  const setOpen = useInstructorStore(s => s.setCreateSessionModalOpen);
  const isDemoMode = useInstructorStore(s => s.isDemoMode);
  const currentInstructor = useInstructorStore(s => s.currentInstructor);
  const setAllSessions = useInstructorStore(s => s.setAllSessions);
  const setActiveSessionCode = useInstructorStore(s => s.setActiveSessionCode);
  const showToast = useInstructorStore(s => s.showToast);

  const [sessionName, setSessionName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_SESSION_TIMEZONE);
  const [room, setRoom] = useState('');
  const [desc, setDesc] = useState('');
  const [orgClaimUrl, setOrgClaimUrl] = useState('');
  const [orgClaimCopy, setOrgClaimCopy] = useState('');
  const [surveyUrl, setSurveyUrl] = useState('');
  const [surveyCopy, setSurveyCopy] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const tzSelectRef = useRef(null);
  const nameInputRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setSessionName(''); setDate(''); setTime(''); setTimezone(DEFAULT_SESSION_TIMEZONE);
    setRoom(''); setDesc(''); setOrgClaimUrl(''); setOrgClaimCopy('');
    setSurveyUrl(''); setSurveyCopy(''); setError(''); setLoading(false);
    // Init timezone options
    const tzTimer = setTimeout(() => initSessionTimezoneSelects(), 0);

    // Focus the first field, close on Escape, and return focus to the opener.
    // Escape is bound in the BUBBLE phase so the image lightbox's capture-phase
    // handler still wins while it is open.
    openerRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => {
      if (nameInputRef.current) {
        try { nameInputRef.current.focus(); } catch (e) {}
      }
    });
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      clearTimeout(tzTimer);
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && typeof opener.focus === 'function') {
        try { opener.focus(); } catch (e) {}
      }
    };
  }, [open, setOpen]);

  if (!open) return null;

  if (isDemoMode) {
    return null; // Demo mode can't create sessions
  }

  const handleCreate = async () => {
    setError('');
    if (!sessionName.trim()) { setError('Please enter a session name.'); return false; }
    if (orgClaimUrl && !/^https?:\/\//i.test(orgClaimUrl)) {
      setError('OrgClaim link must start with http:// or https://');
      return false;
    }
    if (surveyUrl && !/^https:\/\//i.test(surveyUrl)) {
      setError('Survey link must start with https://');
      return false;
    }

    // Creating a session requires a verified salesforce.com user whose email
    // matches ownerEmail (isSalesforce() + ownerEmail == verifiedEmail() in the
    // rules). Await auth before writing so it can't 403 on a pre-auth render.
    const instructor = await ensureInstructorAuth();
    if (!instructor) {
      setError('Sign in with your salesforce.com Google account to create a session.');
      return false;
    }

    // Raw lowercased verified email so Firestore rules can match
    // request.auth.token.email directly. Read it off the verified user rather
    // than the store, which may not have hydrated yet — an empty ownerEmail
    // fails the create rule even though the instructor is properly signed in.
    const ownerEmail = String(instructor.email || '').trim().toLowerCase();
    // Ownership is keyed on the stable identity (Google email), not the display name,
    // so renaming yourself never orphans the sessions you created.
    const state = useInstructorStore.getState();
    const ownerId = emailToId(ownerEmail)
      || state.instructorOwnerId
      || nameToId(currentInstructor || '');

    setLoading(true);
    const directoryEntry = instructorDirectoryEntry(ownerEmail, currentInstructor || '');
    const sessionPayload = {
      sessionName: sessionName.trim(),
      instructorNames: currentInstructor || '',
      instructors: currentInstructor ? [currentInstructor] : [],
      // Email-based ownership for the rewritten rules (owner + co-instructors).
      ownerEmail,
      instructorEmails: ownerEmail ? [ownerEmail] : [],
      instructorDirectory: directoryEntry
        ? { [directoryEntry.key]: directoryEntry.value }
        : {},
      sessionDate: date ? sessionDateInputToDisplay(date) : '',
      sessionTime: time ? formatDisplayTime(time) : '',
      sessionTimezone: timezone || DEFAULT_SESSION_TIMEZONE,
      room: room.trim(),
      description: desc.trim(),
      studentOrgClaimUrl: orgClaimUrl.trim() || DEFAULT_STUDENT_ORG_CLAIM_URL,
      studentOrgClaimCopyText: orgClaimCopy.trim(),
      studentSurveyUrl: surveyUrl.trim(),
      studentSurveyCopyText: surveyCopy.trim(),
      sessionNoteShow: true,
      sessionNotes: [],
      sessionNoteTitle: '',
      sessionNoteBody: '',
      sessionNoteImageUrls: [],
      ownerId,
      ownerName: currentInstructor || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      const code = await createSessionWithUniqueCode(db, sessionPayload);
      const doc = await db.collection('sessions').doc(code).get();
      if (!doc.exists) {
        setError('Session was created but could not be loaded. Refresh the page.');
        setOpen(false);
        return false;
      }
      const merged = { id: doc.id, ...doc.data() };
      const latestSessions = useInstructorStore.getState().allSessions;
      const idx = latestSessions.findIndex(x => x.id === code);
      if (idx >= 0) {
        const updated = [...latestSessions];
        updated[idx] = { ...updated[idx], ...merged };
        setAllSessions(updated);
      } else {
        setAllSessions([merged, ...latestSessions]);
      }
      setActiveSessionCode(code);
      setOpen(false);
      showToast('Session created: ' + code);
      return true;
    } catch (e) {
      console.warn('Session create failed:', e);
      setError('Could not create the session. Check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay open">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-session-title"
        style={{ maxWidth: 560, maxHeight: 'min(92vh,900px)', overflowY: 'auto' }}
      >
        <div className="modal-title" id="create-session-title">Create a new session</div>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.1rem', lineHeight: 1.5 }}>
          Same fields as <strong>Session settings</strong> in the sidebar. A session code is generated when you create the session.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div className="form-field">
            <label htmlFor="create-session-name">Session name</label>
            <input ref={nameInputRef} id="create-session-name" className="mini-input" placeholder="e.g. Track A — Fundamentals" type="text" value={sessionName} onChange={e => setSessionName(e.target.value)} />
          </div>
          <div className="form-row form-row--session-dtz">
            <div className="form-field">
              <label>Date</label>
              <input className="mini-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-field">
              <label>Time</label>
              <input className="mini-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <div className="form-field">
              <label>Timezone (e.g. PT, ET)</label>
              <select
                ref={tzSelectRef}
                className="mini-input"
                aria-label="Session timezone"
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
              >
                {SESSION_TIMEZONE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-field">
            <label>Room / Location</label>
            <input className="mini-input" placeholder="e.g. Hall D — Room 214" type="text" value={room} onChange={e => setRoom(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Description / Agenda <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-light)' }}>(optional)</span></label>
            <textarea className="mini-input mini-textarea" placeholder="What will you cover?" value={desc} onChange={e => setDesc(e.target.value)} />
          </div>
          <div className="form-field">
            <label>OrgClaim link (<code>http://</code> or <code>https://</code>)</label>
            <input className="mini-input" type="url" inputMode="url" placeholder="http://sfdc.co/OrgClaim" autoComplete="off" value={orgClaimUrl} onChange={e => setOrgClaimUrl(e.target.value)} />
          </div>
          <div className="form-field">
            <label>OrgClaim code (text students copy)</label>
            <input className="mini-input" type="text" placeholder="Shown under OrgClaim on the student Session card." autoComplete="off" value={orgClaimCopy} onChange={e => setOrgClaimCopy(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Survey / feedback link (<code>https://</code>)</label>
            <input className="mini-input" type="url" inputMode="url" placeholder="https://…" autoComplete="off" value={surveyUrl} onChange={e => setSurveyUrl(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Survey ID (text students copy)</label>
            <input className="mini-input" type="text" placeholder="Shown under SURVEY on the student Session card." autoComplete="off" value={surveyCopy} onChange={e => setSurveyCopy(e.target.value)} />
          </div>
        </div>
        {error && <p className="error-msg" role="alert" style={{ fontSize: '0.82rem', color: 'var(--warn)', minHeight: '1.2rem', marginBottom: '0.5rem' }}>{error}</p>}
        <div className="modal-footer">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <SaveButton className="save-btn" style={{ padding: '0.55rem 1.25rem', marginTop: 0 }} onClick={handleCreate} disabled={loading}>
            Create session
          </SaveButton>
        </div>
      </div>
    </div>
  );
}
