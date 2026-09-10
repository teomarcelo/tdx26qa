/**
 * Production load test for Session Q&A.
 *
 * Isolated rooms only (SQA-HTA2..SQA-HTA9). Does not join real workshop codes.
 * Seeds sessions via the Cloud Firestore API (project-owner token), then drives
 * student traffic as 400 separate Firebase clients under security rules
 * (join read, page-0 listeners, question writes, upvotes, count() stats, corpus).
 *
 * Auth: workshop students use anonymous sign-in. A burst of anonymous signUp
 * from one IP is rate-limited (~100, auth/too-many-requests). This harness
 * mints Firebase custom tokens with a throwaway service-account key and
 * signInWithCustomToken, so each client still has a unique auth.uid and
 * writes are still ruled. Email/password is not enabled on this project.
 *
 * Required: LOADTEST_SA_KEY=/path/to/service-account.json
 *
 * Usage:
 *   LOADTEST_SA_KEY=/tmp/session-qa-loadtest.json node scripts/prod-load-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCM_fXpm_F2a4-h04m18UPy472UmDaa8OE',
  authDomain: 'tdx-qa.firebaseapp.com',
  projectId: 'tdx-qa',
  storageBucket: 'tdx-qa.firebasestorage.app',
  messagingSenderId: '964102376485',
  appId: '1:964102376485:web:bfa3d741284a1ef20f03cc',
};

const PROJECT = 'tdx-qa';
const ROOMS = ['SQA-HTA2', 'SQA-HTA3', 'SQA-HTA4', 'SQA-HTA5', 'SQA-HTA6', 'SQA-HTA7', 'SQA-HTA8', 'SQA-HTA9'];
const STUDENTS_PER_ROOM = Number(process.env.LOADTEST_STUDENTS || 50);
const SMOKE_STUDENTS = 3;
const SUSTAIN_MS = Number(process.env.LOADTEST_SUSTAIN_MS || 90_000);
const RUN_ID = `lt-${Date.now()}`;
const PAGE_SIZE = 10;
const CORPUS_LIMIT = 301;
const SA_KEY_PATH = process.env.LOADTEST_SA_KEY || '';

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  rooms: ROOMS,
  studentsPerRoom: STUDENTS_PER_ROOM,
  authMethod:
    'Firebase custom tokens (service-account JWT) + signInWithCustomToken; anonymous signup from one IP is rate-limited ~100/burst',
  scenarios: [],
};

const createdUids = [];
let cachedToken = { value: '', exp: 0 };
let serviceAccount = null;

function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
}

function summarize(name, records) {
  const ok = records.filter((r) => r.ok);
  const fail = records.filter((r) => !r.ok);
  const ms = ok.map((r) => r.ms);
  const errors = {};
  fail.forEach((r) => {
    const key = r.error || 'unknown';
    errors[key] = (errors[key] || 0) + 1;
  });
  const row = {
    name,
    attempted: records.length,
    passed: ok.length,
    failed: fail.length,
    p50ms: pct(ms, 50),
    p95ms: pct(ms, 95),
    maxMs: ms.length ? Math.max(...ms) : null,
    errors,
  };
  report.scenarios.push(row);
  console.log(
    `\n[${name}] ${row.passed}/${row.attempted} ok  p50=${row.p50ms}ms p95=${row.p95ms}ms max=${row.maxMs}ms  fails=${row.failed}`,
  );
  if (fail.length) console.log('  errors', errors);
  return row;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length) || 1;
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

async function timed(fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t0, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: `${e && e.code ? e.code + ': ' : ''}${e && e.message ? e.message : e}`.slice(0, 220) };
  }
}

async function withRetry(fn, { attempts = 8, label = 'op' } = {}) {
  let last;
  for (let a = 0; a < attempts; a++) {
    last = await timed(fn);
    if (last.ok) return last;
    const retryable = /too-many-requests|quota|resource-exhausted|429/i.test(last.error || '');
    if (!retryable || a === attempts - 1) return last;
    const wait = Math.min(30_000, 1500 * 2 ** a);
    console.log(`  retry ${label} after ${wait}ms (${last.error})`);
    await sleep(wait);
  }
  return last;
}

function gcloudToken() {
  if (Date.now() < cachedToken.exp && cachedToken.value) return cachedToken.value;
  const value = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  cachedToken = { value, exp: Date.now() + 45 * 60 * 1000 };
  return value;
}

function b64url(obj) {
  return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
}

function mintCustomToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
  };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  return `${unsigned}.${sign.sign(serviceAccount.private_key).toString('base64url')}`;
}

async function adminJson(method, urlPath, body) {
  const token = gcloudToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents${urlPath}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    throw new Error(`admin ${method} ${urlPath} ${res.status}: ${json.error?.message || text.slice(0, 300)}`);
  }
  return json;
}

async function identityJson(urlPath, body) {
  const token = gcloudToken();
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}${urlPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    throw new Error(`identity ${urlPath} ${res.status}: ${json.error?.message || text.slice(0, 300)}`);
  }
  return json;
}

function sessionFields(code, index) {
  return {
    fields: {
      sessionName: { stringValue: `LOADTEST room ${index + 1} [${RUN_ID}] DELETE` },
      ownerEmail: { stringValue: 'tmarcelo@salesforce.com' },
      instructorEmails: { arrayValue: { values: [{ stringValue: 'tmarcelo@salesforce.com' }] } },
      ownerId: { stringValue: 'tmarcelo_salesforce_com' },
      ownerName: { stringValue: 'Load Test Lead' },
      instructors: { arrayValue: { values: [{ stringValue: 'Load Test Lead' }] } },
      instructorNames: { stringValue: 'Load Test Lead' },
      loadTest: { booleanValue: true },
      loadTestRunId: { stringValue: RUN_ID },
      description: { stringValue: 'Synthetic load test room. Safe to delete.' },
      room: { stringValue: `Load hall ${index + 1}` },
      sessionDate: { stringValue: '' },
      sessionTime: { stringValue: '' },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  };
}

async function seedRooms() {
  const records = [];
  for (let i = 0; i < ROOMS.length; i++) {
    const code = ROOMS[i];
    records.push(await timed(() => adminJson('PATCH', `/sessions/${code}`, sessionFields(code, i))));
  }
  summarize('S0 seed 8 isolated load-test sessions (admin API)', records);
}

async function makeStudent(slot) {
  const uid = `${RUN_ID}-${slot.i}`;
  const app = initializeApp(FIREBASE_CONFIG, `lt-${RUN_ID}-${slot.i}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const signed = await signInWithCustomToken(auth, mintCustomToken(uid));
  createdUids.push(signed.user.uid);
  return {
    i: slot.i,
    room: slot.room,
    app,
    auth,
    db,
    uid: signed.user.uid,
    unsub: null,
    questionIds: [],
  };
}

async function closeStudent(s) {
  try { if (typeof s.unsub === 'function') s.unsub(); } catch { /* ignore */ }
  try { await deleteApp(s.app); } catch { /* ignore */ }
}

async function createQuestion(student, text) {
  const ref = doc(collection(student.db, 'sessions', student.room, 'questions'));
  await setDoc(ref, {
    text,
    authorName: `Load Student ${student.i}`,
    authorEmail: '',
    authorId: `load-${student.i}`,
    authorUid: student.uid,
    createdAt: serverTimestamp(),
    status: 'pending',
    pinned: false,
    votes: 0,
    voters: [],
    answer: '',
  });
  student.questionIds.push(ref.id);
  return ref.id;
}

async function listQuestionIds(student, n) {
  const q = query(
    collection(student.db, 'sessions', student.room, 'questions'),
    orderBy('createdAt', 'desc'),
    limit(n),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.id);
}

async function cleanupAuthUsers() {
  const ids = [...new Set(createdUids.filter(Boolean))];
  const records = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    records.push(await timed(() => identityJson('/accounts:batchDelete', { localIds: chunk, force: true })));
  }
  summarize('S11 cleanup Auth users', records.length ? records : [{ ok: true, ms: 0 }]);
}

async function cleanupRooms() {
  const records = [];
  for (const code of ROOMS) {
    records.push(await timed(async () => {
      let pageToken = '';
      for (let guard = 0; guard < 50; guard++) {
        const qs = pageToken ? `pageToken=${encodeURIComponent(pageToken)}&pageSize=100` : 'pageSize=100';
        const token = gcloudToken();
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/sessions/${code}/questions?${qs}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 404) return;
          throw new Error(`list questions ${code} ${res.status}: ${json.error?.message || ''}`);
        }
        for (const docSnap of json.documents || []) {
          const name = docSnap.name;
          await fetch(`https://firestore.googleapis.com/v1/${name}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
        if (!json.nextPageToken) break;
        pageToken = json.nextPageToken;
      }
      await adminJson('DELETE', `/sessions/${code}`);
    }));
  }
  summarize('S10 cleanup load-test sessions + questions', records);
}

async function runWave(label, students, concurrency, fn) {
  const records = await mapPool(students, concurrency, fn);
  summarize(label, records);
  return records;
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  report.createdAuthUsers = createdUids.length;
  const out = `/tmp/session-qa-loadtest-${RUN_ID}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${out}`);
  console.log('\n======== SCENARIO SCOREBOARD ========');
  for (const s of report.scenarios) {
    console.log(`${s.failed === 0 ? 'PASS' : 'FAIL'}  ${s.name}: ${s.passed}/${s.attempted}  p95=${s.p95ms}ms`);
  }
  return out;
}

async function main() {
  if (!SA_KEY_PATH) {
    throw new Error('Set LOADTEST_SA_KEY to a service-account JSON path (not committed).');
  }
  serviceAccount = JSON.parse(readFileSync(SA_KEY_PATH, 'utf8'));
  if (!serviceAccount.private_key || !serviceAccount.client_email) {
    throw new Error('LOADTEST_SA_KEY is not a service-account JSON file.');
  }

  const target = ROOMS.length * STUDENTS_PER_ROOM;
  console.log(`Load test ${RUN_ID}`);
  console.log(`Rooms: ${ROOMS.join(', ')}`);
  console.log(`Target: ${ROOMS.length} rooms × ${STUDENTS_PER_ROOM} students = ${target} concurrent fake students`);
  console.log('These codes are synthetic. Real workshop sessions are not used.\n');

  await seedRooms();

  const slots = [];
  ROOMS.forEach((room, ri) => {
    for (let k = 0; k < STUDENTS_PER_ROOM; k++) {
      slots.push({ i: ri * STUDENTS_PER_ROOM + k, room });
    }
  });

  console.log('\n=== S1 smoke (1 room × 3 students) ===');
  const smokeSlots = slots.slice(0, SMOKE_STUDENTS);
  const smoke = [];
  for (const slot of smokeSlots) {
    smoke.push(await withRetry(() => makeStudent(slot), { label: `smoke sign-in ${slot.i}` }));
  }
  summarize('S1a custom-token sign-in (smoke)', smoke);
  if (smoke.some((r) => !r.ok)) {
    throw new Error('Smoke auth failed; aborting before the full wave.');
  }
  const smokeStudents = smoke.map((r) => r.value);
  const smokeListen = await runWave('S1b attach page-0 listener (smoke)', smokeStudents, 3, async (s) =>
    timed(() => new Promise((resolve, reject) => {
      const q = query(
        collection(s.db, 'sessions', s.room, 'questions'),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );
      const t = setTimeout(() => reject(new Error('listener timeout 15s')), 15_000);
      s.unsub = onSnapshot(q, () => { clearTimeout(t); resolve(true); }, reject);
    })),
  );
  const smokePost = await runWave('S1c post one question (smoke)', smokeStudents, 3, (s) =>
    timed(() => createQuestion(s, `smoke ${RUN_ID} from ${s.i}`)),
  );
  await Promise.all(smokeStudents.map(closeStudent));
  if ([...smokeListen, ...smokePost].some((r) => !r.ok)) {
    throw new Error('Smoke traffic failed; aborting before 400 students.');
  }
  console.log('Smoke passed. Ramping to 8 × 50.\n');

  console.log(`=== S2 sign-in wave (${slots.length}) ===`);
  const authRecords = await mapPool(slots, 10, (slot) =>
    withRetry(() => makeStudent(slot), { label: `sign-in ${slot.i}` }),
  );
  summarize('S2 custom-token sign-in (400)', authRecords);
  const students = authRecords.filter((r) => r.ok).map((r) => r.value);
  if (students.length < slots.length * 0.9) {
    throw new Error(`Auth wave too weak (${students.length}/${slots.length}); stopping.`);
  }

  console.log('=== S3 join read (session document) ===');
  await runWave('S3 GET session doc (join)', students, 40, (s) =>
    timed(async () => {
      const snap = await getDoc(doc(s.db, 'sessions', s.room));
      if (!snap.exists()) throw new Error('session missing');
      return true;
    }),
  );

  console.log('=== S4 live listeners (newest 10 questions, like the student board) ===');
  await runWave('S4 onSnapshot page 0 (400 listeners)', students, 40, (s) =>
    timed(() => new Promise((resolve, reject) => {
      const q = query(
        collection(s.db, 'sessions', s.room, 'questions'),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );
      const t = setTimeout(() => reject(new Error('listener timeout 20s')), 20_000);
      s.unsub = onSnapshot(
        q,
        () => { clearTimeout(t); resolve(true); },
        (err) => { clearTimeout(t); reject(err); },
      );
    })),
  );

  console.log('=== S5 question burst (1 post per student) ===');
  await runWave('S5 post question (400 writes)', students, 20, (s) =>
    timed(() => createQuestion(s, `[${RUN_ID}] How does routing work in room ${s.room}? (${s.i})`)),
  );

  console.log('=== S6 upvote storm (each student votes on up to 3 newest questions) ===');
  await runWave('S6 upvote newest questions', students, 12, (s) =>
    timed(async () => {
      const ids = await listQuestionIds(s, 10);
      const targets = ids.filter((id) => !s.questionIds.includes(id)).slice(0, 3);
      if (!targets.length) return 0;
      let n = 0;
      for (const id of targets) {
        try {
          await updateDoc(doc(s.db, 'sessions', s.room, 'questions', id), {
            votes: increment(1),
            voters: arrayUnion(s.uid),
          });
          n += 1;
        } catch (e) {
          if (!String(e.code || '').includes('permission') && !String(e.message || '').includes('already')) {
            throw e;
          }
        }
      }
      return n;
    }),
  );

  console.log('=== S7 stats tick (3 count() queries per visible student tab) ===');
  await runWave('S7 stats count() × 3 per student', students, 20, (s) =>
    timed(async () => {
      const base = collection(s.db, 'sessions', s.room, 'questions');
      await Promise.all([
        getCountFromServer(base),
        getCountFromServer(query(base, where('status', '==', 'answered'))),
        getCountFromServer(query(base, where('pinned', '==', true))),
      ]);
      return true;
    }),
  );

  const searchers = students.filter((_, idx) => idx % 5 === 0);
  console.log(`=== S8 corpus fetch (${searchers.length} students, newest ${CORPUS_LIMIT}) ===`);
  await runWave('S8 search/filter corpus fetch', searchers, 15, (s) =>
    timed(async () => {
      const q = query(
        collection(s.db, 'sessions', s.room, 'questions'),
        orderBy('createdAt', 'desc'),
        limit(CORPUS_LIMIT),
      );
      const snap = await getDocs(q);
      return snap.size;
    }),
  );

  console.log(`=== S9 sustain ${SUSTAIN_MS / 1000}s with trickle questions (listeners stay up) ===`);
  const trickle = [];
  const trickleStarted = Date.now();
  while (Date.now() - trickleStarted < SUSTAIN_MS) {
    const room = ROOMS[trickle.length % ROOMS.length];
    const poster = students.find((s) => s.room === room);
    trickle.push(await timed(() => createQuestion(poster, `[${RUN_ID}] trickle ${trickle.length}`)));
    await sleep(2000);
  }
  summarize(`S9 trickle questions for ${SUSTAIN_MS / 1000}s`, trickle);

  report.connectedStudents = students.length;

  console.log('\n=== closing 400 clients ===');
  await mapPool(students, 40, closeStudent);

  console.log('\n=== cleanup ===');
  await cleanupRooms();
  await cleanupAuthUsers();

  writeReport();
  const failed = report.scenarios.filter((s) => s.failed > 0);
  if (failed.length) {
    console.log(`\n${failed.length} scenario(s) had errors (see above).`);
    process.exitCode = 1;
  } else {
    console.log('\nAll load-test scenarios completed without recorded failures.');
  }
}

main().catch(async (e) => {
  console.error('\nLoad test aborted:', e);
  try { await cleanupRooms(); } catch (err) { console.error('cleanup rooms failed', err); }
  try { await cleanupAuthUsers(); } catch (err) { console.error('cleanup auth failed', err); }
  try { writeReport(); } catch { /* ignore */ }
  process.exit(1);
});
