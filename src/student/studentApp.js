import firebase from '../lib/firebaseCompat.js';
import { FIREBASE_CONFIG } from '../config/firebase.js';
import {
  QUESTIONS_PAGE_SIZE,
  STUDENT_POLL_MS,
  IMAGE_MAX_EDGE,
  IMAGE_JPEG_QUALITY,
} from '../constants/app.js';
import { esc, linkify, formatRichMessage, isHttpsUrl, copyRichCodeBlock as runCopyRichCodeBlock } from '../lib/richText.js';
import { createShowToast } from '../lib/toast.js';
import { formatQuestionWhen } from '../lib/formatQuestionWhen.js';
import { filterCorpusByFuseSearch } from '../lib/questionSearch.js';
import { fetchSessionQuestionCountStats } from '../lib/sessionQuestionCounts.js';

const showToast = createShowToast('toast');

let db, sessionCode, userName, userEmail, userId, currentSession;
let allQuestions = [], currentFilter = 'all', currentSort = 'recent';
let editingId = null, unsubSession;
let studentPollTimer = null;
let studentPollSkipUntil = 0;
let questionPages = [];
let currentQuestionPage = 0;
let hasMoreOlder = false, questionsLoading = false;
/** True once we know there are no older questions in Firestore beyond what is cached (short last page or empty older fetch). */
let studentOlderBeyondLoadExhausted = false;
/** Invalidates in-flight Firestore aggregate stat requests when the session changes. */
let studentSessionStatsSerial = 0;
let storage = null;
const pendingQuestionImages = [];

function clearPendingQuestionImages() {
  pendingQuestionImages.forEach(function (row) {
    if (row.blobUrl) try { URL.revokeObjectURL(row.blobUrl); } catch (e) {}
  });
  pendingQuestionImages.length = 0;
  renderQuestionImagePreviews();
}

function genId() { return Math.random().toString(36).slice(2,10); }

/** Same browser profile across refreshes (not a login — clear site data to reset). */
const LS_STUDENT_UID = 'sqa_student_uid';
const LS_STUDENT_UID_LEGACY = 'tdx_student_uid';
const LS_LAST_SESSION = 'sqa_student_last_code';
const LS_LAST_SESSION_LEGACY = 'tdx_student_last_code';
const LS_NAME = 'sqa_name';
const LS_NAME_LEGACY = 'tdx_name';
const SS_LEGACY_UID = 'tdx_uid';

function safeLsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function safeLsSet(k, v) {
  try { localStorage.setItem(k, v); } catch (e) {}
}
function safeLsRemove(k) {
  try { localStorage.removeItem(k); } catch (e) {}
}

function clearStudentRestoringShell() {
  try { document.documentElement.classList.remove('std-restoring-session'); } catch (e) {}
}

function studentMyQsKey() {
  return 'sqa_my_questions_' + String(sessionCode || '').replace(/[^A-Z0-9_-]/gi, '');
}
function legacyStudentMyQsPerSessionKey() {
  return 'tdx_my_questions_' + String(sessionCode || '').replace(/[^A-Z0-9_-]/gi, '');
}

function migrateLegacyStudentMyQuestions() {
  if (!sessionCode) return;
  var nk = studentMyQsKey();
  try {
    if (sessionStorage.getItem(nk)) return;
    var fromPerSessionLegacy = sessionStorage.getItem(legacyStudentMyQsPerSessionKey());
    if (fromPerSessionLegacy) {
      sessionStorage.setItem(nk, fromPerSessionLegacy);
      sessionStorage.removeItem(legacyStudentMyQsPerSessionKey());
      return;
    }
    var leg = sessionStorage.getItem('tdx_my_questions');
    if (leg) {
      sessionStorage.setItem(nk, leg);
      sessionStorage.removeItem('tdx_my_questions');
    }
  } catch (e) {}
}

function tryAutoRejoinStudent() {
  function bailToJoin() {
    clearStudentRestoringShell();
    var j = document.getElementById('join-screen');
    var a = document.getElementById('app-screen');
    if (j) j.style.display = 'flex';
    if (a) a.style.display = 'none';
  }
  if (!db) {
    bailToJoin();
    return;
  }
  var raw = safeLsGet(LS_LAST_SESSION) || safeLsGet(LS_LAST_SESSION_LEGACY);
  if (raw && safeLsGet(LS_LAST_SESSION_LEGACY) && !safeLsGet(LS_LAST_SESSION)) {
    safeLsSet(LS_LAST_SESSION, String(raw).trim());
    safeLsRemove(LS_LAST_SESSION_LEGACY);
  }
  if (!raw) {
    bailToJoin();
    return;
  }
  var code = String(raw).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!code) {
    safeLsRemove(LS_LAST_SESSION);
    safeLsRemove(LS_LAST_SESSION_LEGACY);
    bailToJoin();
    return;
  }
  db.collection('sessions').doc(code).get().then(function (doc) {
    if (!doc.exists) {
      safeLsRemove(LS_LAST_SESSION);
      safeLsRemove(LS_LAST_SESSION_LEGACY);
      bailToJoin();
      return;
    }
    sessionCode = code;
    currentSession = doc.data();
    var nm = (safeLsGet(LS_NAME) || safeLsGet(LS_NAME_LEGACY) || '').trim();
    userName = nm || 'Anonymous';
    userEmail = '';
    var codeEl = document.getElementById('code-input');
    var nameEl = document.getElementById('name-input');
    if (codeEl) codeEl.value = code;
    if (nameEl) nameEl.value = nm || '';
    enterApp();
  }).catch(function () { bailToJoin(); });
}

window.addEventListener('load', () => {
  const configReady = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
  if (configReady) {
    try {
      db = firebase.firestore();
      if (firebase.storage) storage = firebase.storage();
    } catch (e) { console.warn('Firebase init failed:', e); }
  }
  var legacyUid = null;
  try { legacyUid = sessionStorage.getItem(SS_LEGACY_UID); } catch (e) {}
  userId = safeLsGet(LS_STUDENT_UID) || safeLsGet(LS_STUDENT_UID_LEGACY) || legacyUid || genId();
  safeLsSet(LS_STUDENT_UID, userId);
  if (safeLsGet(LS_STUDENT_UID_LEGACY)) safeLsRemove(LS_STUDENT_UID_LEGACY);
  if (legacyUid) {
    try { sessionStorage.removeItem(SS_LEGACY_UID); } catch (e) {}
  }
  var nNew = safeLsGet(LS_NAME);
  var nLeg = safeLsGet(LS_NAME_LEGACY);
  const stored = (nNew || nLeg || '').trim();
  if (stored) document.getElementById('name-input').value = stored;
  if (!nNew && nLeg) {
    safeLsSet(LS_NAME, nLeg);
    safeLsRemove(LS_NAME_LEGACY);
  }
  if (configReady && db) tryAutoRejoinStudent();
});

function joinSession() {
  const raw = document.getElementById('code-input').value.trim().toUpperCase();
  const code = raw.replace(/[^A-Z0-9-]/g,'');
  if (!code) { showJoinError('Please enter a session code.'); return; }
  userName = document.getElementById('name-input').value.trim() || 'Anonymous';
  userEmail = '';
  if (userName !== 'Anonymous') {
    safeLsSet(LS_NAME, userName);
    safeLsRemove(LS_NAME_LEGACY);
  }

  document.getElementById('join-btn').disabled = true;
  document.getElementById('join-btn').textContent = 'Joining...';

  db.collection('sessions').doc(code).get().then(doc => {
    if (!doc.exists) { showJoinError('Session not found. Check the code and try again.'); document.getElementById('join-btn').disabled = false; document.getElementById('join-btn').textContent = 'Join session'; return; }
    sessionCode = code;
    currentSession = doc.data();
    enterApp();
  }).catch(() => { showJoinError('Connection error. Please try again.'); document.getElementById('join-btn').disabled = false; document.getElementById('join-btn').textContent = 'Join session'; });
}

function showJoinError(msg) { document.getElementById('join-error').textContent = msg; }

function enterApp() {
  clearStudentRestoringShell();
  studentSessionStatsSerial++;
  if (sessionCode) {
    safeLsSet(LS_LAST_SESSION, sessionCode);
    safeLsRemove(LS_LAST_SESSION_LEGACY);
  }
  migrateLegacyStudentMyQuestions();
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  postAnonymously = (userName === 'Anonymous' || !userName);
  updateAnonToggle();
  renderSessionInfo(currentSession);
  document.getElementById('bar-session-name').textContent = currentSession.sessionName || currentSession.className || 'Session';
  document.getElementById('bar-code').textContent = sessionCode;

  questionPages = [];
  currentQuestionPage = 0;
  hasMoreOlder = false;
  studentOlderBeyondLoadExhausted = false;
  allQuestions = [];
  var qsIn = document.getElementById('questions-search');
  if (qsIn) qsIn.value = '';

  unsubSession = db.collection('sessions').doc(sessionCode).onSnapshot(snap => {
    if (snap.exists) {
      currentSession = snap.data();
      renderSessionInfo(snap.data());
    }
  });

  if (studentPollTimer) clearInterval(studentPollTimer);
  clearPendingQuestionImages();
  fetchStudentQuestionsFirstPage();
  studentPollTimer = setInterval(function () {
    if (Date.now() < studentPollSkipUntil) return;
    fetchStudentQuestionsFirstPage();
  }, STUDENT_POLL_MS);
}

let postAnonymously = true;

function toggleAnon() {
  postAnonymously = !postAnonymously;
  updateAnonToggle();
}

function updateAnonToggle() {
  const toggle = document.getElementById('anon-toggle');
  const knob = document.getElementById('anon-knob');
  const preview = document.getElementById('anon-name-preview');
  if (postAnonymously) {
    toggle.style.background = 'var(--border)';
    knob.style.transform = 'translateX(0)';
    preview.textContent = 'Anonymous';
    preview.style.color = 'var(--text-muted)';
  } else {
    toggle.style.background = 'var(--accent)';
    knob.style.transform = 'translateX(16px)';
    preview.textContent = userName && userName !== 'Anonymous' ? userName : 'Anonymous';
    preview.style.color = 'var(--accent)';
  }
}

function leaveSession() {
  if (unsubSession) unsubSession();
  if (studentPollTimer) { clearInterval(studentPollTimer); studentPollTimer = null; }
  clearPendingQuestionImages();
  postAnonymously = true;
  safeLsRemove(LS_LAST_SESSION);
  safeLsRemove(LS_LAST_SESSION_LEGACY);
  sessionCode = null;
  currentSession = null;
  studentSessionStatsSerial++;
  clearStudentRestoringShell();
  document.getElementById('join-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('join-error').textContent = '';
  document.getElementById('join-btn').disabled = false;
  document.getElementById('join-btn').textContent = 'Join session';
}

function renderSessionInfo(s) {
  document.getElementById('si-title').textContent = s.sessionName || s.className || '';
  var instRow = document.getElementById('si-instructor');
  var instText = document.getElementById('si-instructor-text');
  var fromArr = Array.isArray(s.instructors) ? s.instructors.map(function (x) { return String(x).trim(); }).filter(Boolean) : [];
  var fromNames = (s.instructorNames || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var label = fromArr.length ? fromArr.join(', ') : fromNames.join(', ');
  if (label) {
    instText.textContent = label;
    instRow.style.display = '';
  } else {
    instText.textContent = '';
    instRow.style.display = 'none';
  }
  document.getElementById('si-datetime-text').textContent = [s.sessionDate, s.sessionTime].filter(Boolean).join(' · ') || '—';
  document.getElementById('si-room-text').textContent = s.room || '—';
  const desc = document.getElementById('si-desc');
  desc.textContent = s.description || '';
  desc.style.display = s.description ? '' : 'none';
  renderSessionNote(s);
}

function renderSessionNote(s) {
  var wrap = document.getElementById('session-note-wrap');
  if (!wrap) return;
  var allowed = (s.sessionNoteShow !== false);
  var t = (s.sessionNoteTitle || '').trim();
  var b = (s.sessionNoteBody || '').trim();
  var urls = Array.isArray(s.sessionNoteImageUrls) ? s.sessionNoteImageUrls.filter(isHttpsUrl) : [];
  if (!allowed || (!t && !b && !urls.length)) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  var titleEl = document.getElementById('session-note-title');
  var bodyEl = document.getElementById('session-note-body');
  var imgEl = document.getElementById('session-note-images');
  titleEl.className = 'session-note-title rich-message';
  titleEl.innerHTML = t ? formatRichMessage(t) : '';
  titleEl.style.display = t ? '' : 'none';
  bodyEl.className = 'session-note-body rich-message';
  bodyEl.innerHTML = b ? formatRichMessage(b) : '';
  bodyEl.style.display = b ? '' : 'none';
  imgEl.innerHTML = urls.map(function (u) {
    var safe = String(u).replace(/"/g, '');
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer"><img src="' + safe + '" alt="" loading="lazy" referrerpolicy="no-referrer"></a>';
  }).join('');
}

function rebuildAllQuestions() {
  var pg = questionPages[currentQuestionPage];
  allQuestions = pg && pg.questions ? pg.questions.slice() : [];
}

function getAllCachedQuestionsForStats() {
  var m = new Map();
  questionPages.forEach(function (p) {
    (p.questions || []).forEach(function (q) { m.set(q.id, q); });
  });
  return Array.from(m.values());
}

function findStudentQuestionById(id) {
  var hit = allQuestions.find(function (x) { return x.id === id; });
  if (hit) return hit;
  return getAllCachedQuestionsForStats().find(function (x) { return x.id === id; });
}

function getQuestionSearchHaystack(q) {
  var bits = [q.text, q.authorName];
  var answers = q.answers && q.answers.length ? q.answers : (q.answer ? [{ text: q.answer, instructor: 'Instructor' }] : []);
  for (var ai = 0; ai < answers.length; ai++) {
    var a = answers[ai];
    bits.push(a.text, a.instructor);
    if (Array.isArray(a.imageUrls)) bits.push(a.imageUrls.join(' '));
  }
  return bits.filter(Boolean).join('\n');
}

function filterQuestionsBySearchQuery(corpus, query) {
  return filterCorpusByFuseSearch(corpus, query, getQuestionSearchHaystack);
}

function getStudentSearchQuery() {
  var el = document.getElementById('questions-search');
  return el && el.value ? String(el.value).trim() : '';
}

function clearStudentSearch() {
  var el = document.getElementById('questions-search');
  if (el) el.value = '';
  renderQuestions();
  updateQuestionPaginationUi();
}

function fetchStudentQuestionsFirstPage() {
  if (!db || !sessionCode) return Promise.resolve();
  if (questionsLoading) return Promise.resolve();
  if (currentQuestionPage !== 0) return Promise.resolve();
  questionsLoading = true;
  return db.collection('sessions').doc(sessionCode).collection('questions')
    .orderBy('createdAt', 'desc')
    .limit(QUESTIONS_PAGE_SIZE)
    .get()
    .then(function (snap) {
      var questions = snap.docs.map(function (d) { return { id: d.id, ...d.data() }; });
      var endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      questionPages[0] = { questions: questions, endSnap: endSnap };
      if (questionPages.length > 1) questionPages.length = 1;
      hasMoreOlder = snap.docs.length >= QUESTIONS_PAGE_SIZE;
      studentOlderBeyondLoadExhausted = snap.docs.length < QUESTIONS_PAGE_SIZE;
      rebuildAllQuestions();
      renderQuestions();
      updateStats();
      updateQuestionPaginationUi();
    })
    .finally(function () { questionsLoading = false; });
}

function studentRefreshNow() {
  if (!db || !sessionCode) return;
  if (questionsLoading) {
    showToast('Still loading—try again in a second.');
    return;
  }
  currentQuestionPage = 0;
  questionPages = [];
  studentOlderBeyondLoadExhausted = false;
  var btn = document.getElementById('refresh-now-btn');
  if (btn) btn.disabled = true;
  fetchStudentQuestionsFirstPage()
    .then(function () { showToast('Board updated.'); })
    .catch(function () { showToast('Could not refresh. Check your connection.'); })
    .finally(function () { if (btn) btn.disabled = false; });
}

function goStudentOlderPage() {
  if (!db || !sessionCode || questionsLoading) return;
  var cur = questionPages[currentQuestionPage];
  if (!cur || !cur.endSnap || cur.questions.length < QUESTIONS_PAGE_SIZE) return;
  var nextIdx = currentQuestionPage + 1;
  if (questionPages[nextIdx]) {
    currentQuestionPage = nextIdx;
    rebuildAllQuestions();
    renderQuestions();
    updateStats();
    updateQuestionPaginationUi();
    return;
  }
  questionsLoading = true;
  db.collection('sessions').doc(sessionCode).collection('questions')
    .orderBy('createdAt', 'desc')
    .startAfter(cur.endSnap)
    .limit(QUESTIONS_PAGE_SIZE)
    .get()
    .then(function (snap) {
      if (!snap.docs.length) {
        studentOlderBeyondLoadExhausted = true;
        updateStats();
        updateQuestionPaginationUi();
        return;
      }
      var questions = snap.docs.map(function (d) { return { id: d.id, ...d.data() }; });
      var endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      questionPages[nextIdx] = { questions: questions, endSnap: endSnap };
      currentQuestionPage = nextIdx;
      studentOlderBeyondLoadExhausted = snap.docs.length < QUESTIONS_PAGE_SIZE;
      rebuildAllQuestions();
      renderQuestions();
      updateStats();
      updateQuestionPaginationUi();
    })
    .finally(function () { questionsLoading = false; });
}

function goStudentToPage(zeroBased) {
  if (zeroBased < 0 || zeroBased >= questionPages.length) return;
  if (!questionPages[zeroBased]) return;
  if (zeroBased === currentQuestionPage) return;
  currentQuestionPage = zeroBased;
  rebuildAllQuestions();
  renderQuestions();
  updateStats();
  updateQuestionPaginationUi();
  if (zeroBased === 0) fetchStudentQuestionsFirstPage();
}

function goStudentPreviousPage() {
  if (currentQuestionPage <= 0) return;
  goStudentToPage(currentQuestionPage - 1);
}

function goStudentNextPage() {
  if (questionsLoading) return;
  if (currentQuestionPage < questionPages.length - 1) {
    goStudentToPage(currentQuestionPage + 1);
    return;
  }
  goStudentOlderPage();
}

function buildStudentPaginationHtml() {
  var numLoaded = questionPages.length;
  if (!numLoaded) return '';
  var cur = questionPages[currentQuestionPage];
  var canPrev = currentQuestionPage > 0;
  var canNextCached = currentQuestionPage < numLoaded - 1;
  var canNextFetch = !studentOlderBeyondLoadExhausted && !!(cur && cur.endSnap && cur.questions.length >= QUESTIONS_PAGE_SIZE);
  var canNext = canNextCached || canNextFetch;
  var lastPg = questionPages[numLoaded - 1];
  var showPhantomNext = !studentOlderBeyondLoadExhausted && !!(lastPg && lastPg.endSnap && lastPg.questions.length >= QUESTIONS_PAGE_SIZE);
  var totalSlots = numLoaded + (showPhantomNext ? 1 : 0);
  var maxNums = 5;
  var lo = 0;
  var hi = totalSlots;
  if (totalSlots > maxNums) {
    var half = Math.floor(maxNums / 2);
    lo = Math.max(0, Math.min(currentQuestionPage - half, totalSlots - maxNums));
    hi = lo + maxNums;
  }
  var parts = [];
  parts.push('<div class="pagination-nav-cluster">');
  parts.push('<button type="button" class="load-more-btn student-p-prev"' + (canPrev ? '' : ' disabled') + ' onclick="goStudentPreviousPage()">Previous</button>');
  for (var i = lo; i < hi; i++) {
    var isAct = i === currentQuestionPage;
    if (i < numLoaded) {
      parts.push('<button type="button" class="pagination-page-btn' + (isAct ? ' active' : '') + '" onclick="goStudentToPage(' + i + ')">' + (i + 1) + '</button>');
    } else {
      parts.push('<button type="button" class="pagination-page-btn" title="Load older questions" aria-label="Go to page ' + (i + 1) + '" onclick="goStudentNextPage()">' + (i + 1) + '</button>');
    }
  }
  parts.push('<button type="button" class="load-more-btn student-p-next"' + (canNext ? '' : ' disabled') + ' onclick="goStudentNextPage()">Next</button>');
  parts.push('</div>');
  return parts.join('');
}

function updateQuestionPaginationUi() {
  var top = document.getElementById('student-pagination-top');
  var bottom = document.getElementById('student-pagination-bottom');
  if (!top || !bottom) return;
  var searching = !!getStudentSearchQuery();
  var showBar = !searching && !!(sessionCode && db && (questionPages[0] || currentQuestionPage > 0));
  var html = showBar ? buildStudentPaginationHtml() : '';
  top.innerHTML = html;
  bottom.innerHTML = html;
  top.classList.toggle('visible', showBar);
  bottom.classList.toggle('visible', showBar);
  top.style.display = showBar ? 'flex' : 'none';
  bottom.style.display = showBar ? 'flex' : 'none';
}

function resizeImageToJpegBlob(file) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    var u = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(u);
      var w = img.width, h = img.height;
      var scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h, 1));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      c.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('encode'));
      }, 'image/jpeg', IMAGE_JPEG_QUALITY);
    };
    img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('image')); };
    img.src = u;
  });
}

function collectImageFilesFromPaste(e) {
  var out = [];
  var cd = e.clipboardData;
  if (!cd) return out;
  if (cd.items && cd.items.length) {
    for (var i = 0; i < cd.items.length; i++) {
      var it = cd.items[i];
      if (it.kind === 'file' && it.type && it.type.indexOf('image') === 0) {
        var f = it.getAsFile();
        if (f && f.size > 0) out.push(f);
      }
    }
  }
  if (!out.length && cd.files && cd.files.length) {
    for (var j = 0; j < cd.files.length; j++) {
      if (cd.files[j].type && cd.files[j].type.indexOf('image') === 0 && cd.files[j].size > 0) out.push(cd.files[j]);
    }
  }
  return out;
}

function normalizeClipboardImageHttps(src) {
  var s = String(src || '').trim();
  if (!s) return '';
  if (s.indexOf('//') === 0) s = 'https:' + s;
  return s;
}

function looksLikeImageUrl(u) {
  var s = String(u || '').toLowerCase();
  if (!s || s.indexOf('data:') === 0) return false;
  if (/\.(jpg|jpeg|png|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(s)) return true;
  if (s.indexOf('gstatic.com') >= 0) return true;
  if (s.indexOf('googleusercontent.com') >= 0) return true;
  if (s.indexOf('ggpht.com') >= 0) return true;
  if (s.indexOf('twimg.com') >= 0) return true;
  if (s.indexOf('cdn.') >= 0 && /\/(image|img|photo|media)\//i.test(s)) return true;
  return false;
}

function extractImageSrcFromUriListPaste(e) {
  var cd = e.clipboardData;
  if (!cd) return '';
  var raw = (cd.getData('text/uri-list') || '').trim();
  if (!raw) return '';
  var u = raw.split(/\r?\n/)[0].trim();
  if (u.indexOf('file:') === 0) return '';
  u = normalizeClipboardImageHttps(u);
  return isHttpsUrl(u) && looksLikeImageUrl(u) ? u : '';
}

function extractImageSrcFromPlainPaste(e) {
  var cd = e.clipboardData;
  if (!cd) return '';
  var t = (cd.getData('text/plain') || '').trim();
  if (!t || t.length > 12000) return '';
  var lines = t.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^https:\/\/[^\s<>"']+$/);
    if (!m) continue;
    var u = normalizeClipboardImageHttps(m[0]);
    if (isHttpsUrl(u) && looksLikeImageUrl(u)) return u;
  }
  return '';
}

function extractImageSrcFromHtmlPaste(e) {
  var cd = e.clipboardData;
  if (!cd) return '';
  var html = cd.getData('text/html');
  if (!html || !html.trim()) return '';
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var imgs = doc.querySelectorAll('img[src]');
    for (var i = 0; i < imgs.length; i++) {
      var src = (imgs[i].getAttribute('src') || '').trim();
      if (!src || src.indexOf('data:') === 0) continue;
      src = normalizeClipboardImageHttps(src);
      if (isHttpsUrl(src)) return src;
    }
    return '';
  } catch (er) { return ''; }
}

function extractImageUrlForQuestionPaste(e, hasFiles) {
  if (hasFiles) return '';
  return extractImageSrcFromHtmlPaste(e) || extractImageSrcFromUriListPaste(e) || extractImageSrcFromPlainPaste(e);
}

function uploadStudentQuestionImage(jpegBlob) {
  if (!storage || !sessionCode) return Promise.reject(new Error('no storage'));
  var path = 'sessions/' + sessionCode + '/question_paste/' + userId + '_' + Date.now() + '_' + genId() + '.jpg';
  return storage.ref(path).put(jpegBlob, { contentType: 'image/jpeg' }).then(function (snap) { return snap.ref.getDownloadURL(); });
}

function renderQuestionImagePreviews() {
  var wrap = document.getElementById('q-image-previews');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!pendingQuestionImages.length) {
    wrap.classList.remove('has-images');
    return;
  }
  wrap.classList.add('has-images');
  pendingQuestionImages.forEach(function (row) {
    var span = document.createElement('span');
    span.className = 'paste-preview-item';
    span.dataset.pid = row.pid;
    var img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = row.blobUrl || row.url || '';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'paste-preview-remove';
    btn.setAttribute('aria-label', 'Remove image');
    btn.textContent = '×';
    btn.onclick = function () { removePendingQuestionImage(row.pid); };
    span.appendChild(img);
    span.appendChild(btn);
    wrap.appendChild(span);
  });
}

function removePendingQuestionImage(pid) {
  var i = pendingQuestionImages.findIndex(function (r) { return r.pid === pid; });
  if (i < 0) return;
  var row = pendingQuestionImages[i];
  if (row.blobUrl) try { URL.revokeObjectURL(row.blobUrl); } catch (e) {}
  pendingQuestionImages.splice(i, 1);
  renderQuestionImagePreviews();
}

function onQuestionTextPaste(e) {
  if (!sessionCode) return;
  var files = collectImageFilesFromPaste(e);
  var htmlSrc = extractImageUrlForQuestionPaste(e, files.length > 0);
  if (!files.length && !htmlSrc) return;

  if (!storage) {
    if (htmlSrc) {
      e.preventDefault();
      pendingQuestionImages.push({ pid: genId() + genId(), url: htmlSrc, blobUrl: '' });
      renderQuestionImagePreviews();
      showToast('Image link added (Firebase Storage not active—this uses the original URL).');
      return;
    }
    showToast('Image paste needs Firebase Storage enabled in your project.');
    return;
  }

  e.preventDefault();

  (async function () {
    if (files.length) {
      for (var k = 0; k < files.length; k++) {
        var pid = genId() + '_' + Date.now() + '_' + k;
        pendingQuestionImages.push({ pid: pid, url: '', blobUrl: '', uploading: true });
        renderQuestionImagePreviews();
        try {
          showToast('Uploading image…');
          var jpegBlob = await resizeImageToJpegBlob(files[k]);
          var blobUrl = URL.createObjectURL(jpegBlob);
          var idx0 = pendingQuestionImages.findIndex(function (r) { return r.pid === pid; });
          if (idx0 >= 0) {
            pendingQuestionImages[idx0] = { pid: pid, url: '', blobUrl: blobUrl, uploading: false };
          }
          renderQuestionImagePreviews();
          var url = await uploadStudentQuestionImage(jpegBlob);
          var idx = pendingQuestionImages.findIndex(function (r) { return r.pid === pid; });
          if (idx >= 0) {
            try { URL.revokeObjectURL(pendingQuestionImages[idx].blobUrl); } catch (er) {}
            pendingQuestionImages[idx] = { pid: pid, url: url, blobUrl: '' };
          }
          renderQuestionImagePreviews();
          showToast('Image attached. Add text or submit.');
        } catch (err) {
          console.warn(err);
          var idx2 = pendingQuestionImages.findIndex(function (r) { return r.pid === pid; });
          if (idx2 >= 0) {
            try { URL.revokeObjectURL(pendingQuestionImages[idx2].blobUrl); } catch (er2) {}
            pendingQuestionImages.splice(idx2, 1);
          }
          renderQuestionImagePreviews();
          showToast('Upload failed: ' + (err && err.message ? err.message : 'check Storage rules in SETUP.md'));
        }
      }
      return;
    }

    if (htmlSrc) {
      var pid2 = genId() + '_' + Date.now();
      pendingQuestionImages.push({ pid: pid2, url: htmlSrc, blobUrl: '' });
      renderQuestionImagePreviews();
      showToast('Uploading image…');
      try {
        var r = await fetch(htmlSrc, { mode: 'cors' });
        if (!r.ok) throw new Error('Could not download image (site blocked copy). Try right-click → Copy image.');
        var blob0 = await r.blob();
        var jpeg2 = await resizeImageToJpegBlob(blob0);
        var url2 = await uploadStudentQuestionImage(jpeg2);
        var ix = pendingQuestionImages.findIndex(function (r) { return r.pid === pid2; });
        if (ix >= 0) {
          pendingQuestionImages[ix] = { pid: pid2, url: url2, blobUrl: '' };
        }
        renderQuestionImagePreviews();
        showToast('Image attached. Add text or submit.');
      } catch (err) {
        console.warn(err);
        var ixF = pendingQuestionImages.findIndex(function (r) { return r.pid === pid2; });
        if (ixF >= 0) {
          renderQuestionImagePreviews();
          showToast('Using image link (download or upload was blocked). Submit to attach.');
        }
      }
    }
  })();
}

function normalizeQuestionImageUrls(q) {
  var raw = q.imageUrls;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map(function (u) { return String(u).trim(); }).filter(isHttpsUrl);
  }
  if (typeof raw === 'string') return isHttpsUrl(raw) ? [raw.trim()] : [];
  if (typeof raw === 'object') {
    return Object.keys(raw).sort().map(function (k) { return raw[k]; }).map(function (u) { return String(u).trim(); }).filter(isHttpsUrl);
  }
  return [];
}

function htmlQuestionAttachedImages(q) {
  var urls = normalizeQuestionImageUrls(q);
  if (!urls.length) return '';
  return '<div class="q-attached-images">' + urls.map(function (u) {
    var safe = String(u).replace(/"/g, '');
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer"><img src="' + safe + '" alt="" loading="lazy" referrerpolicy="no-referrer"></a>';
  }).join('') + '</div>';
}

function isImageOnlyPlaceholderText(text) {
  var t = (text || '').trim().toLowerCase();
  return t === '(image)' || t === '(photo)';
}

function htmlQuestionBody(q) {
  var urls = normalizeQuestionImageUrls(q);
  var rawText = q.text || '';
  if (!String(rawText).trim() && urls.length) return '';
  if (isImageOnlyPlaceholderText(rawText) && urls.length) return '';
  if (isImageOnlyPlaceholderText(rawText) && !urls.length) {
    return '<div class="q-text q-text-rich q-text-muted">No image was saved—wait for the upload to finish before you submit, then try again.</div>';
  }
  if (!String(rawText).trim()) return '';
  return '<div class="q-text q-text-rich rich-message">' + formatRichMessage(rawText) + '</div>';
}

function submitQuestion() {
  let text = document.getElementById('q-text').value.trim();
  if (!text && !pendingQuestionImages.length) return;
  if (pendingQuestionImages.some(function (r) { return !r.url; })) {
    showToast('Wait for images to finish uploading, then submit.');
    return;
  }
  const displayName = postAnonymously ? 'Anonymous' : (userName && userName !== 'Anonymous' ? userName : 'Anonymous');
  document.getElementById('submit-btn').disabled = true;
  const imageUrls = pendingQuestionImages.map(function (r) { return r.url; }).filter(Boolean);
  imageUrls.forEach(function (u) {
    if (!u) return;
    var re = new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    text = text.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  });
  if (pendingQuestionImages.length && imageUrls.length !== pendingQuestionImages.length) {
    document.getElementById('submit-btn').disabled = false;
    showToast('Wait for all images to finish uploading, then submit again.');
    return;
  }
  var textOut = text.trim();
  if (!textOut && imageUrls.length) textOut = '';
  else if (!textOut && !imageUrls.length) textOut = '(Image)';
  var payload = {
    text: textOut,
    authorName: displayName || 'Anonymous',
    authorEmail: '',
    authorId: userId,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
    pinned: false,
    votes: 0,
    voters: [],
    answer: ''
  };
  if (imageUrls.length) payload.imageUrls = imageUrls;
  db.collection('sessions').doc(sessionCode).collection('questions').add(payload).then(docRef => {
    const myQs = JSON.parse(sessionStorage.getItem(studentMyQsKey()) || '[]');
    myQs.push(docRef.id);
    sessionStorage.setItem(studentMyQsKey(), JSON.stringify(myQs));
    document.getElementById('q-text').value = '';
    clearPendingQuestionImages();
    document.getElementById('submit-btn').disabled = false;
    showToast('Question submitted!');
    currentQuestionPage = 0;
    questionPages = [];
    fetchStudentQuestionsFirstPage();
  }).catch(() => { document.getElementById('submit-btn').disabled = false; });
}

function isMyQuestion(id) {
  if (!sessionCode) return false;
  const myQs = JSON.parse(sessionStorage.getItem(studentMyQsKey()) || '[]');
  return myQs.includes(id);
}

var studentUpvoteLocks = {};

function toggleUpvote(id) {
  if (!db || !sessionCode) {
    showToast('Not connected. Try refreshing the page.');
    return;
  }
  if (!id || studentUpvoteLocks[id]) return;
  const q = findStudentQuestionById(id);
  if (!q) {
    showToast('That question is not on this page anymore.');
    return;
  }
  studentPollSkipUntil = Date.now() + 1600;
  const voters = q.voters || [];
  const ref = db.collection('sessions').doc(sessionCode).collection('questions').doc(id);
  studentUpvoteLocks[id] = true;
  renderQuestions();
  var payload = voters.includes(userId)
    ? { votes: firebase.firestore.FieldValue.increment(-1), voters: firebase.firestore.FieldValue.arrayRemove(userId) }
    : { votes: firebase.firestore.FieldValue.increment(1), voters: firebase.firestore.FieldValue.arrayUnion(userId) };
  ref.update(payload)
    .then(function () {
      return new Promise(function (resolve) {
        setTimeout(resolve, 400);
      });
    })
    .then(function () {
      return fetchStudentQuestionsFirstPage();
    })
    .catch(function (err) {
      showToast((err && err.message) ? err.message : 'Could not update vote. Check your connection.');
    })
    .finally(function () {
      delete studentUpvoteLocks[id];
      renderQuestions();
      updateStats();
    });
}

function openEdit(id) {
  const q = findStudentQuestionById(id);
  if (!q) return;
  editingId = id;
  document.getElementById('edit-text').value = q.text;
  document.getElementById('edit-modal').classList.add('open');
}
function closeEdit() { document.getElementById('edit-modal').classList.remove('open'); editingId = null; }
function saveEdit() {
  const text = document.getElementById('edit-text').value.trim();
  if (!text || !editingId) return;
  if (!isMyQuestion(editingId)) { showToast('You can only edit your own questions.'); closeEdit(); return; }
  db.collection('sessions').doc(sessionCode).collection('questions').doc(editingId).update({ text }).then(() => {
    closeEdit();
    showToast('Question updated.');
    fetchStudentQuestionsFirstPage();
  });
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderQuestions();
}

function setSort(s, btn) {
  currentSort = s;
  document.querySelectorAll('#app-screen .side-col .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderQuestions();
}

function renderQuestions() {
  var searchQ = getStudentSearchQuery();
  var corpus = getAllCachedQuestionsForStats();
  let qs = searchQ ? filterQuestionsBySearchQuery(corpus, searchQ) : [...allQuestions];
  if (currentFilter === 'pinned') qs = qs.filter(q => q.pinned);
  if (currentFilter === 'answered') qs = qs.filter(q => q.status === 'answered');
  if (currentFilter === 'unanswered') qs = qs.filter(q => q.status !== 'answered');
  // sort pinned first always
  qs.sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (currentSort === 'votes') return (b.votes||0) - (a.votes||0);
    const at = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
    const bt = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
    return bt - at;
  });
  const list = document.getElementById('questions-list');
  if (!qs.length) {
    var emptyMsg = searchQ
      ? 'No matches in loaded questions. Load more pages or clear the search.'
      : 'No questions here yet.';
    list.innerHTML = '<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>' + emptyMsg + '</p></div>';
    return;
  }
  list.innerHTML = qs.map(q => {
    const mine = isMyQuestion(q.id);
    const voted = (q.voters||[]).includes(userId);
    const voting = !!studentUpvoteLocks[q.id];
    const badges = [];
    if (q.pinned) badges.push('<span class="q-badge badge-pinned">Pinned</span>');
    if (q.status === 'answered') badges.push('<span class="q-badge badge-answered">Answered</span>');
    else badges.push('<span class="q-badge badge-pending">Pending</span>');
    return `
    <div class="q-card ${q.pinned?'pinned':''} ${q.status==='answered'?'answered':''}">
      <div class="q-card-header">
        <div class="q-meta">
          <span class="q-author">${esc(q.authorName||'Anonymous')}</span>
          <span class="q-time" title="Posted time">${formatQuestionWhen(q.createdAt)}</span>
          ${badges.join('')}
        </div>
        ${mine ? `<button class="q-edit-btn" onclick="openEdit('${q.id}')">Edit</button>` : ''}
      </div>
      ${htmlQuestionBody(q)}
      ${htmlQuestionAttachedImages(q)}
      ${(() => {
        const answers = q.answers && q.answers.length ? q.answers : (q.answer ? [{ instructor: 'Instructor', text: q.answer }] : []);
        if (!answers.length) return '';
        return answers.map(a => `
          <div class="q-answer">
            <div class="q-answer-label">${esc(a.instructor||'Instructor')}</div>
            <div class="rich-message" style="white-space:pre-wrap;word-break:break-word;">${formatRichMessage(a.text||'')}</div>
            ${(Array.isArray(a.imageUrls) && a.imageUrls.length) ? '<div class="q-attached-images">' + a.imageUrls.filter(isHttpsUrl).map(function (u) {
              var safe = String(u).replace(/"/g, '');
              return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer"><img src="' + safe + '" alt="" loading="lazy" referrerpolicy="no-referrer"></a>';
            }).join('') + '</div>' : ''}
          </div>`).join('');
      })()}
      <div class="q-footer">
        <button type="button" class="upvote-btn ${voted?'upvoted':''}${voting?' loading':''}" data-qid="${esc(q.id)}" aria-label="${voting?'Saving vote…':'Upvote'}" aria-busy="${voting?'true':'false'}"${voting?' disabled':''}>
          <span class="upvote-spinner" aria-hidden="true"></span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${voted?'currentColor':'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          <span class="upvote-saving">Saving…</span>
          <span class="upvote-count">${q.votes||0}</span>
        </button>
      </div>
    </div>`;
  }).join('');
}

function setStudentStatHintAggregatesOk() {
  var el = document.getElementById('stat-scope-hint');
  if (el) el.textContent = 'Session-wide totals for this whole class (from Firestore). The list below still loads in pages (newest first).';
}

function setStudentStatHintFallback() {
  var el = document.getElementById('stat-scope-hint');
  if (el) el.textContent = 'Could not load session-wide totals. Showing counts from posts loaded in this browser only.';
}

function applyStudentStatCardsFromCache(qs) {
  document.getElementById('stat-total').textContent = qs.length;
  document.getElementById('stat-answered').textContent = qs.filter(function (q) { return q.status === 'answered'; }).length;
  document.getElementById('stat-pending').textContent = qs.filter(function (q) { return q.status === 'pending'; }).length;
  document.getElementById('stat-pinned').textContent = qs.filter(function (q) { return q.pinned; }).length;
}

function updateStats() {
  const qs = getAllCachedQuestionsForStats();
  updateQuestionPaginationUi();
  if (!db || !sessionCode) {
    applyStudentStatCardsFromCache(qs);
    var h = document.getElementById('stat-scope-hint');
    if (h) h.textContent = qs.length ? 'Connect to Firebase to load session-wide totals.' : '';
    return;
  }
  const serialAtStart = studentSessionStatsSerial;
  fetchSessionQuestionCountStats(sessionCode)
    .then(function (stats) {
      if (serialAtStart !== studentSessionStatsSerial) return;
      document.getElementById('stat-total').textContent = String(stats.total);
      document.getElementById('stat-answered').textContent = String(stats.answered);
      document.getElementById('stat-pending').textContent = String(stats.pending);
      document.getElementById('stat-pinned').textContent = String(stats.pinned);
      setStudentStatHintAggregatesOk();
    })
    .catch(function () {
      if (serialAtStart !== studentSessionStatsSerial) return;
      applyStudentStatCardsFromCache(qs);
      setStudentStatHintFallback();
    });
}

function insertSlackFormat(textareaId, mode) {
  var ta = document.getElementById(textareaId);
  if (!ta) return;
  var start = ta.selectionStart, end = ta.selectionEnd;
  var v = ta.value;
  var sel = v.slice(start, end);
  var ins, c0, c1;
  if (mode === 'fenced') {
    var openLen = '\n```\n'.length;
    if (sel) {
      ins = '\n```\n' + sel + '\n```\n';
      c0 = start + openLen;
      c1 = c0 + sel.length;
    } else {
      ins = '\n```\n\n```\n';
      c0 = c1 = start + openLen;
    }
    ta.value = v.slice(0, start) + ins + v.slice(end);
    ta.focus();
    ta.setSelectionRange(c0, c1);
    return;
  }
  var before, after, mid;
  switch (mode) {
    case 'bold': before = '*'; after = '*'; mid = sel || 'bold'; break;
    case 'italic': before = '_'; after = '_'; mid = sel || 'italic'; break;
    case 'strike': before = '~'; after = '~'; mid = sel || 'strikethrough'; break;
    case 'code': before = '`'; after = '`'; mid = sel || 'code'; break;
    default: return;
  }
  ins = before + mid + after;
  ta.value = v.slice(0, start) + ins + v.slice(end);
  ta.focus();
  var ns = start + before.length;
  var ne = ns + mid.length;
  ta.setSelectionRange(ns, ne);
}

/** Large Unicode emoji set — system font renders each; scroll for more. */
var FORMAT_EMOJI_PICKER_RAW = "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁☹😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁👅👄❤🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝💟☮✝☪🕉☸✡🔯🪄🪅🎴🎭🖼🎨🔮🧿🐵🐒🦍🦧🐶🐕🦮🐩🐺🦊🦝🐱🐈🦁🐯🐅🐆🐴🐎🦄🦓🦌🦬🐮🐂🐃🐄🐷🐖🐗🐽🐏🐑🐐🐪🐫🦙🦒🐘🦣🦏🦛🐭🐁🐀🐹🐰🐇🐿🦫🦔🦇🐻🐨🐼🐾🦃🐔🐓🐣🐤🐥🐦🐧🕊🦅🦆🦢🦉🦤🪶🦩🦚🦜🐸🐊🐢🦎🐍🐲🐉🦕🦖🐳🐋🐬🦭🐟🐠🐡🦈🐙🐚🪸🐌🦋🐛🐜🐝🪲🐞🦗🪳🕷🕸🦂🦟🪰🪱🦠💐🌸💮🌹🥀🌺🌻🌼🌷🪻🌱🪴🌲🌳🌴🌵🌾🌿☘🍀🍁🍂🍃🪹🪺🍄🍇🍈🍉🍊🍋🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🥥🥑🍆🥔🥕🌽🌶🫑🥒🥬🥦🧄🧅🥜🫘🌰🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🦀🦞🦐🦑🦪🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🥤🧋🧃🧉🧊🥢🍽🍴🥄🔪🫙🌍🌎🌏🌐🗺🧭🏔⛰🌋🗻🏕🏖🏜🏝🏞🏟🏛🏗🧱🪨🪵🛖🏘🏚🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬🏭🏯🏰💒🗼🗽⛪🕌🛕🕍⛩🕋⛲⛺🌁🌃🌄🌅🌆🌇🌉♨🎠🛝🎡🎢💈🎪🚂🚃🚄🚅🚆🚇🚈🚉🚊🚝🚞🚋🚌🚍🚎🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🛻🚚🚛🚜🏎🏍🛵🦽🦼🛺🚲🛴🛹🛼🚏🛣🛤⛽🚨🚥🚦🛑🚧⚓🛟⛵🛶🚤🛳⛴🛥🚢✈🛩🛫🛬🪂💺🚁🚟🚠🚡🛰🚀🛸🪐🌠🌌⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛷⛸🥌🎿⛷🏂🏋🤼🤸🤺⛹🤹🧘🏌🏇🧗🚵🚴🏆🥇🥈🥉🏅🎖🏵🎗🎫🎟🩰🎬🎤🎧🎼🎹🥁🪘🎷🎺🎸🪕🎻🪈🎲♟🎯🎳🎮🕹🎰🧩📱📲☎📞📟📠🔋🪫🔌💻🖥🖨⌨🖱🖲💽💾💿📀🧮🎥🎞📽📺📷📸📹📼🔍🔎🕯💡🔦🏮🪔📔📕📖📗📘📙📚📓📒📃📜📄📰🗞📑🔖🏷💰🪙💴💵💶💷💸💳🧾✉📧📨📩📤📥📦📫📪📬📭📮🗳✏✒🖋🖊🖌🖍📝💼📁📂🗂📅📆🗒🗓📇📈📉📊📋📌📍📎🖇📏📐✂🗃🗄🗑🔒🔓🔏🔐🔑🗝🔨🪓⛏⚒🛠🗡⚔🔫🛡🔧🪛🔩⚙🗜⚖🦯🔗⛓🪝🧰🧲🪜💯💢💥💫💦💨🕳💬🗨🗯💭💤🔔🔕📣📢📿🏧🚮🚰♿🚹🚺🚻🚼🚾🛂🛃🛄🛅⚠🚸⛔🚫🚳🚭🚯🚱🚷📵🔞☢☣⬆↗➡↘⬇↙⬅↖↕↔↩↪⤴⤵🔃🔄🔙🔚🔛🔜🔝🛐⚛☯🕎♈♉♊♋♌♍♎♏♐♑♒♓⛎🔀🔁🔂▶⏩⏭⏯◀⏪⏮🔼⏫🔽⏬⏸⏹⏺⏏🎦🔅🔆📶📳📴♀♂⚧✖➕➖➗🟰♾‼⁉❓❔❕❗〰💱💲⚕♻❇✳❎🆎🆑🆘📛🔠🔡🔢🔣🔤⌚⏰⏱⏲🕰🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕡🕖🕢🕗🕣🕘🕤🕙🕥🕚🕦🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞⭐🌟☀🌤⛅🌥☁🌦🌧⛈🌩🌨❄☃⛄🌬🌪🌫🌈☂☔⛱⚡🔥💧🌊🎃🎄🎆🎇🧨✨🎈🎉🎊🎋🎍🎎🎏🎐🎑🧧🎀🎁🧸🪆🃏🀄";
var FORMAT_EMOJI_PICKER_CHARS = Array.from(FORMAT_EMOJI_PICKER_RAW);

function escFmtAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function ensureFmtEmojiGridShell(grid) {
  if (!grid || !grid.parentNode) return null;
  var existing = grid.closest('.fmt-emoji-grid-shell');
  if (existing) {
    var det0 = grid.closest('details.fmt-emoji-more') || existing._fmtEmojiDetails;
    if (det0) {
      det0._fmtEmojiShell = existing;
      existing._fmtEmojiDetails = det0;
    }
    return existing;
  }
  var shell = document.createElement('div');
  shell.className = 'fmt-emoji-grid-shell';
  var top = document.createElement('div');
  top.className = 'fmt-emoji-scroll-hint fmt-emoji-scroll-hint--top is-hidden';
  top.setAttribute('aria-hidden', 'true');
  top.textContent = '\u25B2';
  top.title = 'More emojis above — scroll up';
  var bot = document.createElement('div');
  bot.className = 'fmt-emoji-scroll-hint fmt-emoji-scroll-hint--bottom is-hidden';
  bot.setAttribute('aria-hidden', 'true');
  bot.textContent = '\u25BC';
  bot.title = 'More emojis below — scroll down';
  var parent = grid.parentNode;
  parent.insertBefore(shell, grid);
  shell.appendChild(top);
  shell.appendChild(grid);
  shell.appendChild(bot);
  var det = grid.closest('details.fmt-emoji-more');
  if (det) {
    det._fmtEmojiShell = shell;
    shell._fmtEmojiDetails = det;
  }
  return shell;
}

function getFmtEmojiGridForDetails(details) {
  if (!details) return null;
  if (details._fmtEmojiShell) return details._fmtEmojiShell.querySelector('.fmt-emoji-grid');
  return details.querySelector('.fmt-emoji-grid');
}

function mountFmtEmojiShellToBody(details) {
  if (!details || !details.open) return;
  var grid = getFmtEmojiGridForDetails(details);
  if (!grid) return;
  ensureFmtEmojiGridShell(grid);
  var shell = details._fmtEmojiShell;
  if (!shell || shell.parentNode === document.body) return;
  document.body.appendChild(shell);
}

function updateFmtEmojiGridOverflowClasses(grid) {
  if (!grid || !grid.isConnected) return;
  var sh = grid.scrollHeight;
  var ch = grid.clientHeight;
  var EPS = 4;
  var hasMore = sh > ch + EPS;
  grid.classList.toggle('fmt-emoji-grid--has-overflow', hasMore);
  var atEnd = grid.scrollTop + ch >= sh - EPS;
  grid.classList.toggle('fmt-emoji-grid--scrolled-end', atEnd);
  var atStart = grid.scrollTop <= EPS;
  var shell = grid.closest('.fmt-emoji-grid-shell');
  var hintTop = shell && shell.querySelector('.fmt-emoji-scroll-hint--top');
  var hintBot = shell && shell.querySelector('.fmt-emoji-scroll-hint--bottom');
  if (hintTop) {
    hintTop.classList.toggle('is-hidden', !hasMore);
    hintTop.classList.toggle('fmt-emoji-scroll-hint--dim', hasMore && atStart);
    hintTop.title = hasMore && atStart ? 'Top of the list' : 'More emojis above — scroll up';
  }
  if (hintBot) {
    hintBot.classList.toggle('is-hidden', !hasMore);
    hintBot.classList.toggle('fmt-emoji-scroll-hint--dim', hasMore && atEnd);
    hintBot.title = hasMore && atEnd ? 'End of the list' : 'More emojis below — scroll down';
  }
  grid.classList.toggle('fmt-emoji-grid--hint-up', hasMore && !atStart);
  grid.classList.toggle('fmt-emoji-grid--hint-down', hasMore && !atEnd);
}

function bindFmtEmojiGridResizeObserver(grid) {
  if (!grid || grid._fmtEmojiRo || typeof ResizeObserver === 'undefined') return;
  var ro = new ResizeObserver(function () {
    updateFmtEmojiGridOverflowClasses(grid);
  });
  grid._fmtEmojiRo = ro;
  ro.observe(grid);
  var shell = grid.closest('.fmt-emoji-grid-shell');
  if (shell) ro.observe(shell);
}

function clearFmtEmojiGridDock(grid) {
  if (!grid) return;
  var shell = grid.closest('.fmt-emoji-grid-shell');
  if (shell && shell.parentNode === document.body && shell._fmtEmojiDetails) {
    var det = shell._fmtEmojiDetails;
    var sum = det.querySelector('summary.fmt-more-summary');
    if (sum) det.insertBefore(shell, sum.nextSibling);
    else det.appendChild(shell);
  }
  if (grid._fmtEmojiRo) {
    grid._fmtEmojiRo.disconnect();
    grid._fmtEmojiRo = null;
  }
  var dock = shell || grid;
  ['position', 'top', 'right', 'bottom', 'left', 'width', 'maxHeight', 'zIndex', 'margin', 'marginTop', 'marginBottom'].forEach(function (p) {
    try { dock.style.removeProperty(p); } catch (e) {}
  });
  grid.classList.remove(
    'fmt-emoji-grid--flip-above',
    'fmt-emoji-grid--has-overflow',
    'fmt-emoji-grid--scrolled-end',
    'fmt-emoji-grid--hint-up',
    'fmt-emoji-grid--hint-down'
  );
  if (shell) {
    shell.classList.remove('fmt-emoji-grid-shell--flip-above');
    shell.querySelectorAll('.fmt-emoji-scroll-hint').forEach(function (el) {
      el.classList.add('is-hidden');
      el.classList.remove('fmt-emoji-scroll-hint--dim');
    });
  }
}

var EMOJI_PANEL_PREFERRED_PX = 380;

function positionFmtEmojiMore(details) {
  if (!details || !details.open) return;
  var grid = getFmtEmojiGridForDetails(details);
  var sum = details.querySelector('summary');
  if (!grid || !sum) return;
  ensureFmtEmojiGridShell(grid);
  var shell = grid.closest('.fmt-emoji-grid-shell');
  var dock = shell || grid;
  ['position', 'top', 'right', 'bottom', 'left', 'width', 'maxHeight', 'zIndex', 'margin', 'marginTop', 'marginBottom'].forEach(function (p) {
    try { grid.style.removeProperty(p); } catch (e) {}
  });

  var rect = sum.getBoundingClientRect();
  var gap = 8;
  var vwPad = 8;
  var vh = window.innerHeight;
  var vw = window.innerWidth;
  /* Viewport only — picker is position:fixed; clamping to .q-card made it tiny inside cards. */
  var belowSlice = vh - rect.bottom - gap - vwPad;
  var aboveSlice = rect.top - gap - vwPad;
  var panelMax = Math.min(480, vh * 0.62);
  var preferBelow = belowSlice >= Math.min(panelMax, 220) || (belowSlice >= aboveSlice && belowSlice >= 100);
  grid.classList.remove('fmt-emoji-grid--flip-above');
  if (shell) shell.classList.remove('fmt-emoji-grid-shell--flip-above');

  var w = Math.min(380, vw - vwPad * 2);
  var left = rect.right - w;
  left = Math.max(vwPad, Math.min(left, vw - w - vwPad));

  var preferredH = Math.min(EMOJI_PANEL_PREFERRED_PX, panelMax);
  var capPx;
  if (preferBelow) {
    capPx = Math.max(48, Math.min(preferredH, belowSlice));
    dock.style.position = 'fixed';
    dock.style.left = left + 'px';
    dock.style.right = 'auto';
    dock.style.width = w + 'px';
    dock.style.top = (rect.bottom + gap) + 'px';
    dock.style.bottom = 'auto';
  } else {
    capPx = Math.max(48, Math.min(preferredH, aboveSlice));
    dock.style.position = 'fixed';
    dock.style.left = left + 'px';
    dock.style.right = 'auto';
    dock.style.width = w + 'px';
    dock.style.top = 'auto';
    dock.style.bottom = (vh - rect.top + gap) + 'px';
  }
  dock.style.maxHeight = capPx + 'px';
  dock.style.zIndex = '12000';
  dock.style.margin = '0';
  requestAnimationFrame(function () { updateFmtEmojiGridOverflowClasses(grid); });
}

function disconnectFmtEmojiSummaryObserver(details) {
  var sum = details && details.querySelector('summary.fmt-more-summary');
  if (sum && sum._fmtEmojiIo) {
    sum._fmtEmojiIo.disconnect();
    sum._fmtEmojiIo = null;
  }
}

function initFmtEmojiPickerLayout() {
  var rafRe = 0;
  function scheduleEmojiPickerReposition() {
    cancelAnimationFrame(rafRe);
    rafRe = requestAnimationFrame(function () {
      document.querySelectorAll('details.fmt-emoji-more[open]').forEach(positionFmtEmojiMore);
      document.querySelectorAll('details.fmt-emoji-more[open]').forEach(function (det) {
        var g = getFmtEmojiGridForDetails(det);
        if (g) updateFmtEmojiGridOverflowClasses(g);
      });
    });
  }

  document.addEventListener('toggle', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('details.fmt-emoji-more')) return;
    var g = t.querySelector('.fmt-emoji-grid');
    if (!t.open) {
      disconnectFmtEmojiSummaryObserver(t);
      clearFmtEmojiGridDock(getFmtEmojiGridForDetails(t));
      return;
    }
    requestAnimationFrame(function () {
      var sum = t.querySelector('summary.fmt-more-summary');
      if (sum && typeof IntersectionObserver !== 'undefined') {
        disconnectFmtEmojiSummaryObserver(t);
        var th = [];
        for (var i = 0; i <= 20; i++) th.push(i / 20);
        sum._fmtEmojiIo = new IntersectionObserver(
          function () { scheduleEmojiPickerReposition(); },
          { root: null, threshold: th }
        );
        sum._fmtEmojiIo.observe(sum);
      }
      if (g) ensureFmtEmojiGridShell(g);
      mountFmtEmojiShellToBody(t);
      positionFmtEmojiMore(t);
      var g2 = getFmtEmojiGridForDetails(t);
      if (!g2) return;
      updateFmtEmojiGridOverflowClasses(g2);
      bindFmtEmojiGridResizeObserver(g2);
      if (!g2._fmtEmojiScrollBound) {
        g2._fmtEmojiScrollBound = true;
        g2.addEventListener('scroll', function () { updateFmtEmojiGridOverflowClasses(g2); }, { passive: true });
      }
    });
  }, true);

  var cap = { passive: true, capture: true };
  window.addEventListener('scroll', scheduleEmojiPickerReposition, cap);
  document.addEventListener('scroll', scheduleEmojiPickerReposition, cap);
  window.addEventListener('resize', scheduleEmojiPickerReposition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('scroll', scheduleEmojiPickerReposition, { passive: true });
    window.visualViewport.addEventListener('resize', scheduleEmojiPickerReposition, { passive: true });
  }
}

function fillFmtEmojiPickerGrids() {
  document.querySelectorAll('.fmt-emoji-grid[data-emoji-picker-autofill]').forEach(function (grid) {
    var tid = grid.getAttribute('data-emoji-target-id');
    if (!tid) return;
    ensureFmtEmojiGridShell(grid);
    grid.innerHTML = FORMAT_EMOJI_PICKER_CHARS.map(function (ch) {
      return '<button type="button" class="fmt-btn fmt-emoji fmt-emoji-picker-cell" data-emoji-target="' + escFmtAttr(tid) + '" data-ch="' + escFmtAttr(ch) + '" title="Insert" aria-label="Insert emoji">' + ch + '</button>';
    }).join('');
    requestAnimationFrame(function () {
      var shell = grid.closest('.fmt-emoji-grid-shell');
      var det = (shell && shell._fmtEmojiDetails) || grid.closest('details.fmt-emoji-more');
      if (det && det.open) {
        mountFmtEmojiShellToBody(det);
        positionFmtEmojiMore(det);
      }
      updateFmtEmojiGridOverflowClasses(grid);
      bindFmtEmojiGridResizeObserver(grid);
    });
  });
}

function insertEmoji(textareaId, ch) {
  var ta = document.getElementById(textareaId);
  if (!ta || ch == null) return;
  ch = String(ch);
  var start = ta.selectionStart, end = ta.selectionEnd;
  var v = ta.value;
  ta.value = v.slice(0, start) + ch + v.slice(end);
  ta.focus();
  var p = start + ch.length;
  ta.setSelectionRange(p, p);
}

function closeFmtEmojiDetails(detailsId) {
  var d = document.getElementById(detailsId);
  if (d) d.open = false;
}

// Enter key on code input
document.addEventListener('DOMContentLoaded', () => {
  initFmtEmojiPickerLayout();
  fillFmtEmojiPickerGrids();
  document.getElementById('code-input').addEventListener('keydown', e => { if (e.key==='Enter') joinSession(); });
  document.getElementById('code-input').addEventListener('input', function () {
    var el = this;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var next = el.value.toUpperCase();
    if (el.value === next) return;
    el.value = next;
    if (start != null && end != null) {
      try {
        var len = next.length;
        el.setSelectionRange(Math.min(start, len), Math.min(end, len));
      } catch (e) {}
    }
  });
  var qt = document.getElementById('q-text');
  if (qt) qt.addEventListener('paste', onQuestionTextPaste);
  var qListHost = document.getElementById('questions-list');
  if (qListHost && !qListHost.dataset.upvoteDelegate) {
    qListHost.dataset.upvoteDelegate = '1';
    qListHost.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('.upvote-btn');
      if (!btn) return;
      var id = btn.getAttribute('data-qid');
      if (id == null || id === '') return;
      e.preventDefault();
      toggleUpvote(id);
    }, true);
  }
  var studentSearchTimer = null;
  var qSearch = document.getElementById('questions-search');
  if (qSearch) {
    qSearch.addEventListener('input', function () {
      clearTimeout(studentSearchTimer);
      studentSearchTimer = setTimeout(function () {
        renderQuestions();
        updateQuestionPaginationUi();
      }, 200);
    });
  }
  document.body.addEventListener('click', function (e) {
    var pick = e.target.closest && e.target.closest('.fmt-emoji-picker-cell[data-emoji-target]');
    if (pick) {
      e.preventDefault();
      var tid = pick.getAttribute('data-emoji-target');
      var ch = pick.getAttribute('data-ch');
      if (tid && ch != null) insertEmoji(tid, ch);
      var shellPick = pick.closest('.fmt-emoji-grid-shell');
      var detPick = (shellPick && shellPick._fmtEmojiDetails) || pick.closest('details');
      if (detPick) detPick.open = false;
      return;
    }
    var btn = e.target.closest && e.target.closest('.rich-copy-btn');
    if (!btn) return;
    e.preventDefault();
    runCopyRichCodeBlock(btn, showToast);
  });
  function closeFmtEmojiPickersIfOutside(e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    document.querySelectorAll('details.fmt-emoji-more[open]').forEach(function (d) {
      if (d.contains(t)) return;
      var shell = d._fmtEmojiShell;
      if (shell && shell.contains(t)) return;
      d.open = false;
    });
  }
  document.addEventListener('pointerdown', closeFmtEmojiPickersIfOutside, true);
  document.addEventListener('touchstart', closeFmtEmojiPickersIfOutside, { capture: true, passive: true });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('details.fmt-emoji-more[open]').forEach(function (d) { d.open = false; });
  });
});

Object.assign(globalThis, {
  joinSession,
  leaveSession,
  insertSlackFormat,
  insertEmoji,
  toggleAnon,
  submitQuestion,
  clearStudentSearch,
  studentRefreshNow,
  setFilter,
  setSort,
  closeEdit,
  saveEdit,
  goStudentPreviousPage,
  goStudentToPage,
  goStudentNextPage,
  openEdit,
});
