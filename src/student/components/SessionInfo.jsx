import { useState } from 'react';
import { parseDateInputLocal } from '../../lib/sessionDateLocal.js';
import { abbreviationForTimezone } from '../../lib/sessionTimezones.js';
import {
  getEffectiveStudentOrgClaimUrl,
  getStudentOrgClaimCodeOnly,
  sessionShowsSurveyOnStudent,
} from '../../lib/sessionLaunch.js';
import { isHttpOrHttpsUrl } from '../../lib/richText.js';
import { getSessionInstructorRoster } from '../../lib/sessionInstructors.js';

/** Display title for top bar + session card. */
export function studentSessionDisplayTitle(s) {
  if (!s) return '';
  return String(s.sessionName || '').trim();
}

/** Normalize Firestore Timestamp / plain seconds / string for the sidebar date line. */
function formatDatePart(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'string') {
    const localFromInput = parseDateInputLocal(val);
    if (localFromInput) {
      return localFromInput.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      try { return val.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
      catch (e) { return ''; }
    }
    if (typeof val.seconds === 'number') {
      return new Date(val.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  return String(val).trim();
}

function formatTimePart(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      try { return val.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
      catch (e) { return ''; }
    }
    if (typeof val.seconds === 'number') {
      return new Date(val.seconds * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }
  return String(val).trim();
}

export function sessionDateTimeLine(s) {
  if (!s) return '—';
  const d = formatDatePart(s.sessionDate);
  const t = formatTimePart(s.sessionTime);
  const tz = abbreviationForTimezone(String(s.sessionTimezone || '').trim());
  const parts = [d, t].filter(Boolean);
  if (tz) parts.push(tz);
  return parts.length ? parts.join(' · ') : '—';
}

function copyPlainToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve();
    } catch (e) { reject(e); }
  });
}

/**
 * Session info card: title, date, room, description, OrgClaim, Survey.
 */
export default function SessionInfo({ currentSession, showToast }) {
  const s = currentSession || {};
  const title = studentSessionDisplayTitle(s);
  const dateLine = sessionDateTimeLine(s);
  const room = s.room || '—';
  const desc = String(s.description || '').trim();

  const { lead, coInstructors } = getSessionInstructorRoster(s);

  const orgClaimUrl = getEffectiveStudentOrgClaimUrl(s);
  const orgClaimCode = getStudentOrgClaimCodeOnly(s).replace(/\r\n/g, '\n').trim();
  const showSurvey = sessionShowsSurveyOnStudent(s);
  const surveyUrl = String(s.studentSurveyUrl || '').trim();
  const surveyCode = String(s.studentSurveyCopyText || '').replace(/\r\n/g, '\n');

  const [orgClaimCopied, setOrgClaimCopied] = useState(false);
  const [surveyCopied, setSurveyCopied] = useState(false);

  function handleOrgClaim() {
    if (!isHttpOrHttpsUrl(orgClaimUrl)) {
      showToast('OrgClaim link is not set to a valid http(s) URL.');
      return;
    }
    window.open(orgClaimUrl, '_blank', 'noopener,noreferrer');
    if (!orgClaimCode) {
      showToast('Link opened. No OrgClaim code to copy.');
      return;
    }
    copyPlainToClipboard(orgClaimCode).then(
      () => {
        showToast('OrgClaim code copied. Link opened in a new tab.');
        setOrgClaimCopied(true);
        setTimeout(() => setOrgClaimCopied(false), 1600);
      },
      () => {
        showToast('Link opened — copy failed. Use the OrgClaim code below if needed.');
      },
    );
  }

  function handleSurvey() {
    // Same guard as handleOrgClaim: the URL comes from the session document, and
    // an unvalidated one reaching window.open lets a `javascript:` URI run.
    if (!isHttpOrHttpsUrl(surveyUrl)) {
      showToast('Survey link is not set to a valid http(s) URL.');
      return;
    }
    window.open(surveyUrl, '_blank', 'noopener,noreferrer');
    copyPlainToClipboard(surveyCode).then(
      () => {
        showToast('Survey ID copied. Link opened in a new tab.');
        setSurveyCopied(true);
        setTimeout(() => setSurveyCopied(false), 1600);
      },
      () => {
        showToast('Link opened — copy failed. Use the Survey ID below if needed.');
      },
    );
  }

  return (
    <div className="session-card" id="session-info-card">
      <div className="session-card-title" id="si-title">{title || 'Loading...'}</div>
      <div className="session-meta" id="si-datetime">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span id="si-datetime-text">{dateLine}</span>
      </div>
      <div className="session-meta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <span id="si-room-text">{room}</span>
      </div>
      {lead && (
        <div className="session-instructors" id="si-instructors">
          <div className="si-instructor-row si-instructor-row--lead">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span className="si-instructor-name">{lead}</span>
            <svg className="si-instructor-star" width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" aria-label="Lead instructor">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          {coInstructors.map(name => (
            <div className="si-instructor-row si-instructor-row--co" key={name}>
              <span className="si-instructor-name">{name}</span>
            </div>
          ))}
        </div>
      )}
      {desc && (
        <div className="session-card-desc" id="si-desc">{desc}</div>
      )}

      {/* OrgClaim launch */}
      <div id="student-orgclaim-launch-wrap" className="student-survey-launch-wrap">
        <button
          type="button"
          className="student-survey-launch-btn"
          id="student-orgclaim-launch-btn"
          disabled={orgClaimCopied}
          onClick={handleOrgClaim}
        >
          {orgClaimCopied ? 'Copied!' : 'OrgClaim'}
        </button>
        <div className="student-survey-launch-help" id="student-orgclaim-launch-help" aria-live="polite">
          {orgClaimCode && (
            <>
              <div className="student-survey-launch-help-line">
                OrgClaim Code:{' '}
                <span className="student-survey-launch-help-value">{orgClaimCode}</span>
              </div>
              <div className="student-survey-launch-help-note">
                Clicking button above automatically copies OrgClaim code.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Survey launch */}
      {showSurvey && (
        <div id="student-survey-launch-wrap" className="student-survey-launch-wrap">
          <button
            type="button"
            className="student-survey-launch-btn"
            id="student-survey-launch-btn"
            disabled={surveyCopied}
            onClick={handleSurvey}
          >
            {surveyCopied ? 'Copied!' : 'SURVEY'}
          </button>
          <div className="student-survey-launch-help" id="student-survey-launch-help" aria-live="polite">
            <div className="student-survey-launch-help-line">
              Survey ID:{' '}
              <span className="student-survey-launch-help-value">{surveyCode}</span>
            </div>
            <div className="student-survey-launch-help-note">
              Clicking button above automatically copies survey ID.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
