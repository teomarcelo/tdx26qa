/**
 * Firestore security-rules unit tests (run on the Firestore emulator).
 *
 * How to run:
 *   npm run test:rules
 * which wraps this file in `firebase emulators:exec --only firestore ...`, so the
 * emulator is started, tests run against it, and it shuts down automatically.
 * Requires the Firebase Local Emulator Suite (Java 11+). No production project is
 * touched — everything runs against a throwaway `demo-*` project id.
 *
 * Coverage (matches the QA plan):
 *   - salesforce-email instructor write ALLOWED (session create/update, question
 *     answer + delete)
 *   - non-salesforce email DENIED
 *   - anonymous student question create allowed ONLY when authorUid == uid
 *   - upvotes allowed for any signed-in user; deletes restricted to instructors
 *   - legacy docs (no ownerEmail / no authorUid) tolerated
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
const RULES = readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8');

let testEnv;

// --- Identity fixtures ---
const SF_EMAIL = 'teacher@salesforce.com';
const SF2_EMAIL = 'coteacher@salesforce.com';

function salesforce(uid = 'inst1', email = SF_EMAIL) {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}
function nonSalesforce(uid = 'ext1', email = 'someone@gmail.com') {
  return testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();
}
function anon(uid = 'stud1') {
  // Anonymous student: signed in, no email on the token.
  return testEnv.authenticatedContext(uid).firestore();
}
function unauthed() {
  return testEnv.unauthenticatedContext().firestore();
}

function validQuestion(authorUid, over = {}) {
  return {
    text: 'How does Agentforce routing work?',
    authorName: 'Student',
    authorEmail: '',
    authorId: 'local-abc',
    authorUid,
    createdAt: Date.now(),
    status: 'pending',
    pinned: false,
    votes: 0,
    voters: [],
    answer: '',
    ...over,
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-session-qa',
    firestore: { rules: RULES },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test('sessions: salesforce instructor can create a session they own', async () => {
  await testEnv.clearFirestore();
  const db = salesforce();
  await assertSucceeds(
    db.collection('sessions').doc('SQA-AAAA').set({
      sessionName: 'Track A',
      ownerEmail: SF_EMAIL,
      instructorEmails: [SF_EMAIL],
    }),
  );
});

test('sessions: non-salesforce email cannot create a session', async () => {
  await testEnv.clearFirestore();
  const db = nonSalesforce();
  await assertFails(
    db.collection('sessions').doc('SQA-BBBB').set({
      sessionName: 'Track B',
      ownerEmail: 'someone@gmail.com',
      instructorEmails: ['someone@gmail.com'],
    }),
  );
});

test('sessions: create denied when ownerEmail does not match the caller', async () => {
  await testEnv.clearFirestore();
  const db = salesforce();
  await assertFails(
    db.collection('sessions').doc('SQA-CCCC').set({
      sessionName: 'Spoofed owner',
      ownerEmail: SF2_EMAIL, // not the caller's email
      instructorEmails: [SF2_EMAIL],
    }),
  );
});

test('sessions: owner can update, co-instructor can update, outsider cannot', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-DDDD').set({
      sessionName: 'Owned',
      ownerEmail: SF_EMAIL,
      instructorEmails: [SF_EMAIL, SF2_EMAIL],
    });
  });
  await assertSucceeds(salesforce('inst1', SF_EMAIL).collection('sessions').doc('SQA-DDDD').update({ room: 'Hall D' }));
  await assertSucceeds(salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-DDDD').update({ room: 'Hall E' }));
  await assertFails(salesforce('inst3', 'stranger@salesforce.com').collection('sessions').doc('SQA-DDDD').update({ room: 'Hall Z' }));
});

test('sessions: legacy doc without ownerEmail is tolerated for salesforce updates', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-LEGA').set({
      sessionName: 'Legacy session',
      ownerId: 'some_name', // pre-migration shape, no ownerEmail
    });
  });
  await assertSucceeds(salesforce().collection('sessions').doc('SQA-LEGA').update({ room: 'Room 1' }));
  await assertFails(nonSalesforce().collection('sessions').doc('SQA-LEGA').update({ room: 'Room 2' }));
});

test('sessions: salesforce instructor can self-join a session as co-instructor', async () => {
  await testEnv.clearFirestore();
  const { arrayUnion } = await loadFieldValue();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-JOIN').set({
      sessionName: 'Joinable',
      ownerEmail: SF_EMAIL,
      instructorEmails: [SF_EMAIL],
    });
  });
  // A different salesforce instructor appends themselves.
  await assertSucceeds(
    salesforce('inst2', SF2_EMAIL)
      .collection('sessions')
      .doc('SQA-JOIN')
      .update({ instructorEmails: arrayUnion(SF2_EMAIL) }),
  );
});

test('questions: signed-in student can create when authorUid matches uid', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q1');
  const db = anon('stud1');
  await assertSucceeds(
    db.collection('sessions').doc('SQA-Q1').collection('questions').add(validQuestion('stud1')),
  );
});

test('questions: create denied when authorUid != uid (spoofing)', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q2');
  const db = anon('stud1');
  await assertFails(
    db.collection('sessions').doc('SQA-Q2').collection('questions').add(validQuestion('someone-else')),
  );
});

test('questions: unauthenticated cannot create a question', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q3');
  const db = unauthed();
  await assertFails(
    db.collection('sessions').doc('SQA-Q3').collection('questions').add(validQuestion('anon')),
  );
});

test('questions: create denied when arriving pre-voted / pre-pinned', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q4');
  const db = anon('stud1');
  await assertFails(
    db.collection('sessions').doc('SQA-Q4').collection('questions').add(validQuestion('stud1', { votes: 5 })),
  );
  await assertFails(
    db.collection('sessions').doc('SQA-Q4').collection('questions').add(validQuestion('stud1', { pinned: true })),
  );
});

test('questions: any signed-in user may upvote (votes/voters only)', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q5');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-Q5').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  const db = anon('voter1');
  await assertSucceeds(
    db.collection('sessions').doc('SQA-Q5').collection('questions').doc('q1')
      .update({ votes: 1, voters: ['voter1'] }),
  );
  // Changing a non-vote field via the vote path is denied.
  await assertFails(
    db.collection('sessions').doc('SQA-Q5').collection('questions').doc('q1')
      .update({ votes: 2, voters: ['voter1'], status: 'answered' }),
  );
});

test('questions: author can edit own text; instructor can answer', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q6');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-Q6').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  // Author edits their own text.
  await assertSucceeds(
    anon('author-uid').collection('sessions').doc('SQA-Q6').collection('questions').doc('q1')
      .update({ text: 'edited text' }),
  );
  // A different student cannot edit the text.
  await assertFails(
    anon('other-uid').collection('sessions').doc('SQA-Q6').collection('questions').doc('q1')
      .update({ text: 'hijacked' }),
  );
  // Salesforce instructor answers (multi-field update).
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-Q6').collection('questions').doc('q1')
      .update({ status: 'answered', answer: 'Here you go', pinned: true }),
  );
});

test('questions: author can add, replace, and clear imageUrls', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q6I');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-Q6I').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  const ref = questionRef(anon('author-uid'), 'SQA-Q6I');
  await assertSucceeds(ref.update({ imageUrls: ['https://example.com/a.jpg'] }));
  await assertSucceeds(ref.update({
    text: 'edited with photo',
    imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  }));
  await assertSucceeds(ref.update({ imageUrls: [] }));
  await assertFails(ref.update({ imageUrls: Array(11).fill('https://example.com/x.jpg') }));
  await assertFails(ref.update({ imageUrls: 'https://example.com/not-a-list.jpg' }));
  await assertFails(ref.update({ imageUrls: ['https://example.com/a.jpg'], status: 'answered' }));
  await assertFails(
    questionRef(anon('other-uid'), 'SQA-Q6I').update({ imageUrls: ['https://example.com/hack.jpg'] }),
  );
});

test('questions: only salesforce instructors can delete', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-Q7');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-Q7').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  await assertFails(anon('author-uid').collection('sessions').doc('SQA-Q7').collection('questions').doc('q1').delete());
  await assertFails(nonSalesforce().collection('sessions').doc('SQA-Q7').collection('questions').doc('q1').delete());
  await assertSucceeds(salesforce().collection('sessions').doc('SQA-Q7').collection('questions').doc('q1').delete());
});

test('feedback: signed-in create allowed with exact shape; extra field denied', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-F1');
  const db = anon('stud1');
  await assertSucceeds(
    db.collection('sessions').doc('SQA-F1').collection('sessionFeedback').add({
      subject: 'Great class', body: 'Loved it', submittedAtMs: Date.now(),
    }),
  );
  // Extra key breaks the exact-shape rule.
  await assertFails(
    db.collection('sessions').doc('SQA-F1').collection('sessionFeedback').add({
      subject: 'x', body: 'y', submittedAtMs: Date.now(), authorUid: 'stud1',
    }),
  );
});

test('feedback: only salesforce instructors can read feedback', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-F2');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-F2').collection('sessionFeedback').doc('f1')
      .set({ subject: 's', body: 'b', submittedAtMs: Date.now() });
  });
  await assertSucceeds(salesforce().collection('sessions').doc('SQA-F2').collection('sessionFeedback').doc('f1').get());
  await assertFails(anon('stud1').collection('sessions').doc('SQA-F2').collection('sessionFeedback').doc('f1').get());
});

// ─────────────────────────────────────────────────────────────────────────────
// Session takeover via the co-instructor "join" path.
// A verified salesforce identity is a large trust boundary (every employee), so
// self-joining must not double as a way to edit or seize someone else's session.
// ─────────────────────────────────────────────────────────────────────────────

/** Session owned by SF_EMAIL with SF2_EMAIL already on the roster. */
async function seedOwnedSession(code) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc(code).set({
      sessionName: 'Owned',
      ownerEmail: SF_EMAIL,
      instructorEmails: [SF_EMAIL, SF2_EMAIL],
      instructors: ['Teacher', 'Coteacher'],
      instructorNames: 'Teacher, Coteacher',
    });
  });
}

const MALLORY = 'mallory@salesforce.com';

test('sessions: self-join cannot smuggle content edits into the same write', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-HJ1');
  const { arrayUnion } = await loadFieldValue();
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ1').update({
      instructorEmails: arrayUnion(MALLORY),
      sessionName: 'Hijacked',
    }),
  );
});

test('sessions: self-join cannot delete ownerEmail (legacy-doc escalation)', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-HJ2');
  const { deleteField } = await loadFieldValue();
  // Dropping ownerEmail would demote the session to a "legacy" doc, which
  // legacySession() then lets ANY salesforce user rewrite or delete.
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ2').update({
      instructorEmails: [MALLORY],
      ownerEmail: deleteField(),
    }),
  );
});

test('sessions: self-join cannot drop existing instructors from the roster', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-HJ3');
  // Replacing (rather than appending to) instructorEmails evicts the owner and
  // co-instructor from the allow-list.
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ3').update({
      instructorEmails: [MALLORY],
    }),
  );
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ3').update({
      instructorEmails: [SF_EMAIL, SF2_EMAIL, MALLORY],
      instructors: ['Mallory'],
      instructorNames: 'Mallory',
    }),
  );
});

test('sessions: self-join cannot add someone other than the caller', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-HJ4');
  const { arrayUnion } = await loadFieldValue();
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ4').update({
      instructorEmails: arrayUnion(MALLORY, 'accomplice@salesforce.com'),
    }),
  );
});

test('sessions: the real join flow (roster + email append) still works', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-HJ5');
  const { arrayUnion } = await loadFieldValue();
  // Exactly what JoinSessionModal writes: append the display name to the roster
  // and the verified email to the allow-list, in one update.
  await assertSucceeds(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ5').update({
      instructors: ['Teacher', 'Coteacher', 'Mallory'],
      instructorNames: 'Teacher, Coteacher, Mallory',
      instructorEmails: arrayUnion(MALLORY),
    }),
  );
  // ...and once joined, they are a co-instructor with normal edit rights.
  await assertSucceeds(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-HJ5').update({ room: 'Hall F' }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Instructor accounts: display name + PIN hash + joined-session lists.
// ─────────────────────────────────────────────────────────────────────────────

/** Doc id the app derives from a verified email (see emailToId in the client). */
const SF_DOC_ID = 'teacher_salesforce_com';

async function seedInstructorDoc(id = SF_DOC_ID) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('instructors').doc(id).set({
      displayName: 'Teacher',
      pinHash: 'deadbeef',
      joinedSessions: [],
      sessionsHiddenFromList: [],
    });
  });
}

test('instructors: unauthenticated read is denied (PIN hashes are not public)', async () => {
  await testEnv.clearFirestore();
  await seedInstructorDoc();
  await assertFails(unauthed().collection('instructors').doc(SF_DOC_ID).get());
  await assertFails(anon('stud1').collection('instructors').doc(SF_DOC_ID).get());
});

test('instructors: a verified salesforce instructor can read', async () => {
  await testEnv.clearFirestore();
  await seedInstructorDoc();
  await assertSucceeds(salesforce().collection('instructors').doc(SF_DOC_ID).get());
});

test('instructors: cannot write another instructor account', async () => {
  await testEnv.clearFirestore();
  await seedInstructorDoc();
  // Overwriting someone else's pinHash / displayName must be denied.
  await assertFails(
    salesforce('mal', MALLORY).collection('instructors').doc(SF_DOC_ID).update({
      pinHash: 'attacker-controlled',
    }),
  );
  await assertFails(
    salesforce('mal', MALLORY)
      .collection('instructors')
      .doc(SF_DOC_ID)
      .set({ displayName: 'Mallory', pinHash: 'x' }, { merge: true }),
  );
});

test('instructors: can write their own email-derived account doc', async () => {
  await testEnv.clearFirestore();
  const { arrayUnion } = await loadFieldValue();
  // Create (first join) and then update, exactly as the join / hide flows do.
  await assertSucceeds(
    salesforce()
      .collection('instructors')
      .doc(SF_DOC_ID)
      .set({ joinedSessions: ['SQA-AAAA'], sessionsHiddenFromList: [] }, { merge: true }),
  );
  await assertSucceeds(
    salesforce().collection('instructors').doc(SF_DOC_ID).update({
      sessionsHiddenFromList: arrayUnion('SQA-BBBB'),
    }),
  );
});

test('instructors: dotted emails map to the same doc id the client uses', async () => {
  await testEnv.clearFirestore();
  // emailToId('first.last@salesforce.com') === 'first_last_salesforce_com', so
  // every non-alphanumeric run must collapse, not just the first one.
  const db = salesforce('inst5', 'First.Last@salesforce.com');
  await assertSucceeds(
    db.collection('instructors').doc('first_last_salesforce_com').set({ displayName: 'First' }),
  );
  await assertFails(
    db.collection('instructors').doc('first.last_salesforce_com').set({ displayName: 'First' }),
  );
});

test('instructors: deletion stays blocked', async () => {
  await testEnv.clearFirestore();
  await seedInstructorDoc();
  await assertFails(salesforce().collection('instructors').doc(SF_DOC_ID).delete());
});

// ─────────────────────────────────────────────────────────────────────────────
// Vote integrity. Anonymous identities are unlimited, so the rules cannot stop
// sockpuppets, but a single write must not be able to forge or destroy tallies.
// ─────────────────────────────────────────────────────────────────────────────

async function seedQuestion(code, { votes = 0, voters = [] } = {}) {
  await seedSession(code);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .collection('sessions')
      .doc(code)
      .collection('questions')
      .doc('q1')
      .set(validQuestion('author-uid', { votes, voters }));
  });
}

function questionRef(db, code) {
  return db.collection('sessions').doc(code).collection('questions').doc('q1');
}

test('votes: cannot inflate the counter', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V1');
  await assertFails(
    questionRef(anon('voter1'), 'SQA-V1').update({ votes: 9999, voters: ['voter1'] }),
  );
});

test('votes: cannot raise the counter without joining the voters list', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V2');
  await assertFails(questionRef(anon('voter1'), 'SQA-V2').update({ votes: 1, voters: [] }));
});

test('votes: cannot wipe or remove other people votes', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V3', { votes: 3, voters: ['a', 'b', 'c'] });
  await assertFails(questionRef(anon('mal'), 'SQA-V3').update({ votes: 0, voters: [] }));
  await assertFails(
    questionRef(anon('mal'), 'SQA-V3').update({ votes: 2, voters: ['a', 'b'] }),
  );
});

test('votes: cannot vote on behalf of another uid', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V4');
  await assertFails(
    questionRef(anon('voter1'), 'SQA-V4').update({ votes: 1, voters: ['someone-else'] }),
  );
});

test('votes: cannot double-vote', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V5', { votes: 1, voters: ['voter1'] });
  await assertFails(
    questionRef(anon('voter1'), 'SQA-V5').update({ votes: 2, voters: ['voter1', 'voter1'] }),
  );
});

test('votes: a single up-vote and un-vote by the caller succeed', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V6', { votes: 1, voters: ['other'] });
  const { arrayUnion, arrayRemove, increment } = await loadFieldValue();
  // Up-vote, written exactly the way useUpvote does.
  await assertSucceeds(
    questionRef(anon('voter1'), 'SQA-V6').update({
      votes: increment(1),
      voters: arrayUnion('voter1'),
    }),
  );
  // Un-vote.
  await assertSucceeds(
    questionRef(anon('voter1'), 'SQA-V6').update({
      votes: increment(-1),
      voters: arrayRemove('voter1'),
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Question field validation and feedback scoping.
// ─────────────────────────────────────────────────────────────────────────────

test('questions: unknown fields are rejected at creation', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-K1');
  const db = anon('stud1');
  await assertFails(
    db
      .collection('sessions')
      .doc('SQA-K1')
      .collection('questions')
      .add(validQuestion('stud1', { smuggled: 'x'.repeat(5000) })),
  );
  // The fields the client actually writes are still accepted.
  await assertSucceeds(
    db
      .collection('sessions')
      .doc('SQA-K1')
      .collection('questions')
      .add(validQuestion('stud1', { imageUrls: ['https://example.com/a.jpg'] })),
  );
});

test('questions: author edits cannot exceed the text cap', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-K2');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .collection('sessions')
      .doc('SQA-K2')
      .collection('questions')
      .doc('q1')
      .set(validQuestion('author-uid'));
  });
  const ref = questionRef(anon('author-uid'), 'SQA-K2');
  await assertFails(ref.update({ text: 'x'.repeat(10001) }));
  await assertSucceeds(ref.update({ text: 'a reasonable edit' }));
});

test('feedback: an instructor cannot read another session feedback', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-F3'); // owned by SF_EMAIL
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx
      .firestore()
      .collection('sessions')
      .doc('SQA-F3')
      .collection('sessionFeedback')
      .doc('f1')
      .set({ subject: 's', body: 'b', submittedAtMs: Date.now() });
  });
  // Owner can read; an unrelated salesforce instructor cannot.
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-F3').collection('sessionFeedback').doc('f1').get(),
  );
  await assertFails(
    salesforce('mal', MALLORY)
      .collection('sessions')
      .doc('SQA-F3')
      .collection('sessionFeedback')
      .doc('f1')
      .get(),
  );
});

test('votes: instructors keep full update rights', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V7', { votes: 2, voters: ['a', 'b'] });
  await assertSucceeds(
    questionRef(salesforce(), 'SQA-V7').update({ status: 'answered', pinned: true }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-002 — question update/delete must be scoped to the session.
// A verified salesforce identity covers every employee, so "is a salesforce
// instructor" alone is not authorization to moderate a stranger's session.
// ─────────────────────────────────────────────────────────────────────────────

test('questions: an unrelated salesforce instructor cannot update or delete', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-S2A'); // owned by SF_EMAIL, roster [SF_EMAIL]
  const strangerRef = questionRef(salesforce('mal', MALLORY), 'SQA-S2A');
  // Rewriting the question body.
  await assertFails(strangerRef.update({ text: 'rewritten by a stranger' }));
  // Forging an instructor answer + status + pin.
  await assertFails(
    strangerRef.update({ status: 'answered', answer: 'FORGED', pinned: true }),
  );
  // Destroying the question outright.
  await assertFails(strangerRef.delete());

  // An instructor OF this session keeps full rights.
  const ownerRef = questionRef(salesforce(), 'SQA-S2A');
  await assertSucceeds(ownerRef.update({ status: 'answered', answer: 'Real answer', pinned: true }));
  await assertSucceeds(ownerRef.delete());
});

test('questions: a co-instructor of the session can moderate it', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-S2B');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.collection('sessions').doc('SQA-S2B').update({
      instructorEmails: [SF_EMAIL, SF2_EMAIL],
    });
    await fs.collection('sessions').doc('SQA-S2B').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  await assertSucceeds(
    questionRef(salesforce('inst2', SF2_EMAIL), 'SQA-S2B')
      .update({ status: 'answered', answer: 'From the co-instructor' }),
  );
  await assertSucceeds(questionRef(salesforce('inst2', SF2_EMAIL), 'SQA-S2B').delete());
});

test('questions: a legacy session (no ownerEmail) stays moderatable', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await fs.collection('sessions').doc('SQA-S2C').set({ sessionName: 'Legacy', ownerId: 'x' });
    await fs.collection('sessions').doc('SQA-S2C').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  await assertSucceeds(questionRef(salesforce(), 'SQA-S2C').update({ status: 'answered' }));
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-003 — co-instructor capability is not a silent takeover.
// Self-joining is by design. Joining still must not delete the session, clear
// ownerEmail, or evict anyone else. Lead transfer is allowed only after they
// are listed, and only onto an email already on instructorEmails.
// ─────────────────────────────────────────────────────────────────────────────

test('sessions: a self-joined co-instructor cannot destroy the session before taking lead', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK1');
  const { arrayUnion, arrayRemove } = await loadFieldValue();
  const mallory = salesforce('mal', MALLORY);
  const sessionRef = mallory.collection('sessions').doc('SQA-TK1');

  await assertSucceeds(sessionRef.update({ instructorEmails: arrayUnion(MALLORY) }));

  await assertFails(sessionRef.delete());
  await assertFails(sessionRef.update({ instructorEmails: [MALLORY] }));
  await assertFails(sessionRef.update({ instructorEmails: arrayRemove(SF_EMAIL) }));
  await assertFails(sessionRef.update({ sessionName: 'x'.repeat(301) }));
  // Join still cannot smuggle a transfer into the same write as adding yourself.
  await assertFails(
    salesforce('mal2', 'other@salesforce.com').collection('sessions').doc('SQA-TK1').update({
      instructorEmails: arrayUnion('other@salesforce.com'),
      ownerEmail: 'other@salesforce.com',
      ownerName: 'Other',
      ownerId: 'other_salesforce_com',
    }),
  );

  await assertSucceeds(salesforce().collection('sessions').doc('SQA-TK1').delete());
});

test('sessions: a listed co-instructor can take lead, then delete', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK1B');
  const { arrayUnion } = await loadFieldValue();
  const mallory = salesforce('mal', MALLORY);
  const sessionRef = mallory.collection('sessions').doc('SQA-TK1B');
  await assertSucceeds(sessionRef.update({ instructorEmails: arrayUnion(MALLORY) }));
  await assertFails(sessionRef.delete());
  await assertSucceeds(sessionRef.update({
    ownerEmail: MALLORY,
    ownerName: 'Mallory',
    ownerId: 'mallory_salesforce_com',
  }));
  await assertSucceeds(sessionRef.delete());
});

test('sessions: a joined co-instructor can still answer and pin questions', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK2');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-TK2').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  const { arrayUnion } = await loadFieldValue();
  const mallory = salesforce('mal', MALLORY);
  await assertSucceeds(
    mallory.collection('sessions').doc('SQA-TK2').update({ instructorEmails: arrayUnion(MALLORY) }),
  );
  await assertSucceeds(
    questionRef(mallory, 'SQA-TK2').update({ status: 'answered', answer: 'Happy to help', pinned: true }),
  );
  // Normal session-content edits stay available to a co-instructor.
  await assertSucceeds(mallory.collection('sessions').doc('SQA-TK2').update({ room: 'Hall G' }));
});

test('sessions: a co-instructor may remove only their own email; the owner may remove others', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK3'); // roster [SF_EMAIL, SF2_EMAIL]
  const { arrayRemove } = await loadFieldValue();
  // Leaving a session you joined is allowed.
  await assertSucceeds(
    salesforce('inst2', SF2_EMAIL)
      .collection('sessions')
      .doc('SQA-TK3')
      .update({ instructorEmails: arrayRemove(SF2_EMAIL) }),
  );
  // The owner remains able to manage the allow-list.
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-TK3').update({ instructorEmails: [SF_EMAIL] }),
  );
});

test('sessions: ownerEmail can move to a listed instructor, not off-list or gone', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK4');
  const { deleteField } = await loadFieldValue();
  const owner = salesforce().collection('sessions').doc('SQA-TK4');
  await assertSucceeds(owner.update({
    ownerEmail: SF2_EMAIL,
    ownerName: 'Coteacher',
    ownerId: 'coteacher_salesforce_com',
  }));
  await assertFails(owner.update({
    ownerEmail: 'stranger@salesforce.com',
    ownerName: 'Stranger',
    ownerId: 'stranger_salesforce_com',
  }));
  await assertFails(owner.update({ ownerEmail: deleteField() }));
  await assertFails(owner.update({
    ownerEmail: 'someone@gmail.com',
    ownerName: 'Gmail',
    ownerId: 'someone_gmail_com',
  }));
  // Still listed after handing lead off, so session settings still work.
  await assertSucceeds(owner.update({ room: 'Hall H' }));
});

test('sessions: a listed instructor can pass lead to another listed instructor', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK4B');
  const { arrayUnion } = await loadFieldValue();
  const mallory = salesforce('mal', MALLORY).collection('sessions').doc('SQA-TK4B');
  await assertSucceeds(mallory.update({ instructorEmails: arrayUnion(MALLORY) }));
  await assertSucceeds(mallory.update({
    ownerEmail: SF2_EMAIL,
    ownerName: 'Coteacher',
    ownerId: 'coteacher_salesforce_com',
  }));
});

test('sessions: lead transfer cannot target an email that has not joined', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK4C');
  await assertFails(
    salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-TK4C').update({
      ownerEmail: MALLORY,
      ownerName: 'Mallory',
      ownerId: 'mallory_salesforce_com',
    }),
  );
});

test('sessions: join may write the caller\'s instructorDirectory entry', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK4D');
  const { arrayUnion } = await loadFieldValue();
  await assertSucceeds(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-TK4D').update({
      instructorEmails: arrayUnion(MALLORY),
      instructorDirectory: {
        mallory_salesforce_com: { email: MALLORY, name: 'Mallory' },
      },
    }),
  );
  await assertFails(
    salesforce('mal2', 'other@salesforce.com').collection('sessions').doc('SQA-TK4D').update({
      instructorEmails: arrayUnion('other@salesforce.com'),
      instructorDirectory: {
        accomplice_salesforce_com: { email: 'accomplice@salesforce.com', name: 'Nope' },
      },
    }),
  );
});

test('sessions: sessionName is capped on update, not just on create', async () => {
  await testEnv.clearFirestore();
  await seedOwnedSession('SQA-TK5');
  const owner = salesforce().collection('sessions').doc('SQA-TK5');
  await assertFails(owner.update({ sessionName: 'x'.repeat(301) }));
  await assertSucceeds(owner.update({ sessionName: 'Track A, renamed' }));
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-007 — `answer` must arrive empty on question create.
// The student view renders q.answer under an "Instructor" label, so a value
// written at creation time is student-authored text attributed to staff.
// ─────────────────────────────────────────────────────────────────────────────

test('questions: create denied when answer arrives non-empty', async () => {
  await testEnv.clearFirestore();
  await seedSession('SQA-A1');
  const db = anon('stud1');
  const questions = db.collection('sessions').doc('SQA-A1').collection('questions');
  await assertFails(
    questions.add(validQuestion('stud1', { answer: 'FORGED - visit http://example.com' })),
  );
  // What the shipped client actually sends must keep working.
  await assertSucceeds(questions.add(validQuestion('stud1', { answer: '' })));
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-008 — `voters` multiplicity. hasAll/hasOnly are set tests and ignore
// duplicates, so without an exact size delta one write can bloat a question
// document toward the 1MiB limit and break every later write to it.
// ─────────────────────────────────────────────────────────────────────────────

test('votes: a duplicate-padded voters array is denied', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V8');
  // 5,000 copies of the caller's own uid: every set test passes, the size does not.
  await assertFails(
    questionRef(anon('voter1'), 'SQA-V8').update({
      votes: 1,
      voters: new Array(5000).fill('voter1'),
    }),
  );
});

test('votes: padding with other people uids is denied too', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-V9', { votes: 1, voters: ['other'] });
  await assertFails(
    questionRef(anon('voter1'), 'SQA-V9').update({
      votes: 2,
      voters: ['other', 'other', 'other', 'voter1'],
    }),
  );
});

test('votes: un-voting cannot be used to pad the array either', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-VB', { votes: 2, voters: ['other', 'voter1'] });
  // Removing the caller's own uid while duplicating someone else's satisfies
  // every set test and moves `votes` by exactly -1. Only the size delta stops it.
  await assertFails(
    questionRef(anon('voter1'), 'SQA-VB').update({ votes: 1, voters: ['other', 'other'] }),
  );
});

test('votes: the real client write path still works after the size check', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-VA', { votes: 1, voters: ['other'] });
  const { arrayUnion, arrayRemove, increment } = await loadFieldValue();
  const ref = questionRef(anon('voter1'), 'SQA-VA');
  await assertSucceeds(ref.update({ votes: increment(1), voters: arrayUnion('voter1') }));
  await assertSucceeds(ref.update({ votes: increment(-1), voters: arrayRemove('voter1') }));
});

test('votes: student write paths never read the parent session doc', async () => {
  await testEnv.clearFirestore();
  // A question with NO parent session document at all. The instructor branch of
  // the question update rule now get()s the session (a billed read), so this
  // pins the guarantee that the two high-volume student paths short-circuit out
  // before that read happens: they still work with no session doc to read.
  // If a later edit hoists instructsSession() out of the isSalesforce() branch,
  // this test fails — which is the point.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-NOSESS').collection('questions').doc('q1')
      .set(validQuestion('author-uid'));
  });
  const { arrayUnion, increment } = await loadFieldValue();
  await assertSucceeds(
    questionRef(anon('voter1'), 'SQA-NOSESS').update({
      votes: increment(1),
      voters: arrayUnion('voter1'),
    }),
  );
  await assertSucceeds(
    questionRef(anon('author-uid'), 'SQA-NOSESS').update({ text: 'still editable' }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Read-path coverage. These lock in the anonymous student flow: students read a
// session and its questions with no account at all, so over-tightening reads
// would break every workshop. Feedback and instructor docs stay private.
// ─────────────────────────────────────────────────────────────────────────────

test('reads: an unauthenticated visitor can get a session and its questions', async () => {
  await testEnv.clearFirestore();
  await seedQuestion('SQA-R1');
  const db = unauthed();
  await assertSucceeds(db.collection('sessions').doc('SQA-R1').get());
  await assertSucceeds(db.collection('sessions').doc('SQA-R1').collection('questions').get());
});

test('reads: unauthenticated list of instructors and sessionFeedback stays denied', async () => {
  await testEnv.clearFirestore();
  await seedInstructorDoc();
  await seedSession('SQA-R2');
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-R2').collection('sessionFeedback').doc('f1')
      .set({ subject: 's', body: 'b', submittedAtMs: Date.now() });
  });
  const db = unauthed();
  await assertFails(db.collection('instructors').get());
  await assertFails(db.collection('sessions').doc('SQA-R2').collection('sessionFeedback').get());
});

test('reads: DOCUMENTS CURRENT STATE — unauthenticated list of all sessions succeeds', async () => {
  // NOT an assertion of desired behavior. `allow read: if true` on
  // /sessions/{sessionId} makes the whole collection listable, which exposes
  // every session code plus ownerEmail and instructorEmails to anyone.
  // Restricting it needs a product decision (the student join flow) and would
  // break scripts/backfill-owner-emails.mjs, which lists the collection. This
  // test exists so that a future tightening shows up here as a deliberate
  // change rather than a surprise.
  await testEnv.clearFirestore();
  await seedSession('SQA-R3');
  await assertSucceeds(unauthed().collection('sessions').get());
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-009 — `ownerName` is an OWNER field, not a co-instructor field.
// It renders as the "Lead" chip on every student's screen and is the byline the
// owner's notes and answers are attributed to. Co-instructor membership is
// self-service, so before this guard any verified salesforce user could
// self-join and rename the lead instructor live, mid-workshop.
// ─────────────────────────────────────────────────────────────────────────────

/** Owned session that also carries the owner label and a note roster. */
async function seedNamedSession(code) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc(code).set({
      sessionName: 'Owned',
      ownerEmail: SF_EMAIL,
      ownerId: 'teacher_salesforce_com',
      ownerName: 'Teacher',
      instructorEmails: [SF_EMAIL, SF2_EMAIL],
      instructors: ['Teacher', 'Coteacher'],
      instructorNames: 'Teacher, Coteacher',
      sessionNotes: [
        { id: 'n1', instructor: 'Teacher', title: 'Setup', body: 'Owner note' },
        { id: 'n2', instructor: 'Coteacher', title: 'Lab', body: 'Co note' },
      ],
    });
  });
}

/** Pre-migration session: no ownerEmail, so legacySession() tolerates it. */
async function seedLegacyNamedSession(code) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc(code).set({
      sessionName: 'Legacy session',
      ownerId: 'alex_kim',
      ownerName: 'Alex Kim',
      instructors: ['Alex Kim'],
      instructorNames: 'Alex Kim',
    });
  });
}

test('sessions: a co-instructor cannot write ownerName', async () => {
  await testEnv.clearFirestore();
  await seedNamedSession('SQA-ON1');
  const { deleteField } = await loadFieldValue();
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-ON1');
  // Alone...
  await assertFails(co.update({ ownerName: 'Coteacher' }));
  // ...smuggled into the rename write's shape...
  await assertFails(
    co.update({
      ownerName: 'Coteacher',
      instructors: ['Coteacher'],
      instructorNames: 'Coteacher',
      sessionNotes: [{ id: 'n1', instructor: 'Coteacher', title: 'Setup', body: 'Owner note' }],
    }),
  );
  // ...via set(merge), which is checked against create AND update...
  await assertFails(co.set({ ownerName: 'Coteacher' }, { merge: true }));
  // ...and deleting it is a write too.
  await assertFails(co.update({ ownerName: deleteField() }));
});

test('sessions: self-joining does not buy the right to rename the lead', async () => {
  await testEnv.clearFirestore();
  await seedNamedSession('SQA-ON2');
  const { arrayUnion } = await loadFieldValue();
  const mallory = salesforce('mal', MALLORY).collection('sessions').doc('SQA-ON2');
  // In the same write as the join...
  await assertFails(
    mallory.update({
      instructorEmails: arrayUnion(MALLORY),
      instructors: ['Teacher', 'Coteacher', 'Mallory'],
      instructorNames: 'Teacher, Coteacher, Mallory',
      ownerName: 'Mallory',
    }),
  );
  // ...and after joining legitimately.
  await assertSucceeds(mallory.update({ instructorEmails: arrayUnion(MALLORY) }));
  await assertFails(mallory.update({ ownerName: 'Mallory' }));
});

test('sessions: the owner can still set and change ownerName', async () => {
  await testEnv.clearFirestore();
  await seedNamedSession('SQA-ON3');
  const owner = salesforce().collection('sessions').doc('SQA-ON3');
  await assertSucceeds(owner.update({ ownerName: 'Teacher T.' }));
  // The owner's whole rename write (owner label + roster + note bylines).
  await assertSucceeds(
    owner.update({
      ownerName: 'T. Teacher',
      instructors: ['T. Teacher', 'Coteacher'],
      instructorNames: 'T. Teacher, Coteacher',
      sessionNotes: [
        { id: 'n1', instructor: 'T. Teacher', title: 'Setup', body: 'Owner note' },
        { id: 'n2', instructor: 'Coteacher', title: 'Lab', body: 'Co note' },
      ],
    }),
  );
});

test('sessions: the owner can stamp ownerName onto a doc that never had one', async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc('SQA-ON4').set({
      sessionName: 'No owner label yet',
      ownerEmail: SF_EMAIL,
      instructorEmails: [SF_EMAIL, SF2_EMAIL],
    });
  });
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-ON4').update({ ownerName: 'Teacher' }),
  );
});

test('sessions: a co-instructor keeps every legitimate write except ownerName', async () => {
  await testEnv.clearFirestore();
  await seedNamedSession('SQA-ON5');
  const { arrayRemove } = await loadFieldValue();
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-ON5');
  // Renaming ONLY themselves in the roster and on their own note bylines — the
  // write shape closest to the one now blocked.
  await assertSucceeds(
    co.update({
      instructors: ['Teacher', 'Co T.'],
      instructorNames: 'Teacher, Co T.',
      sessionNotes: [
        { id: 'n1', instructor: 'Teacher', title: 'Setup', body: 'Owner note' },
        { id: 'n2', instructor: 'Co T.', title: 'Lab', body: 'Co note' },
      ],
    }),
  );
  // Session settings.
  await assertSucceeds(
    co.update({ sessionName: 'Track A renamed', room: 'Hall D', description: 'desc' }),
  );
  // Notes editor (master toggle + array + scratch fields).
  await assertSucceeds(
    co.update({
      sessionNoteShow: false,
      sessionNoteTitle: '',
      sessionNoteBody: '',
      sessionNoteImageUrls: [],
      sessionNotes: [{ id: 'n3', instructor: 'Co T.', title: 'New', body: 'x' }],
    }),
  );
  // Hiding a name from the roster, then leaving the session.
  await assertSucceeds(co.update({ instructors: arrayRemove('Co T.'), instructorNames: 'Teacher' }));
  await assertSucceeds(co.update({ instructorEmails: arrayRemove(SF2_EMAIL) }));
});

test('sessions: a legacy doc ownerName is writable only by claiming ownership', async () => {
  await testEnv.clearFirestore();
  await seedLegacyNamedSession('SQA-ON6');
  const stranger = salesforce('mal', MALLORY).collection('sessions').doc('SQA-ON6');
  // A legacy doc has no owner, so a drive-by rewrite of the lead's name is out.
  await assertFails(stranger.update({ ownerName: 'Mallory' }));
  // Non-ownership edits stay tolerated (legacySession), as before.
  await assertSucceeds(stranger.update({ room: 'Room 1' }));
  // The repair path: stamp your OWN ownerEmail and the label in one write. This
  // is the same self-claim ownerEmailPreserved already allows, so legacy docs
  // are never stranded without a way to set a lead name.
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-ON6').update({
      ownerEmail: SF_EMAIL,
      ownerName: 'Alex K.',
    }),
  );
  // Once claimed, only that owner may move the label.
  await assertFails(stranger.update({ ownerName: 'Mallory' }));
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-ON6').update({ ownerName: 'Alex Kim' }),
  );
});

test('sessions: a legacy claim cannot stamp someone else as the owner', async () => {
  await testEnv.clearFirestore();
  await seedLegacyNamedSession('SQA-ON7');
  // Claiming on behalf of another address would let ownerName ride along under
  // an owner the caller does not control.
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-ON7').update({
      ownerEmail: SF_EMAIL,
      ownerName: 'Mallory',
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-010 — the student-facing launch links are not free-form.
// studentOrgClaimUrl and studentSurveyUrl render as BUTTONS on every attendee's
// session card. The client checks the scheme; the rules did not, so any
// verified salesforce user who self-joined could hand the whole room a
// javascript: or data: URL. These rules are the only authorization layer here
// (App Check is registered but NOT enforced), so the check belongs in both.
// ─────────────────────────────────────────────────────────────────────────────

/** Session shaped the way the shipped client actually stores one. */
async function seedLaunchSession(code) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc(code).set({
      sessionName: 'Track A',
      ownerEmail: SF_EMAIL,
      ownerId: 'teacher_salesforce_com',
      ownerName: 'Teacher',
      instructorEmails: [SF_EMAIL, SF2_EMAIL],
      instructors: ['Teacher', 'Coteacher'],
      instructorNames: 'Teacher, Coteacher',
      room: 'Hall D',
      description: 'desc',
      studentOrgClaimUrl: 'http://sfdc.co/OrgClaim',
      studentOrgClaimCopyText: 'ORG-CODE',
      studentSurveyUrl: 'https://survey.example.com/s/1',
      studentSurveyCopyText: 'SURVEY-ID',
      sessionNoteShow: true,
      sessionNoteTitle: '',
      sessionNoteBody: '',
      sessionNoteImageUrls: [],
      sessionNotes: [
        { id: 'n1', order: 0, title: 'Setup', body: 'Owner note', imageUrls: [], links: [], show: true, instructor: 'Teacher' },
      ],
    });
  });
}

/** A note in the shape SessionNotesEditor saves. */
function noteFixture(i, over = {}) {
  return {
    id: `sn_${i}`, order: i, title: `Note ${i}`, body: 'Body text.',
    imageUrls: [], links: [], show: true, instructor: 'Coteacher', ...over,
  };
}

test('sessions: a co-instructor cannot point the student buttons at any scheme', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-LK1');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-LK1');
  await assertFails(co.update({ studentOrgClaimUrl: 'javascript:alert(1)' }));
  await assertFails(co.update({ studentSurveyUrl: 'javascript:alert(document.cookie)' }));
  await assertFails(co.update({ studentSurveyUrl: 'data:text/html;base64,PHNjcmlwdD4=' }));
  await assertFails(co.update({ studentOrgClaimUrl: 'evil.example.com/phish' }));
  // A newline cannot be used to hide a bad scheme behind a good-looking line:
  // matches() is a whole-string match and `.` does not cross a newline.
  await assertFails(co.update({ studentSurveyUrl: 'javascript:alert(1)\nhttps://ok.example.com' }));
  await assertFails(co.update({ studentSurveyUrl: 'https://ok.example.com\njavascript:alert(1)' }));
  await assertFails(co.update({ studentSurveyUrl: 42 }));
});

test('sessions: launch links and their copy text are size-capped', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-LK2');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-LK2');
  await assertFails(co.update({ studentSurveyUrl: 'https://e.example/' + 'a'.repeat(60000) }));
  await assertFails(co.update({ studentOrgClaimCopyText: 'z'.repeat(200000) }));
  await assertFails(co.update({ studentSurveyCopyText: 'z'.repeat(200000) }));
});

test('sessions: a legacy doc launch link is not open season either', async () => {
  await testEnv.clearFirestore();
  await seedLegacyNamedSession('SQA-LK3');
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-LK3')
      .update({ studentOrgClaimUrl: 'javascript:alert(1)' }),
  );
});

test('sessions: the real SessionSettings save still works, URL fields and all', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-LK4');
  const { deleteField } = await loadFieldValue();
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-LK4');
  // The exact payload SessionSettings.handleSave writes, deletions included.
  await assertSucceeds(
    co.update({
      sessionName: 'Track A — Fundamentals',
      sessionDate: 'Mar 5, 2026',
      sessionTime: '9:00 AM',
      sessionTimezone: 'PT',
      room: 'Hall D — Room 214',
      description: 'What we cover today.',
      studentOrgClaimUrl: 'http://sfdc.co/OrgClaim',
      studentOrgClaimCopyText: 'ORG-1234',
      studentSurveyUrl: 'https://survey.example.com/s/abc?x=1&y=2#frag',
      studentSurveyCopyText: 'SURVEY-9',
      className: deleteField(),
      studentSurveyButtonLabel: deleteField(),
    }),
  );
  // An empty survey link is the normal state: SessionSettings stores '' when the
  // field is left blank, and only OrgClaim falls back to a default.
  await assertSucceeds(co.update({ studentSurveyUrl: '', studentSurveyCopyText: '' }));
  // Real links are not all plain ASCII, and some are long.
  await assertSucceeds(co.update({ studentSurveyUrl: 'https://xn--exmple-cua.example/enquête?ré=1' }));
  await assertSucceeds(
    co.update({ studentSurveyUrl: 'https://survey.example.com/s/abc?' + 'utm_source=sqa&'.repeat(100) }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-011 — instructor notes are bounded.
// Every card in sessionNotes renders on every student's board, and the array had
// no type, element-count or size constraint at all: one write could put hundreds
// of kilobytes on every screen in the room and drive the session document toward
// Firestore's 1 MiB ceiling, past which every later write to it fails.
//
// Byline enforcement is deliberately NOT tested, because it is deliberately not
// implemented: a note stores `instructor` as a bare display name with no link to
// an identity, so the rules cannot tell whose note is whose.
// ─────────────────────────────────────────────────────────────────────────────

test('sessions: a note body, title and byline are size-capped', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-SN1');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-SN1');
  // The originally reported shape: 20 KB of body under the lead's byline.
  await assertFails(co.update({ sessionNotes: [noteFixture(0, { body: 'x'.repeat(20 * 1024), instructor: 'Teacher' })] }));
  await assertFails(co.update({ sessionNotes: [noteFixture(0, { body: 'x'.repeat(500 * 1024) })] }));
  await assertFails(co.update({ sessionNotes: [noteFixture(0, { title: 'T'.repeat(40000) })] }));
  await assertFails(co.update({ sessionNotes: [noteFixture(0, { instructor: 'I'.repeat(5000) })] }));
  // One character over is over.
  await assertFails(co.update({ sessionNotes: [noteFixture(0, { body: 'b'.repeat(12001) })] }));
});

test('sessions: sessionNotes must be a list, and a bounded one', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-SN2');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-SN2');
  await assertFails(co.update({ sessionNotes: 'not a list' }));
  await assertFails(co.update({ sessionNotes: Array.from({ length: 400 }, (_, i) => noteFixture(i)) }));
});

test('sessions: a blob cannot hide at the end of the notes array', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-SN3');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-SN3');
  // Every checked slot is checked: the last one is not a blind spot.
  await assertFails(
    co.update({
      sessionNotes: Array.from({ length: 16 }, (_, i) =>
        i === 15 ? noteFixture(i, { body: 'x'.repeat(400 * 1024) }) : noteFixture(i)),
    }),
  );
  // And going past the cap to reach an unchecked index does not work either.
  await assertFails(
    co.update({
      sessionNotes: Array.from({ length: 17 }, (_, i) =>
        i === 16 ? noteFixture(i, { body: 'x'.repeat(400 * 1024) }) : noteFixture(i)),
    }),
  );
});

test('sessions: the pre-migration single-note fields are capped too', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-SN4');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-SN4');
  await assertFails(co.update({ sessionNoteBody: 'y'.repeat(100000) }));
  await assertFails(co.update({ sessionNoteTitle: 'y'.repeat(200000) }));
  await assertFails(co.update({ sessionNoteImageUrls: Array.from({ length: 400 }, (_, i) => `https://x.example/${i}.jpg`) }));
});

test('sessions: a legacy doc is not a way around the notes caps', async () => {
  await testEnv.clearFirestore();
  await seedLegacyNamedSession('SQA-SN5');
  await assertFails(
    salesforce('mal', MALLORY).collection('sessions').doc('SQA-SN5')
      .update({ sessionNotes: [noteFixture(0, { body: 'x'.repeat(500 * 1024) })] }),
  );
});

test('sessions: the real SessionNotesEditor save still works', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-SN6');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-SN6');
  // The exact payload the editor's transaction writes.
  await assertSucceeds(
    co.update({
      sessionNoteShow: true,
      sessionNoteTitle: '',
      sessionNoteBody: '',
      sessionNoteImageUrls: [],
      sessionNotes: [
        noteFixture(0, { title: 'Wi-Fi', body: 'SSID: guest' }),
        noteFixture(1, {
          title: 'Slides',
          imageUrls: ['https://firebasestorage.googleapis.com/v0/b/tdx-qa.firebasestorage.app/o/sessions%2FSQA-SN6%2Fimages%2Fnote_1.jpg?alt=media&token=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
          links: [{ url: 'https://example.com/deck', label: 'Slides' }],
        }),
      ],
    }),
  );
  // A genuinely long announcement must never be blocked.
  await assertSucceeds(co.update({ sessionNotes: [noteFixture(0, { body: 'A long announcement. '.repeat(400) })] }));
  await assertSucceeds(co.update({ sessionNotes: [noteFixture(0, { body: 'b'.repeat(12000) })] }));
  // The client's own cap is 15 notes; the rules allow one more so a concurrent
  // save merged by mergeSessionNotes is not rejected for arriving at 16.
  await assertSucceeds(co.update({ sessionNotes: Array.from({ length: 15 }, (_, i) => noteFixture(i)) }));
  await assertSucceeds(co.update({ sessionNotes: Array.from({ length: 16 }, (_, i) => noteFixture(i)) }));
});

test('sessions: notes of an older shape are still saveable, not stranded', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-SN7');
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-SN7');
  // A note with no title/body/instructor keys at all. buildSessionRenameUpdates
  // spreads stored notes verbatim, so a guard that demanded these keys would
  // make renaming impossible on any session holding one.
  await assertSucceeds(co.update({ sessionNotes: [{ id: 'sn_1', order: 0, show: true }] }));
  // ...and one carrying an unknown extra key.
  await assertSucceeds(
    co.update({ sessionNotes: [noteFixture(0, { legacyAuthorName: 'Old Name', pinnedByHost: true })] }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-012 — `ownerId` is an OWNER field.
// These rules never read it, so rewriting it is not a rules-level escalation.
// It is the CLIENT's entire notion of ownership though: useSessions queries
// where('ownerId', '==', …) and instructorOwnsSession() compares nothing else,
// so a co-instructor who rewrites it makes every dashboard present them as the
// lead. Guarded exactly like ownerName, in the same affectedKeys() pass.
// ─────────────────────────────────────────────────────────────────────────────

test('sessions: a co-instructor cannot write ownerId', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-OI1');
  const { deleteField } = await loadFieldValue();
  const co = salesforce('inst2', SF2_EMAIL).collection('sessions').doc('SQA-OI1');
  await assertFails(co.update({ ownerId: 'coteacher_salesforce_com' }));
  await assertFails(co.update({ ownerId: deleteField() }));
  await assertFails(co.set({ ownerId: 'coteacher_salesforce_com' }, { merge: true }));
  // Smuggled into the roster write a self-joiner is otherwise allowed to make.
  await assertFails(
    co.update({
      instructors: ['Teacher', 'Coteacher'],
      instructorNames: 'Teacher, Coteacher',
      ownerId: 'coteacher_salesforce_com',
    }),
  );
});

test('sessions: a legacy doc ownerId is writable only by claiming ownership', async () => {
  await testEnv.clearFirestore();
  await seedLegacyNamedSession('SQA-OI2');
  const stranger = salesforce('mal', MALLORY).collection('sessions').doc('SQA-OI2');
  await assertFails(stranger.update({ ownerId: 'mallory_salesforce_com' }));
  // Unrelated edits stay tolerated on a legacy doc, as before.
  await assertSucceeds(stranger.update({ room: 'Room 1' }));
  // The claim path: stamp your OWN ownerEmail in the same write.
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-OI2')
      .update({ ownerEmail: SF_EMAIL, ownerName: 'Alex K.', ownerId: 'teacher_salesforce_com' }),
  );
});

test('sessions: the owner can still repoint ownerId on a session they own', async () => {
  await testEnv.clearFirestore();
  await seedLaunchSession('SQA-OI3');
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-OI3').update({ ownerId: 'teacher_salesforce_com_v2' }),
  );
});

test('sessions: an owner claims a legacy session in ONE combined write', async () => {
  await testEnv.clearFirestore();
  await seedLegacyNamedSession('SQA-OI4');
  // ownerEmail + ownerName + roster + notes together. The client is being
  // changed to emit exactly this, so none of the new guards may block it.
  await assertSucceeds(
    salesforce().collection('sessions').doc('SQA-OI4').update({
      ownerEmail: SF_EMAIL,
      ownerName: 'Teacher',
      ownerId: 'teacher_salesforce_com',
      instructors: ['Teacher'],
      instructorNames: 'Teacher',
      instructorEmails: [SF_EMAIL],
      sessionNotes: [noteFixture(0, { instructor: 'Teacher' })],
      studentOrgClaimUrl: 'http://sfdc.co/OrgClaim',
      studentSurveyUrl: '',
    }),
  );
});

// --- helpers ---
async function seedSession(code) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('sessions').doc(code).set({
      sessionName: 'Seeded', ownerEmail: SF_EMAIL, instructorEmails: [SF_EMAIL],
    });
  });
}

// FieldValue sentinels from the compat SDK, loaded lazily so the file parses
// even if firebase is not present when only linting.
async function loadFieldValue() {
  const mod = await import('firebase/compat/app');
  const firebase = mod.default;
  await import('firebase/compat/firestore');
  const FieldValue = firebase.firestore.FieldValue;
  return {
    arrayUnion: FieldValue.arrayUnion,
    arrayRemove: FieldValue.arrayRemove,
    increment: FieldValue.increment,
    deleteField: FieldValue.delete,
  };
}

// Keep node:test from reporting "no assertions" on env issues.
assert.ok(RULES.includes('service cloud.firestore'));
