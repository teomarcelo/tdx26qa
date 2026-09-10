import { useState, useEffect, useRef } from 'react';
import firebase from '../../../lib/firebaseCompat.js';
import { useFirebase } from '../../../shared/FirebaseContext.jsx';
import useInstructorStore from '../../store/useInstructorStore.js';
import { DEFAULT_STUDENT_ORG_CLAIM_URL } from '../../../lib/sessionLaunch.js';
import { parseDateInputLocal, formatDateInputLocal, sessionDateInputToDisplay } from '../../../lib/sessionDateLocal.js';
import { DEFAULT_SESSION_TIMEZONE, SESSION_TIMEZONE_OPTIONS } from '../../../lib/sessionTimezones.js';
import SaveButton from '../SaveButton.jsx';

function formatDisplayTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function displayTimeToTimeInput(display) {
  const raw = String(display || '').trim();
  if (!raw) return '';
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const parts = raw.split(':');
    return `${String(parseInt(parts[0], 10)).padStart(2, '0')}:${String(parseInt(parts[1], 10)).padStart(2, '0')}`;
  }
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Single source of truth for turning a session doc into editable form values.
// Used both to fill the form and to detect unsaved changes.
function deriveFormFromSession(s) {
  const dateObj = firestoreDateLikeToDate(s.sessionDate);
  const date = dateObj ? formatDateInputLocal(dateObj) : '';
  const timeObj = firestoreDateLikeToDate(s.sessionTime);
  let time;
  if (timeObj) {
    time = `${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`;
  } else {
    time = displayTimeToTimeInput(s.sessionTime) || '';
  }
  const rawTz = String(s.sessionTimezone || '').trim();
  const timezone = SESSION_TIMEZONE_OPTIONS.some(o => o.value === rawTz) ? rawTz : DEFAULT_SESSION_TIMEZONE;
  return {
    sessionName: s.sessionName || '',
    date,
    time,
    timezone,
    room: s.room || '',
    desc: s.description || '',
    orgClaimUrl: String(s.studentOrgClaimUrl || '').trim(),
    orgClaimCopy: s.studentOrgClaimCopyText || '',
    surveyUrl: s.studentSurveyUrl || '',
    surveyCopy: s.studentSurveyCopyText || '',
  };
}

function firestoreDateLikeToDate(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      try { const d = val.toDate(); return isNaN(d) ? null : d; } catch (e) { return null; }
    }
    if (typeof val.seconds === 'number') {
      const d = new Date(val.seconds * 1000);
      return isNaN(d) ? null : d;
    }
  }
  if (typeof val === 'string') {
    const local = parseDateInputLocal(val);
    if (local) return local;
  }
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

export default function SessionSettings() {
  const { db } = useFirebase();
  const isDemoMode = useInstructorStore(s => s.isDemoMode);
  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const allSessions = useInstructorStore(s => s.allSessions);
  const setAllSessions = useInstructorStore(s => s.setAllSessions);
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

  // Unsaved-changes detection: compare the live form to the saved session doc.
  const activeSession = allSessions.find(x => x.id === activeSessionCode);
  const currentForm = { sessionName, date, time, timezone, room, desc, orgClaimUrl, orgClaimCopy, surveyUrl, surveyCopy };
  const dirty = !!activeSession
    && JSON.stringify(currentForm) !== JSON.stringify(deriveFormFromSession(activeSession));

  // Read by the hydration effect below without making it depend on every field.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const lastHydratedCodeRef = useRef(null);

  // Fill from active session
  useEffect(() => {
    if (!activeSessionCode) {
      lastHydratedCodeRef.current = null;
      return;
    }
    const s = allSessions.find(x => x.id === activeSessionCode);
    if (!s) return;
    // allSessions comes from a live onSnapshot, so this effect also runs for remote
    // changes that have nothing to do with this form — a co-instructor joining
    // rewrites instructors/instructorEmails on the same document. Reloading the
    // fields then discarded whatever the instructor had typed and cleared the
    // "Unsaved changes" badge as if it had been saved, so unsaved edits are kept
    // until they save or switch sessions.
    const switchingSession = lastHydratedCodeRef.current !== activeSessionCode;
    if (!switchingSession && dirtyRef.current) return;
    lastHydratedCodeRef.current = activeSessionCode;
    const f = deriveFormFromSession(s);
    setSessionName(f.sessionName);
    setRoom(f.room);
    setDesc(f.desc);
    setOrgClaimUrl(f.orgClaimUrl);
    setOrgClaimCopy(f.orgClaimCopy);
    setSurveyUrl(f.surveyUrl);
    setSurveyCopy(f.surveyCopy);
    setDate(f.date);
    setTime(f.time);
    setTimezone(f.timezone);
  }, [activeSessionCode, allSessions]);

  const handleSave = async () => {
    if (!activeSessionCode) { showToast('Select a session first.'); return false; }
    if (orgClaimUrl && !/^https?:\/\//i.test(orgClaimUrl)) {
      showToast('OrgClaim link must start with http:// or https://');
      return false;
    }
    if (surveyUrl && !/^https:\/\//i.test(surveyUrl)) {
      showToast('Survey link must start with https://');
      return false;
    }
    const payload = {
      sessionName: sessionName.trim(),
      sessionDate: date ? sessionDateInputToDisplay(date) : '',
      sessionTime: time ? formatDisplayTime(time) : '',
      sessionTimezone: timezone || DEFAULT_SESSION_TIMEZONE,
      room: room.trim(),
      description: desc.trim(),
      studentOrgClaimUrl: orgClaimUrl.trim() || DEFAULT_STUDENT_ORG_CLAIM_URL,
      studentOrgClaimCopyText: orgClaimCopy.trim(),
      studentSurveyUrl: surveyUrl.trim(),
      studentSurveyCopyText: surveyCopy.trim(),
    };

    if (isDemoMode) {
      const s = allSessions.find(x => x.id === activeSessionCode);
      if (s) {
        const updated = allSessions.map(sess =>
          sess.id === activeSessionCode ? { ...sess, ...payload } : sess
        );
        setAllSessions(updated);
      }
      showToast('Session info saved! (demo)');
      return true;
    }

    if (!db) { showToast('Firebase not available.'); return false; }
    try {
      await db.collection('sessions').doc(activeSessionCode).update({
        ...payload,
        className: firebase.firestore.FieldValue.delete(),
        studentSurveyButtonLabel: firebase.firestore.FieldValue.delete(),
      });
      const updated = allSessions.map(sess =>
        sess.id === activeSessionCode ? { ...sess, ...payload } : sess
      );
      setAllSessions(updated);
      showToast('Session info saved!');
      return true;
    } catch (e) {
      console.warn('Save session settings failed:', e);
      showToast('Could not save the session. Try again.');
      return false;
    }
  };

  return (
    <div className="session-edit-form">
      <div className="form-field">
        <label>Session name</label>
        <input className="mini-input" id="sf-session" placeholder="e.g. Track A — Fundamentals" type="text" value={sessionName} onChange={e => setSessionName(e.target.value)} />
      </div>
      <div className="form-row form-row--session-dtz">
        <div className="form-field">
          <label>Date</label>
          <input className="mini-input" id="sf-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Time</label>
          <input className="mini-input" id="sf-time" type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Timezone (e.g. PT, ET)</label>
          <select className="mini-input" id="sf-timezone" aria-label="Session timezone" value={timezone} onChange={e => setTimezone(e.target.value)}>
            {SESSION_TIMEZONE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-field">
        <label>Room / Location</label>
        <input className="mini-input" id="sf-room" placeholder="e.g. Hall D — Room 214" type="text" value={room} onChange={e => setRoom(e.target.value)} />
      </div>
      <div className="form-field">
        <label>Description / Agenda</label>
        <textarea className="mini-input mini-textarea" id="sf-desc" placeholder="What will you cover in this session?" value={desc} onChange={e => setDesc(e.target.value)} />
      </div>
      <div className="form-field">
        <label>OrgClaim link (<code>http://</code> or <code>https://</code>)</label>
        <input className="mini-input" id="sf-orgclaim-url" type="url" inputMode="url" placeholder="http://sfdc.co/OrgClaim" autoComplete="off" value={orgClaimUrl} onChange={e => setOrgClaimUrl(e.target.value)} />
      </div>
      <div className="form-field">
        <label>OrgClaim code (text students copy)</label>
        <input className="mini-input" id="sf-orgclaim-copy" type="text" placeholder="Shown under OrgClaim on the student Session card." autoComplete="off" value={orgClaimCopy} onChange={e => setOrgClaimCopy(e.target.value)} />
      </div>
      <div className="form-field">
        <label>Survey / feedback link (<code>https://</code>)</label>
        <input className="mini-input" id="sf-survey-url" type="url" inputMode="url" placeholder="https://…" autoComplete="off" value={surveyUrl} onChange={e => setSurveyUrl(e.target.value)} />
      </div>
      <div className="form-field">
        <label>Survey ID (text students copy)</label>
        <input className="mini-input" id="sf-survey-copy" type="text" placeholder="Shown under SURVEY on the student Session card." autoComplete="off" value={surveyCopy} onChange={e => setSurveyCopy(e.target.value)} />
      </div>
      <div className="save-row">
        <SaveButton className="save-btn" onClick={handleSave} dirty={dirty}>
          Save session info
        </SaveButton>
        {dirty && (
          <span className="unsaved-badge"><span className="unsaved-dot" />Unsaved changes</span>
        )}
      </div>
    </div>
  );
}
