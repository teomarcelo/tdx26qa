import { useState, useEffect } from 'react';
import firebase from '../../../lib/firebaseCompat.js';
import { useFirebase } from '../../../shared/FirebaseContext.jsx';
import useInstructorStore from '../../store/useInstructorStore.js';
import { instructorOwnsSession } from '../../hooks/useInstructorAuth.js';
import {
  buildLeadTransferUpdate,
  getInstructorManagerRows,
} from '../../../lib/sessionInstructors.js';
import { publishDemoSessionPatch } from '../../../lib/demoSessionSync.js';

/**
 * Instructor roster for the active session.
 *
 * Co-instructors are added automatically when someone joins with the session
 * code (Google / OAuth). Any listed instructor can press Lead on a joined
 * co-instructor to transfer ownership — so a sick lead is not the only person
 * who can pass the session on. Hide-from-roster stays owner-only, and hiding
 * still does not revoke write access.
 */
export default function InstructorManager() {
  const { db } = useFirebase();
  const isDemoMode = useInstructorStore(s => s.isDemoMode);
  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const allSessions = useInstructorStore(s => s.allSessions);
  const setAllSessions = useInstructorStore(s => s.setAllSessions);
  const instructorOwnerId = useInstructorStore(s => s.instructorOwnerId);
  const instructorLegacyOwnerId = useInstructorStore(s => s.instructorLegacyOwnerId);
  const instructorEmail = useInstructorStore(s => s.instructorEmail);
  const currentInstructor = useInstructorStore(s => s.currentInstructor);
  const showToast = useInstructorStore(s => s.showToast);
  const [pendingLeadEmail, setPendingLeadEmail] = useState(null);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    setPendingLeadEmail(null);
  }, [activeSessionCode]);

  const activeSession = allSessions.find(s => s.id === activeSessionCode);
  const identity = {
    ownerId: instructorOwnerId,
    legacyOwnerId: instructorLegacyOwnerId,
    email: instructorEmail,
  };
  const isOwner = instructorOwnsSession(activeSession, identity);
  const myEmail = String(instructorEmail || '').trim().toLowerCase();
  const listed = Array.isArray(activeSession?.instructorEmails)
    ? activeSession.instructorEmails.map(e => String(e || '').trim().toLowerCase())
    : [];
  const canTransfer = isDemoMode || isOwner || (!!myEmail && listed.includes(myEmail));
  const { lead, coInstructors } = getInstructorManagerRows(activeSession, {
    email: instructorEmail,
    name: currentInstructor,
  });

  const patchSession = (patch) => {
    const latest = useInstructorStore.getState().allSessions;
    setAllSessions(latest.map(s =>
      s.id === activeSessionCode ? { ...s, ...patch } : s
    ));
  };

  const hideFromRoster = async (name) => {
    if (!activeSessionCode || !name) return;

    if (isDemoMode) {
      const currentList = Array.isArray(activeSession?.instructors)
        ? activeSession.instructors
        : String(activeSession?.instructorNames || '').split(',').map(n => n.trim()).filter(Boolean);
      const nextList = currentList.filter(n => String(n || '').trim() !== name);
      patchSession({ instructors: nextList, instructorNames: nextList.join(', ') });
      publishDemoSessionPatch({ instructors: nextList, instructorNames: nextList.join(', ') });
      showToast(`${name} is hidden from the roster (demo).`);
      return;
    }

    if (!db) { showToast('Firebase not available.'); return; }

    try {
      // Transaction + arrayRemove: the old read-modify-write rebuilt the whole
      // roster from an in-memory copy, so a co-instructor joining at the same moment
      // was dropped (or a hidden name came back). arrayRemove takes out exactly one
      // entry, and instructorNames is recomputed from the array read inside the
      // transaction so the two fields cannot drift.
      const nextList = await db.runTransaction(async (tx) => {
        const ref = db.collection('sessions').doc(activeSessionCode);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Session not found.');
        const data = snap.data() || {};
        const serverList = Array.isArray(data.instructors)
          ? data.instructors.map(n => String(n || '').trim()).filter(Boolean)
          : String(data.instructorNames || '').split(',').map(n => n.trim()).filter(Boolean);
        const remaining = serverList.filter(n => n !== name);
        tx.update(ref, {
          instructors: firebase.firestore.FieldValue.arrayRemove(name),
          instructorNames: remaining.join(', '),
        });
        return remaining;
      });
      patchSession({ instructors: nextList, instructorNames: nextList.join(', ') });
      // Deliberately does not claim they were "removed": their access is untouched.
      showToast(`${name} is hidden from the roster students see. They can still edit this session.`);
    } catch (e) {
      console.warn('Hide co-instructor from roster failed:', e);
      showToast('Could not update the roster. Try again.');
    }
  };

  const makeLead = async (row) => {
    if (!activeSessionCode || !row || transferring) return;

    if (isDemoMode) {
      patchSession({ ownerName: row.name });
      publishDemoSessionPatch({ ownerName: row.name });
      setPendingLeadEmail(null);
      showToast(`${row.name} is now the lead (demo).`);
      return;
    }

    const built = buildLeadTransferUpdate(activeSession, row.email, row.name);
    if (!built.ok) {
      showToast(built.error);
      setPendingLeadEmail(null);
      return;
    }

    if (!db) { showToast('Firebase not available.'); return; }
    setTransferring(true);
    const previousOwnerEmail = String(activeSession?.ownerEmail || '').trim().toLowerCase();
    try {
      await db.collection('sessions').doc(activeSessionCode).update(built.update);
      patchSession(built.update);
      // If we just handed the session off, keep it on our My sessions list via
      // joinedSessions. The new lead already has it from joining.
      if (previousOwnerEmail && previousOwnerEmail === myEmail && instructorOwnerId) {
        try {
          await db.collection('instructors').doc(instructorOwnerId).set({
            joinedSessions: firebase.firestore.FieldValue.arrayUnion(activeSessionCode),
          }, { merge: true });
        } catch (joinErr) {
          console.warn('Could not keep this session on your list after transferring lead:', joinErr);
        }
      }
      setPendingLeadEmail(null);
      showToast(`${row.name} is now the lead for this session.`);
    } catch (e) {
      console.warn('Lead transfer failed:', e);
      showToast(
        e && e.code === 'permission-denied'
          ? 'Could not transfer the lead. They must join this session with Google first.'
          : 'Could not transfer the lead. Try again.',
      );
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div>
      <div id="instructor-list" style={{ marginBottom: '0.5rem' }}>
        {lead && (
          <div className="instructor-chip instructor-chip--lead">
            <span className="instructor-chip-name">{lead.name}</span>
            <span className="instructor-lead-tag">Lead</span>
          </div>
        )}
        {coInstructors.map(row => (
          <div key={row.key} className="instructor-chip">
            <span className="instructor-chip-name">{row.name}</span>
            <span className="instructor-chip-actions">
              {canTransfer && (row.canBecomeLead || isDemoMode) && (
                pendingLeadEmail === row.key ? (
                  <>
                    <button
                      type="button"
                      className="instructor-lead-btn instructor-lead-btn--confirm"
                      disabled={transferring}
                      onClick={() => makeLead(row)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="instructor-chip-remove"
                      disabled={transferring}
                      aria-label="Cancel lead transfer"
                      onClick={() => setPendingLeadEmail(null)}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="instructor-lead-btn"
                    title={`Make ${row.name} the lead. They will own this session. You stay as a co-instructor.`}
                    aria-label={`Make ${row.name} lead`}
                    disabled={transferring}
                    onClick={() => setPendingLeadEmail(row.key)}
                  >
                    Lead
                  </button>
                )
              )}
              {isOwner && pendingLeadEmail !== row.key && (
                <button
                  className="instructor-chip-remove"
                  title={`Hide ${row.name} from the roster students see. This does not revoke their access to the session.`}
                  aria-label={`Hide ${row.name} from the roster`}
                  onClick={() => hideFromRoster(row.name)}
                >
                  ×
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '0.76rem', color: 'var(--text-light)', lineHeight: 1.45, margin: 0 }}>
        Co-instructors are added automatically when they join with this session&rsquo;s code.
        {canTransfer && (
          <>
            {' '}Anyone teaching this session can press <strong>Lead</strong> on a
            joined instructor to hand them ownership (if the current lead is out).
          </>
        )}
        {isOwner && coInstructors.length > 0 && (
          <>
            {' '}The <strong>×</strong> hides a name from the roster students see. It does not
            revoke access &mdash; that has to be done by an admin.
          </>
        )}
      </p>
    </div>
  );
}
