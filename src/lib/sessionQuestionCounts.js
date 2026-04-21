import { getApp } from 'firebase/app';
import {
  collection,
  getCountFromServer,
  getFirestore,
  query,
  where,
} from 'firebase/firestore';

/**
 * Session-wide question counts via Firestore aggregate queries (not limited to loaded pages).
 * Pending = total − answered (treats missing or non-answered status like the instructor UI).
 */
export async function fetchSessionQuestionCountStats(sessionCode) {
  if (!sessionCode) throw new Error('missing session code');
  const app = getApp();
  const fs = getFirestore(app);
  const base = collection(fs, 'sessions', sessionCode, 'questions');
  const [totalSnap, answeredSnap, pinnedSnap] = await Promise.all([
    getCountFromServer(base),
    getCountFromServer(query(base, where('status', '==', 'answered'))),
    getCountFromServer(query(base, where('pinned', '==', true))),
  ]);
  const total = totalSnap.data().count;
  const answered = answeredSnap.data().count;
  const pinned = pinnedSnap.data().count;
  const pending = Math.max(0, total - answered);
  return { total, answered, pending, pinned };
}
