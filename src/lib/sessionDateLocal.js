/**
 * HTML <input type="date"> uses YYYY-MM-DD. `new Date("YYYY-MM-DD")` parses as UTC midnight,
 * so `toLocaleDateString` in US timezones often shows the *previous* calendar day.
 * Use these helpers for local calendar semantics everywhere we read/write session dates.
 */

/** @param {string} yyyyMmDd */
export function parseDateInputLocal(yyyyMmDd) {
  const s = String(yyyyMmDd || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  if (Number.isNaN(dt.getTime())) return null;
  // new Date(2026, 1, 31) silently rolls forward to March 3rd, so an impossible
  // calendar date used to render as a real one. Only accept a date the
  // constructor did not have to move.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

/** @param {Date} d */
export function formatDateInputLocal(d) {
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

const DISPLAY_OPTS = { month: 'short', day: 'numeric', year: 'numeric' };

/** Display string for session sidebar / Firestore (from date input or Date). */
export function sessionDateInputToDisplay(yyyyMmDd) {
  const d = parseDateInputLocal(yyyyMmDd);
  return d ? d.toLocaleDateString('en-US', DISPLAY_OPTS) : '';
}
