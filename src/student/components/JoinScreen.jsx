import { useState, useRef, useEffect } from 'react';
import {
  SESSION_JOIN_PREFIX,
  syncJoinSuffixInput,
  buildSessionCodeFromJoinRow,
  JOIN_CODE_ROW_CLASS,
  JOIN_CODE_ROW_LEGACY_TDX_CLASS,
} from '../../lib/sessionCode.js';

/**
 * Join screen: code input + name input + join button.
 *
 * The code input uses a "suffix" pattern with a fixed SQA- label chip.
 * syncJoinSuffixInput manipulates the input's parent row element classes
 * to handle legacy TDX- full codes — we keep that vanilla DOM call via a ref.
 *
 * onJoin(code, name) is only called with a fully validated, normalised code.
 * Local validation errors (empty / too short) are shown inline without
 * touching the parent state.
 */
export default function JoinScreen({ storedName, joinError, joining, onJoin }) {
  const codeInputRef = useRef(null);
  const [nameValue, setNameValue] = useState(storedName || '');
  // Local error for client-side validation (empty code, short suffix).
  // Overridden by the joinError prop once a Firestore attempt has been made.
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, []);

  // Clear local error whenever the parent error changes (new join attempt started).
  useEffect(() => {
    if (joinError) setLocalError('');
  }, [joinError]);

  function handleCodeChange() {
    // syncJoinSuffixInput does DOM manipulation on the input's parent row element
    // (toggles JOIN_CODE_ROW_LEGACY_TDX_CLASS) — intentional vanilla DOM call.
    syncJoinSuffixInput(codeInputRef.current);
    setLocalError('');
  }

  function handleCodeKeyDown(e) {
    if (e.key === 'Enter') handleSubmit();
  }

  function handleSubmit() {
    // Only the button carries `disabled`, so Enter could fire a second join while
    // the first was still in flight.
    if (joining) return;
    const sufEl = codeInputRef.current;
    const code = buildSessionCodeFromJoinRow(sufEl);

    if (!code || code === SESSION_JOIN_PREFIX) {
      setLocalError('Enter the session code.');
      return;
    }

    const row = sufEl && sufEl.closest('.' + JOIN_CODE_ROW_CLASS);
    if (row && !row.classList.contains(JOIN_CODE_ROW_LEGACY_TDX_CLASS)) {
      const suf = String(sufEl.value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      if (suf.length < 4) {
        setLocalError('Enter all four characters.');
        return;
      }
    }

    setLocalError('');
    onJoin(code, nameValue);
  }

  const errorMsg = localError || joinError || '';

  return (
    <div id="join-screen" style={{ display: 'flex' }}>
      <div className="join-card">
        <div className="join-logo">
          <div className="join-logo-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <span className="join-logo-text">Session Q&amp;A</span>
        </div>
        <h1 className="join-title">Join your session</h1>
        <div className="field">
          <label htmlFor="code-input">Session code</label>
          <div className={JOIN_CODE_ROW_CLASS}>
            <span className="join-code-prefix" aria-hidden="true">SQA-</span>
            <input
              id="code-input"
              ref={codeInputRef}
              className="code-input code-input--suffix"
              type="text"
              maxLength={8}
              inputMode="text"
              placeholder="AB12"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="join-error"
              aria-invalid={errorMsg ? 'true' : 'false'}
              onChange={handleCodeChange}
              onKeyDown={handleCodeKeyDown}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="name-input">
            Your name{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-light)' }}>
              (optional)
            </span>
          </label>
          <input
            id="name-input"
            type="text"
            placeholder="e.g. Alex"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
          />
          <ul style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6, paddingLeft: '1.1rem' }}>
            <li>Use your real name, a nickname, or anything you like.</li>
            <li>It&apos;s just a display label, not linked to any account or device.</li>
            <li>Your questions are grouped by a random ID saved in this browser, not by your name.</li>
            <li>Once inside, use the <strong style={{ fontWeight: 500 }}>Post anonymously</strong> toggle to submit without any name attached.</li>
          </ul>
        </div>
        <button className="btn-primary" id="join-btn" disabled={joining} onClick={handleSubmit}>
          {joining ? 'Joining…' : 'Join session'}
        </button>
        {/* Always mounted so the card does not reflow when a join fails. role="alert"
            has nothing to announce while it is empty; the announcement happens when
            text appears. */}
        <p className="error-msg" id="join-error" role="alert">{errorMsg}</p>
      </div>
    </div>
  );
}
