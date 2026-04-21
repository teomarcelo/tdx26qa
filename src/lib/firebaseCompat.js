/**
 * Single Firebase compat entry for the whole app (must match the `firebase` npm
 * package used by `sessionQuestionCounts.js` so modular `getApp()` / `getFirestore()`
 * see the same default app as `firebase.firestore()` from compat).
 */
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import { FIREBASE_CONFIG } from '../config/firebase.js';

const configReady = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
if (configReady && !firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

export default firebase;
