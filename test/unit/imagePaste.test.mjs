import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_IMAGE_URLS_MAX } from '../../src/constants/app.js';
import {
  collectImageFilesFromPaste,
  formatUploadError,
  httpsImageUrlList,
  pendingRowsFromImageUrls,
  questionImageUrlsFromPending,
  stripEmbeddedImageUrls,
} from '../../src/lib/imagePaste.js';

test('httpsImageUrlList keeps https URLs and drops everything else', () => {
  assert.deepEqual(httpsImageUrlList(null), []);
  assert.deepEqual(httpsImageUrlList('https://cdn.example/a.jpg'), ['https://cdn.example/a.jpg']);
  assert.deepEqual(httpsImageUrlList('http://insecure.example/a.jpg'), []);
  assert.deepEqual(
    httpsImageUrlList(['https://a.example/1.jpg', 'ftp://x', ' https://b.example/2.jpg ']),
    ['https://a.example/1.jpg', 'https://b.example/2.jpg'],
  );
  assert.deepEqual(
    httpsImageUrlList({ b: 'https://b.example/b.jpg', a: 'https://a.example/a.jpg' }),
    ['https://a.example/a.jpg', 'https://b.example/b.jpg'],
  );
});

test('pendingRowsFromImageUrls hydrates preview rows and caps at QUESTION_IMAGE_URLS_MAX', () => {
  const rows = pendingRowsFromImageUrls([
    'https://cdn.example/a.jpg',
    'http://nope',
    'https://cdn.example/b.jpg',
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, 'https://cdn.example/a.jpg');
  assert.equal(rows[1].url, 'https://cdn.example/b.jpg');
  assert.equal(rows[0].uploading, false);
  assert.ok(rows[0].pid);
  assert.notEqual(rows[0].pid, rows[1].pid);

  const many = Array.from({ length: QUESTION_IMAGE_URLS_MAX + 3 }, (_, i) => `https://cdn.example/${i}.jpg`);
  assert.equal(pendingRowsFromImageUrls(many).length, QUESTION_IMAGE_URLS_MAX);
});

test('questionImageUrlsFromPending drops unfinished uploads and caps', () => {
  assert.deepEqual(
    questionImageUrlsFromPending([
      { pid: '1', url: 'https://a.example/1.jpg' },
      { pid: '2', url: '', uploading: true },
      { pid: '3', url: 'https://a.example/3.jpg' },
    ]),
    ['https://a.example/1.jpg', 'https://a.example/3.jpg'],
  );
  const many = Array.from({ length: QUESTION_IMAGE_URLS_MAX + 2 }, (_, i) => ({
    pid: String(i),
    url: `https://cdn.example/${i}.jpg`,
  }));
  assert.equal(questionImageUrlsFromPending(many).length, QUESTION_IMAGE_URLS_MAX);
});

test('stripEmbeddedImageUrls removes pasted URLs from the textarea body', () => {
  const url = 'https://cdn.example/shot.jpg';
  assert.equal(
    stripEmbeddedImageUrls(`See this\n${url}\nplease`, [url]),
    'See this\n\nplease',
  );
  assert.equal(stripEmbeddedImageUrls('no images here', []), 'no images here');
  assert.equal(stripEmbeddedImageUrls('', ['https://x']), '');
});

test('collectImageFilesFromPaste reads image files and ignores empty ones', () => {
  const good = { type: 'image/png', size: 12 };
  const empty = { type: 'image/png', size: 0 };
  const notImage = { type: 'text/plain', size: 4 };
  const ev = {
    clipboardData: {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => good },
        { kind: 'file', type: 'image/png', getAsFile: () => empty },
        { kind: 'string', type: 'text/plain', getAsFile: () => notImage },
      ],
      files: [],
    },
  };
  assert.deepEqual(collectImageFilesFromPaste(ev), [good]);
  assert.deepEqual(collectImageFilesFromPaste({}), []);
});

test('formatUploadError points at CORS when the browser does', () => {
  assert.match(formatUploadError({ message: 'CORS preflight failed' }), /storage-cors/);
  assert.match(formatUploadError({ message: 'permission-denied', code: 'storage/unauthorized' }), /Upload failed/);
});
