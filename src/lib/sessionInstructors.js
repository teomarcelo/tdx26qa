/**
 * Derive the teaching roster for a session.
 *
 * Instructors are now automatic: the session owner (ownerName) is the lead, and
 * co-instructors are anyone who joined the session with its code (their display
 * name is added to the `instructors` array on join). We keep reading the legacy
 * `instructors` / `instructorNames` fields so older sessions still show correctly.
 *
 * `instructorDirectory` maps emailToId(email) → { email, name } so a Lead button
 * can transfer ownership to a specific Google identity. Names alone are not
 * unique and are not what firestore.rules checks.
 */

/** Same transform as emailToId in useInstructorAuth (kept here to avoid pulling auth into the student bundle). */
export function instructorDirectoryKey(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function listedInstructorEmails(session) {
  const raw = session && Array.isArray(session.instructorEmails) ? session.instructorEmails : [];
  const out = [];
  const seen = new Set();
  raw.forEach((e) => {
    const email = String(e || '').trim().toLowerCase();
    if (!email || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  });
  return out;
}

export function readInstructorDirectory(session) {
  const dir = session && session.instructorDirectory;
  if (!dir || typeof dir !== 'object' || Array.isArray(dir)) return [];
  const out = [];
  Object.keys(dir).forEach((key) => {
    const val = dir[key];
    if (!val || typeof val !== 'object') return;
    const email = String(val.email || '').trim().toLowerCase();
    if (!email) return;
    const name = String(val.name || '').trim() || email;
    out.push({ key, email, name });
  });
  return out;
}

/**
 * @param {object} session - Firestore session doc (with id + fields).
 * @returns {{ lead: string, coInstructors: string[] }}
 */
export function getSessionInstructorRoster(session) {
  const s = session || {};

  const list = Array.isArray(s.instructors) && s.instructors.length
    ? s.instructors.map(n => String(n || '').trim()).filter(Boolean)
    : String(s.instructorNames || '')
        .split(',')
        .map(n => n.trim())
        .filter(Boolean);

  const lead = String(s.ownerName || '').trim() || list[0] || '';

  // Co-instructors = everyone in the roster except the lead, de-duped, order kept.
  const seen = new Set(lead ? [lead] : []);
  const coInstructors = [];
  list.forEach(n => {
    if (n && !seen.has(n)) {
      seen.add(n);
      coInstructors.push(n);
    }
  });

  return { lead, coInstructors };
}

/** Full ordered roster (lead first) as a flat list of names. */
export function getSessionInstructorNames(session) {
  const { lead, coInstructors } = getSessionInstructorRoster(session);
  return [lead, ...coInstructors].filter(Boolean);
}

/**
 * Rows for the instructor-manager chips, including whether each co-instructor
 * can be made lead (they OAuth-joined, so their email is on the allow-list).
 */
export function getInstructorManagerRows(session, identity = {}) {
  const myEmail = String(identity.email || '').trim().toLowerCase();
  const myName = String(identity.name || '').trim();
  const { lead, coInstructors } = getSessionInstructorRoster(session);
  const ownerEmail = String(session && session.ownerEmail || '').trim().toLowerCase();
  const listed = new Set(listedInstructorEmails(session));
  const dir = readInstructorDirectory(session);
  const usedEmails = new Set();
  if (ownerEmail) usedEmails.add(ownerEmail);

  function emailForName(name) {
    const matches = dir.filter((d) => d.name === name);
    const listedMatches = matches.filter((d) => listed.has(d.email));
    if (listedMatches.length === 1) return listedMatches[0].email;
    if (matches.length === 1 && listed.has(matches[0].email)) return matches[0].email;
    if (myName && name === myName && listed.has(myEmail)) return myEmail;
    return null;
  }

  const coRows = coInstructors.map((name) => {
    const email = emailForName(name);
    if (email) usedEmails.add(email);
    return {
      key: email || `name:${name}`,
      name,
      email,
      canBecomeLead: !!(email && listed.has(email) && email !== ownerEmail),
    };
  });

  listed.forEach((email) => {
    if (usedEmails.has(email)) return;
    const ent = dir.find((d) => d.email === email);
    coRows.push({
      key: email,
      name: ent ? ent.name : email,
      email,
      canBecomeLead: email !== ownerEmail,
    });
    usedEmails.add(email);
  });

  return {
    lead: lead ? { name: lead, email: ownerEmail || null } : null,
    coInstructors: coRows,
  };
}

const SF_EMAIL_RE = /^[^@]+@salesforce\.com$/;

/**
 * Payload to make `nextEmail` the session owner. They must already be on
 * instructorEmails (joined via Google). Returns `{ ok, error }` or `{ ok, update }`.
 */
export function buildLeadTransferUpdate(session, nextEmail, nextName) {
  const email = String(nextEmail || '').trim().toLowerCase();
  const name = String(nextName || '').trim();
  const listed = listedInstructorEmails(session);
  const current = String(session && session.ownerEmail || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, error: 'That instructor needs to join with Google first.' };
  }
  if (!SF_EMAIL_RE.test(email)) {
    return { ok: false, error: 'Lead must be a salesforce.com Google account.' };
  }
  if (!listed.includes(email)) {
    return { ok: false, error: 'They need to join this session before they can be lead.' };
  }
  if (email === current) {
    return { ok: false, error: 'They are already the lead.' };
  }
  if (!name) {
    return { ok: false, error: 'That instructor needs a display name.' };
  }
  return {
    ok: true,
    update: {
      ownerEmail: email,
      ownerName: name,
      ownerId: instructorDirectoryKey(email),
    },
  };
}

/** Directory entry written on create / join. */
export function instructorDirectoryEntry(email, name) {
  const normalized = String(email || '').trim().toLowerCase();
  const key = instructorDirectoryKey(normalized);
  if (!key || !normalized) return null;
  return {
    key,
    value: { email: normalized, name: String(name || '').trim() || normalized },
  };
}
