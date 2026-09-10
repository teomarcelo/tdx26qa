/**
 * Instructor roster + lead-transfer helpers.
 *
 * Run with `npm run test:unit` (no emulator).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  instructorDirectoryKey,
  instructorDirectoryEntry,
  listedInstructorEmails,
  getSessionInstructorRoster,
  getInstructorManagerRows,
  buildLeadTransferUpdate,
} from '../../src/lib/sessionInstructors.js';

test('instructorDirectoryKey matches emailToId for a salesforce address', () => {
  assert.equal(instructorDirectoryKey('coteacher@salesforce.com'), 'coteacher_salesforce_com');
  assert.equal(instructorDirectoryKey('  Alex.Kim@Salesforce.com '), 'alex_kim_salesforce_com');
});

test('getSessionInstructorRoster still treats ownerName as the lead', () => {
  const { lead, coInstructors } = getSessionInstructorRoster({
    ownerName: 'Alex Kim',
    instructors: ['Alex Kim', 'Sam Rivera'],
  });
  assert.equal(lead, 'Alex Kim');
  assert.deepEqual(coInstructors, ['Sam Rivera']);
});

test('getInstructorManagerRows offers Lead only for listed emails that are not the owner', () => {
  const session = {
    ownerName: 'Alex Kim',
    ownerEmail: 'alex.kim@salesforce.com',
    instructors: ['Alex Kim', 'Sam Rivera'],
    instructorEmails: ['alex.kim@salesforce.com', 'sam.rivera@salesforce.com'],
    instructorDirectory: {
      alex_kim_salesforce_com: { email: 'alex.kim@salesforce.com', name: 'Alex Kim' },
      sam_rivera_salesforce_com: { email: 'sam.rivera@salesforce.com', name: 'Sam Rivera' },
    },
  };
  const rows = getInstructorManagerRows(session, {
    email: 'jordan@salesforce.com',
    name: 'Jordan',
  });
  assert.equal(rows.lead.name, 'Alex Kim');
  assert.equal(rows.coInstructors.length, 1);
  assert.equal(rows.coInstructors[0].name, 'Sam Rivera');
  assert.equal(rows.coInstructors[0].email, 'sam.rivera@salesforce.com');
  assert.equal(rows.coInstructors[0].canBecomeLead, true);
});

test('a listed email with no display-name chip still gets a Lead row', () => {
  const session = {
    ownerName: 'Alex Kim',
    ownerEmail: 'alex.kim@salesforce.com',
    instructors: ['Alex Kim'],
    instructorEmails: ['alex.kim@salesforce.com', 'sam.rivera@salesforce.com'],
  };
  const rows = getInstructorManagerRows(session, {});
  assert.equal(rows.coInstructors.length, 1);
  assert.equal(rows.coInstructors[0].email, 'sam.rivera@salesforce.com');
  assert.equal(rows.coInstructors[0].canBecomeLead, true);
});

test('buildLeadTransferUpdate hands ownership to a listed co-instructor', () => {
  const session = {
    ownerEmail: 'alex.kim@salesforce.com',
    instructorEmails: ['alex.kim@salesforce.com', 'sam.rivera@salesforce.com'],
  };
  const built = buildLeadTransferUpdate(session, 'Sam.Rivera@salesforce.com', 'Sam Rivera');
  assert.equal(built.ok, true);
  assert.deepEqual(built.update, {
    ownerEmail: 'sam.rivera@salesforce.com',
    ownerName: 'Sam Rivera',
    ownerId: 'sam_rivera_salesforce_com',
  });
});

test('buildLeadTransferUpdate refuses an email that has not joined', () => {
  const session = {
    ownerEmail: 'alex.kim@salesforce.com',
    instructorEmails: ['alex.kim@salesforce.com'],
  };
  const built = buildLeadTransferUpdate(session, 'sam.rivera@salesforce.com', 'Sam Rivera');
  assert.equal(built.ok, false);
  assert.match(built.error, /join/i);
});

test('buildLeadTransferUpdate refuses a non-salesforce address', () => {
  const session = {
    ownerEmail: 'alex.kim@salesforce.com',
    instructorEmails: ['alex.kim@salesforce.com', 'sam@gmail.com'],
  };
  const built = buildLeadTransferUpdate(session, 'sam@gmail.com', 'Sam');
  assert.equal(built.ok, false);
});

test('instructorDirectoryEntry is the nested map join/create writes', () => {
  const entry = instructorDirectoryEntry('Sam.Rivera@salesforce.com', 'Sam Rivera');
  assert.equal(entry.key, 'sam_rivera_salesforce_com');
  assert.deepEqual(entry.value, { email: 'sam.rivera@salesforce.com', name: 'Sam Rivera' });
});

test('listedInstructorEmails de-dupes and lowercases', () => {
  assert.deepEqual(
    listedInstructorEmails({ instructorEmails: ['A@salesforce.com', 'a@salesforce.com', ''] }),
    ['a@salesforce.com'],
  );
});
