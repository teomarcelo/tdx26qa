/**
 * Demo instructor/student session patch helpers.
 *
 * Run with `npm run test:unit` (no emulator, no DOM storage).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDemoSessionPatch } from '../../src/lib/demoSessionSync.js';
import { getSessionInstructorRoster } from '../../src/lib/sessionInstructors.js';

test('applyDemoSessionPatch overlays ownerName onto the seeded demo session', () => {
  const seeded = { ownerName: 'Alex Rivera (Demo)', instructors: ['Alex Rivera (Demo)', 'Jordan Rivera'] };
  const next = applyDemoSessionPatch(seeded, { ownerName: 'Jordan Rivera' });
  const { lead, coInstructors } = getSessionInstructorRoster(next);
  assert.equal(lead, 'Jordan Rivera');
  assert.deepEqual(coInstructors, ['Alex Rivera (Demo)']);
});

test('applyDemoSessionPatch ignores a non-object patch', () => {
  const seeded = { ownerName: 'Alex Rivera (Demo)' };
  assert.equal(applyDemoSessionPatch(seeded, null).ownerName, 'Alex Rivera (Demo)');
  assert.equal(applyDemoSessionPatch(seeded, 'Jordan').ownerName, 'Alex Rivera (Demo)');
});
