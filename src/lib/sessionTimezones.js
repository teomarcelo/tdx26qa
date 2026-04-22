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

/**
 * Known IANA zones → stable short label for the student session card (no PST/PDT flip-flop).
 * Prefer generic US labels (PT, MT, CT, ET) so scheduling reads like wall-clock intent, not DST legalese.
 */
const STABLE_TZ_ABBREV = {
  'America/Los_Angeles': 'PT',
  'America/Denver': 'MT',
  'America/Chicago': 'CT',
  'America/New_York': 'ET',
  'America/Phoenix': 'MST',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'HST',
  UTC: 'UTC',
  'Europe/London': 'London',
  'Europe/Paris': 'Paris',
  'Asia/Tokyo': 'JST',
  'Asia/Kolkata': 'IST',
  'Australia/Sydney': 'AET',
};

/** Short label for student session date line (stable where DST would confuse, e.g. PT not PDT). */
export function abbreviationForTimezone(iana) {
  if (!iana || typeof iana !== 'string') return '';
  const key = iana.trim();
  if (STABLE_TZ_ABBREV[key]) return STABLE_TZ_ABBREV[key];
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    const hit = parts.find(p => p.type === 'timeZoneName');
    const short = hit && hit.value ? hit.value.trim() : '';
    if (!short) return key;
    // US zones not in the table: collapse DST-specific English abbreviations to generic wall-clock labels.
    if (/^(PDT|PST)$/.test(short)) return 'PT';
    if (/^(MDT|MST)$/.test(short) && key !== 'America/Phoenix') return 'MT';
    if (/^(CDT|CST)$/.test(short)) return 'CT';
    if (/^(EDT|EST)$/.test(short)) return 'ET';
    if (/^(AKDT|AKST)$/.test(short)) return 'Alaska';
    if (/^(BST|GMT)$/.test(short)) return 'London';
    if (/^(CEST|CET)$/.test(short)) return 'Paris';
    if (/^(AEDT|AEST|ACDT|ACST)$/.test(short)) return 'AET';
    return short;
  } catch (e) {
    return key;
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
