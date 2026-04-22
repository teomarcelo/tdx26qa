/**
 * Session wall-clock is defined in an IANA timezone (DST-aware).
 * Stored on `sessions/{id}` as `sessionTimezone` (string).
 */

export const DEFAULT_SESSION_TIMEZONE = 'America/Los_Angeles';

/** Value = IANA zone; label = instructor-facing description. */
export const SESSION_TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles (PT)' },
  { value: 'America/Denver', label: 'Mountain — Denver (MT)' },
  { value: 'America/Chicago', label: 'Central — Chicago (CT)' },
  { value: 'America/New_York', label: 'Eastern — New York (ET)' },
  { value: 'America/Phoenix', label: 'Arizona (MST, no DST)' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'UK — London' },
  { value: 'Europe/Paris', label: 'Central Europe — Paris' },
  { value: 'Asia/Tokyo', label: 'Japan — Tokyo' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Australia/Sydney', label: 'Australia — Sydney' },
];

/** Short zone name for student card (e.g. PDT, EST) — depends on current calendar day for DST. */
export function abbreviationForTimezone(iana) {
  if (!iana || typeof iana !== 'string') return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: iana.trim(),
      timeZoneName: 'short',
    }).formatToParts(new Date());
    const hit = parts.find(p => p.type === 'timeZoneName');
    return hit && hit.value ? hit.value.trim() : iana;
  } catch (e) {
    return iana;
  }
}

function populateTimezoneSelect(el) {
  if (!el || el.dataset.tzPopulated === '1') return;
  el.dataset.tzPopulated = '1';
  el.replaceChildren();
  SESSION_TIMEZONE_OPTIONS.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    el.appendChild(opt);
  });
}

/** Call once DOM is ready (both session settings and create-session selects). */
export function initSessionTimezoneSelects() {
  populateTimezoneSelect(typeof document !== 'undefined' ? document.getElementById('sf-timezone') : null);
  populateTimezoneSelect(typeof document !== 'undefined' ? document.getElementById('new-sf-timezone') : null);
}
