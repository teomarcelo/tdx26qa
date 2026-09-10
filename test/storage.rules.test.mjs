/**
 * Cloud Storage security-rules unit tests (run on the Storage emulator).
 *
 * How to run:
 *   npm run test:rules
 * which starts the Firestore + Storage emulators, runs every test/*.mjs file,
 * and shuts the emulators down again. Nothing touches a real project.
 *
 * Coverage:
 *   - anonymous / unauthenticated uploads are DENIED on every session path
 *   - signed-in students may upload question images only
 *   - answer images and instructor note images require a verified salesforce user
 *   - non-JPEG and oversized uploads stay denied
 *   - paths outside sessions/ stay denied
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(__dirname, '..', 'storage.rules'), 'utf8');

let testEnv;

const SF_EMAIL = 'teacher@salesforce.com';

function salesforce(uid = 'inst1', email = SF_EMAIL) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).storage();
}
function nonSalesforce(uid = 'ext1', email = 'someone@gmail.com') {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).storage();
}
/** Anonymous student: signed in, no email claim on the token. */
function anon(uid = 'stud1') {
  return testEnv.authenticatedContext(uid).storage();
}
function unauthed() {
  return testEnv.unauthenticatedContext().storage();
}

const JPEG = { contentType: 'image/jpeg' };
/** Small stand-in payload; the rules only inspect size + contentType. */
function bytes(n = 16) {
  return new Uint8Array(n).fill(1);
}

function put(storage, path, data = bytes(), metadata = JPEG) {
  return storage.ref(path).put(data, metadata);
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-session-qa',
    storage: { rules: RULES },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test('question images: unauthenticated upload is denied', async () => {
  await assertFails(put(unauthed(), 'sessions/SQA-AAAA/question_paste/x.jpg'));
});

test('question images: signed-in student may upload', async () => {
  await assertSucceeds(put(anon('stud1'), 'sessions/SQA-AAAA/question_paste/ok.jpg'));
});

test('question images: non-JPEG is denied even when signed in', async () => {
  await assertFails(
    put(anon('stud1'), 'sessions/SQA-AAAA/question_paste/x.png', bytes(), {
      contentType: 'image/png',
    }),
  );
});

test('question images: oversized upload is denied', async () => {
  // 8 MB + 1 byte
  await assertFails(
    put(anon('stud1'), 'sessions/SQA-AAAA/question_paste/big.jpg', bytes(8 * 1024 * 1024 + 1)),
  );
});

test('answer images: unauthenticated and student uploads are denied', async () => {
  await assertFails(put(unauthed(), 'sessions/SQA-AAAA/answer_paste/x.jpg'));
  await assertFails(put(anon('stud1'), 'sessions/SQA-AAAA/answer_paste/x.jpg'));
});

test('answer images: non-salesforce signed-in user is denied', async () => {
  await assertFails(put(nonSalesforce(), 'sessions/SQA-AAAA/answer_paste/x.jpg'));
});

test('answer images: verified salesforce instructor may upload', async () => {
  await assertSucceeds(put(salesforce(), 'sessions/SQA-AAAA/answer_paste/ok.jpg'));
});

test('note images: only a verified salesforce instructor may upload', async () => {
  await assertFails(put(unauthed(), 'sessions/SQA-AAAA/images/x.jpg'));
  await assertFails(put(anon('stud1'), 'sessions/SQA-AAAA/images/x.jpg'));
  await assertFails(put(nonSalesforce(), 'sessions/SQA-AAAA/images/x.jpg'));
  await assertSucceeds(put(salesforce(), 'sessions/SQA-AAAA/images/ok.jpg'));
});

test('unverified salesforce email is denied (email_verified must be true)', async () => {
  const unverified = testEnv
    .authenticatedContext('inst9', { email: SF_EMAIL, email_verified: false })
    .storage();
  await assertFails(put(unverified, 'sessions/SQA-AAAA/answer_paste/x.jpg'));
});

test('paths outside sessions/ remain denied for everyone', async () => {
  await assertFails(put(salesforce(), 'random/evil.jpg'));
  await assertFails(put(anon('stud1'), 'random/evil.jpg'));
});

test('images remain publicly readable (students load them without a login)', async () => {
  await assertSucceeds(put(salesforce(), 'sessions/SQA-READ/images/note.jpg'));
  await assertSucceeds(unauthed().ref('sessions/SQA-READ/images/note.jpg').getDownloadURL());
});

test('instructor-only paths deny anonymous callers without an evaluation error', async () => {
  // Anonymous students carry no `email_verified` / `email` claim. Reading those
  // claims by property access raised `EvaluationException: Property
  // email_verified is undefined on object` on every anonymous upload: the
  // request was denied by an evaluation error rather than a clean false, which
  // is one refactor away from behaving differently. isSalesforce() now reads
  // both claims via token.get(..., default), matching firestore.rules.
  await assertFails(put(anon('stud1'), 'sessions/SQA-CLAIM/answer_paste/x.jpg'));
  await assertFails(put(anon('stud1'), 'sessions/SQA-CLAIM/images/x.jpg'));
  // A signed-in caller with an email but no email_verified claim at all.
  const noVerifiedClaim = testEnv
    .authenticatedContext('inst8', { email: SF_EMAIL })
    .storage();
  await assertFails(put(noVerifiedClaim, 'sessions/SQA-CLAIM/answer_paste/x.jpg'));
  // The happy path is unchanged.
  await assertSucceeds(put(salesforce(), 'sessions/SQA-CLAIM/answer_paste/ok.jpg'));
});

// Keep node:test from reporting "no assertions" if the rules file fails to load.
assert.ok(RULES.includes('service firebase.storage'));
