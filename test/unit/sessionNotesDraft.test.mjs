/**
 * Unit tests for the session-notes three-way merge.
 *
 * Run with `npm run test:unit` (no emulator needed).
 *
 * Two instructors can have the notes editor open on the same session, and notes are
 * one array field on the session document, so this merge is the only thing standing
 * between a concurrent save and a lost note.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSessionNotes,
  notesDraftIsDirty,
  remoteNotesChangedSinceBase,
} from '../../src/instructor/lib/sessionNotesDraft.js';

const titles = out => out.map(n => n.title);
const ids = out => out.map(n => String(n.id));

test('a co-instructor addition is kept alongside the local draft', () => {
  const out = mergeSessionNotes({
    base: [{ id: 'a', title: 'Wi-Fi' }],
    remote: [{ id: 'a', title: 'Wi-Fi' }, { id: 'b', title: 'Parking' }],
    draft: [{ id: 'a', title: 'Wi-Fi password is guest26' }],
  });
  assert.deepEqual(titles(out), ['Wi-Fi password is guest26', 'Parking']);
});

test('a note this instructor had on screen and removed stays removed', () => {
  // Deliberate deletion semantics, documented on mergeSessionNotes.
  const out = mergeSessionNotes({
    base: [{ id: 'a', title: 'Wi-Fi' }],
    remote: [{ id: 'a', title: 'Wi-Fi' }],
    draft: [],
  });
  assert.deepEqual(titles(out), []);
});

test('duplicate remote ids are both kept when the draft edited that id', () => {
  // Regression: the id-keyed skip ran for every remote note sharing the id, so the
  // second note was dropped as "the draft's version wins".
  const out = mergeSessionNotes({
    base: [{ id: 'n1', title: 'Wi-Fi' }],
    remote: [{ id: 'n1', title: 'Wi-Fi' }, { id: 'n1', title: 'Parking' }],
    draft: [{ id: 'n1', title: 'Wi-Fi password is guest26' }],
  });
  assert.deepEqual(titles(out), ['Wi-Fi password is guest26', 'Parking']);
  assert.equal(new Set(ids(out)).size, out.length, 'ids must stay unique');
});

test('a duplicate id survives even when the first copy was deleted here', () => {
  const out = mergeSessionNotes({
    base: [{ id: 'n1', title: 'Wi-Fi' }],
    remote: [{ id: 'n1', title: 'Wi-Fi' }, { id: 'n1', title: 'Parking' }],
    draft: [],
  });
  assert.deepEqual(titles(out), ['Parking']);
});

test('duplicate remote ids with no local counterpart come back distinguishable', () => {
  const out = mergeSessionNotes({
    base: [],
    remote: [{ id: 'n1', title: 'Slides' }, { id: 'n1', title: 'Recording' }],
    draft: [{ id: 'sn_local', title: 'Mine' }],
  });
  assert.deepEqual(titles(out), ['Mine', 'Slides', 'Recording']);
  assert.equal(new Set(ids(out)).size, 3);
});

test('only the first of three notes sharing an id is superseded by the draft', () => {
  // The draft's note IS the first remote copy (last write wins, as documented); the
  // other two are different notes and must not be collapsed into it.
  const out = mergeSessionNotes({
    base: [],
    remote: [{ id: 'n1', title: 'A' }, { id: 'n1', title: 'B' }, { id: 'n1', title: 'C' }],
    draft: [{ id: 'n1', title: 'Mine' }],
  });
  assert.deepEqual(titles(out), ['Mine', 'B', 'C']);
  assert.equal(new Set(ids(out)).size, 3);
});

test('order is renumbered contiguously from zero', () => {
  const out = mergeSessionNotes({
    base: [],
    remote: [{ id: 'b', title: 'B', order: 9 }],
    draft: [{ id: 'a', title: 'A', order: 4 }],
  });
  assert.deepEqual(out.map(n => n.order), [0, 1]);
});

test('empty and missing arrays merge to nothing', () => {
  assert.deepEqual(mergeSessionNotes({ base: [], remote: [], draft: [] }), []);
  assert.deepEqual(mergeSessionNotes({}), []);
  assert.deepEqual(mergeSessionNotes({ base: null, remote: [null], draft: null }), []);
});

test('dirty and remote-changed detection ignore editor-only fields', () => {
  const session = { sessionNotes: [{ id: 'a', title: 'Wi-Fi', body: '' }], sessionNoteShow: true };
  const draft = [{ id: 'a', title: 'Wi-Fi', body: '', editorCollapsed: true }];
  assert.equal(notesDraftIsDirty(session, draft, true), false);
  assert.equal(notesDraftIsDirty(session, draft, false), true, 'master show toggle counts');
  assert.equal(remoteNotesChangedSinceBase(draft, [{ id: 'a', title: 'Wi-Fi', body: '' }]), false);
  assert.equal(remoteNotesChangedSinceBase(draft, [{ id: 'a', title: 'Parking', body: '' }]), true);
});
