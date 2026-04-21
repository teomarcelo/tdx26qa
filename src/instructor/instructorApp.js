import firebase from '../lib/firebaseCompat.js';
import { FIREBASE_CONFIG } from '../config/firebase.js';
import { QUESTIONS_PAGE_SIZE } from '../constants/app.js';
import { INSTRUCTOR_PIN_PEPPER } from '../constants/auth.js';
import { esc, formatRichMessage, isHttpsUrl, copyRichCodeBlock } from '../lib/richText.js';
import { createShowToast } from '../lib/toast.js';
import { formatQuestionWhen } from '../lib/formatQuestionWhen.js';
import { filterCorpusByFuseSearch } from '../lib/questionSearch.js';
import { fetchSessionQuestionCountStats } from '../lib/sessionQuestionCounts.js';

const showToast = createShowToast('toast');
function copyRichCodeBlockInstr(btn) {
  copyRichCodeBlock(btn, showToast);
}
/** Remember last opened session across hard refresh (cleared on logout / deselect). */
const INSTR_ACTIVE_SESSION_KEY = 'sqa_instructor_active_session';
const INSTR_ACTIVE_SESSION_LEGACY = 'tdx_instructor_active_session';
/** Full onboarding welcome in the questions panel only after logout, new registration, or clearing the active session from the list. */
const INSTR_ONBOARDING_WELCOME_KEY = 'sqa_instructor_onboarding_welcome';
const INSTR_ONBOARDING_LEGACY = 'tdx_instructor_onboarding_welcome';
const INSTR_NAME_KEY = 'sqa_instructor_name';
const INSTR_NAME_LEGACY = 'tdx_instructor_name';
const INSTR_DEMO_FLAG = 'sqa_is_demo';
const INSTR_DEMO_LEGACY = 'tdx_is_demo';
const DEMO_SESSIONS_HIDDEN_KEY = 'sqa_sessions_hidden_demo';
const DEMO_SESSIONS_HIDDEN_LEGACY = 'tdx_sessions_hidden_demo';

function readInstructorActiveSessionFromStorage() {
  try {
    let v = sessionStorage.getItem(INSTR_ACTIVE_SESSION_KEY);
    if (v) return v;
    v = sessionStorage.getItem(INSTR_ACTIVE_SESSION_LEGACY);
    if (v) {
      sessionStorage.setItem(INSTR_ACTIVE_SESSION_KEY, v);
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
    }
    return v;
  } catch (e) { return null; }
}

function readInstructorNameFromStorage() {
  try {
    let v = sessionStorage.getItem(INSTR_NAME_KEY);
    if (v) return v;
    v = sessionStorage.getItem(INSTR_NAME_LEGACY);
    if (v) {
      sessionStorage.setItem(INSTR_NAME_KEY, v);
      sessionStorage.removeItem(INSTR_NAME_LEGACY);
    }
    return v;
  } catch (e) { return null; }
}
function writeInstructorNameToStorage(name) {
  try {
    sessionStorage.setItem(INSTR_NAME_KEY, name);
    sessionStorage.removeItem(INSTR_NAME_LEGACY);
  } catch (e) {}
}
function readIsDemoFromStorage() {
  try {
    let v = sessionStorage.getItem(INSTR_DEMO_FLAG);
    if (v != null) return v;
    v = sessionStorage.getItem(INSTR_DEMO_LEGACY);
    if (v != null) {
      sessionStorage.setItem(INSTR_DEMO_FLAG, v);
      sessionStorage.removeItem(INSTR_DEMO_LEGACY);
    }
    return v;
  } catch (e) { return null; }
}
function writeIsDemoToStorage(val) {
  try {
    sessionStorage.setItem(INSTR_DEMO_FLAG, val);
    sessionStorage.removeItem(INSTR_DEMO_LEGACY);
  } catch (e) {}
}
function clearInstructorBrowserSessionKeys() {
  try {
    sessionStorage.removeItem(INSTR_NAME_KEY);
    sessionStorage.removeItem(INSTR_NAME_LEGACY);
    sessionStorage.removeItem(INSTR_DEMO_FLAG);
    sessionStorage.removeItem(INSTR_DEMO_LEGACY);
  } catch (e) {}
}

function instructorOnboardingWelcomePending() {
  try {
    if (sessionStorage.getItem(INSTR_ONBOARDING_WELCOME_KEY) === '1') return true;
    if (sessionStorage.getItem(INSTR_ONBOARDING_LEGACY) === '1') {
      sessionStorage.setItem(INSTR_ONBOARDING_WELCOME_KEY, '1');
      sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
      return true;
    }
    return false;
  } catch (e) { return false; }
}
function clearInstructorOnboardingWelcomeFlag() {
  try {
    sessionStorage.removeItem(INSTR_ONBOARDING_WELCOME_KEY);
    sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
  } catch (e) {}
}

function persistInstructorActiveSession(code) {
  try {
    if (code) {
      sessionStorage.setItem(INSTR_ACTIVE_SESSION_KEY, code);
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
    } else {
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_KEY);
      sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
    }
  } catch (e) {}
}

function tryRestoreInstructorActiveSessionFromList() {
  if (isDemoMode || activeSessionCode) return;
  let saved = null;
  try { saved = readInstructorActiveSessionFromStorage(); } catch (e) { return; }
  if (!saved) return;
  if (!allSessions.length) {
    return;
  }
  if (allSessions.some(s => s.id === saved)) {
    selectSession(saved);
    return;
  }
  try {
    sessionStorage.removeItem(INSTR_ACTIVE_SESSION_KEY);
    sessionStorage.removeItem(INSTR_ACTIVE_SESSION_LEGACY);
  } catch (e) {}
}

let db, storage = null, activeSessionCode = null, allQuestions = [];
let currentFilter = 'all', currentSort = 'recent';
let deleteTargetId = null, unsubQuestions = null, unsubSession = null;
let allSessions = [], currentInstructor = null, isDemoMode = false;
/** After first Firestore merge for "My sessions" (avoids treating pre-load as an empty list). */
let instructorSessionsHydrated = false;
let questionPages = [];
let currentQuestionPage = 0;
let hasMoreOlder = false, questionsLoading = false;
/** True when there are no further question docs in Firestore beyond cached pages (short last page or empty older fetch). */
let instructorOlderBeyondLoadExhausted = false;
/** Cancels stale Firestore aggregate stat requests when switching sessions. */
let instructorSessionStatsSerial = 0;
let instructorStatsAggTimer = null;
const answerDrafts = {};
const pendingAnswerImages = {};

const DEMO_SESSION_CODE = 'SQA-DEMO';
const DEMO_SESSION = {
  id: DEMO_SESSION_CODE,
  className: 'Agentforce Instructor Series',
  sessionName: 'Agentforce Fundamentals — Track A',
  instructors: [],
  instructorNames: '',
  sessionDate: 'Apr 10, 2026',
  sessionTime: '10:00 AM',
  room: 'Hall D — Room 214',
  description: 'Intro to Agentforce: architecture, agent types, and how to build your first autonomous agent without code.',
  sessionNoteShow: true,
  sessionNoteTitle: 'Quick links',
  sessionNoteBody: 'Example: https://trailhead.salesforce.com — appears under Session for students.',
  sessionNoteImageUrls: []
};
const DEMO_QUESTIONS_TEMPLATE = [
  { id:'dq1', pinned:true,  status:'pending',  authorName:'Maria S.',  authorEmail:'maria@trailblazer.io', authorId:'u1', votes:7,  voters:[], answer:'',
    text:'Can Agentforce agents trigger flows mid-conversation, or does the flow have to be invoked at the start of the action?' },
  { id:'dq2', pinned:false, status:'answered', authorName:'James K.',  authorEmail:'james@company.com',    authorId:'u2', votes:4,  voters:[], answer:"Great question! Agent Actions are the atomic steps an agent can take — think of them as the agent's toolkit. Flows are one type of action the agent can call.",
    text:"What's the difference between an Agent Action and a Flow in this context? They seem to overlap." },
  { id:'dq3', pinned:false, status:'answered', authorName:'Anonymous', authorEmail:'',                     authorId:'u3', votes:2,  voters:[], answer:"Currently the limit is 50 topics per agent in the Spring '26 release.",
    text:'Is there a limit on how many topics a single agent can handle?' },
  { id:'dq4', pinned:false, status:'pending',  authorName:'Priya M.',  authorEmail:'priya@sf-partner.com', authorId:'u4', votes:3,  voters:[], answer:'',
    text:'Do you need a specific Salesforce license to use Agentforce, or is it included with Enterprise?' },
  { id:'dq5', pinned:false, status:'pending',  authorName:'Daniel R.', authorEmail:'',                     authorId:'u5', votes:1,  voters:[], answer:'',
    text:'Can we use custom LLMs with Agentforce or is it locked to the Einstein models?' },
];

function instructorWelcomeQuestionsHtml() {
  const t = document.getElementById('tmpl-instructor-welcome');
  const inner = t && t.innerHTML ? String(t.innerHTML).trim() : '';
  return inner || '<div class="empty-state instructor-welcome"><p class="instructor-welcome-lead">Select a session from <strong>My sessions</strong> to continue.</p></div>';
}

function instructorCompactSelectSessionHtml() {
  return '<div class="empty-state instructor-welcome"><p class="instructor-welcome-lead">Select a session from <strong>My sessions</strong> to continue.</p></div>';
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SQA-';
  for (let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function toggleSection(id) {
  document.getElementById(id).classList.toggle('collapsed');
}

function addInstructor() {
  const input = document.getElementById('new-instructor-input');
  const name = input.value.trim();
  if (!name) return;
  if (!activeSessionCode) { showToast('Select a session first.'); return; }
  const s = allSessions.find(x => x.id === activeSessionCode);
  if (!s) return;
  const instructors = s.instructors ? [...s.instructors] : (s.instructorNames ? s.instructorNames.split(',').map(n=>n.trim()).filter(Boolean) : []);
  if (instructors.includes(name)) { showToast('Already added.'); return; }
  instructors.push(name);
  if (isDemoMode) {
    s.instructors = instructors; s.instructorNames = instructors.join(', ');
    renderInstructorList(instructors); showToast(name + ' added!'); input.value = ''; return;
  }
  db.collection('sessions').doc(activeSessionCode).update({ instructors, instructorNames: instructors.join(', ') }).then(() => {
    s.instructors = instructors; s.instructorNames = instructors.join(', ');
    renderInstructorList(instructors); showToast(name + ' added!'); input.value = '';
  });
}

function removeInstructor(name) {
  if (!activeSessionCode) return;
  const s = allSessions.find(x => x.id === activeSessionCode);
  if (!s) return;
  const instructors = (s.instructors ? [...s.instructors] : (s.instructorNames ? s.instructorNames.split(',').map(n=>n.trim()).filter(Boolean) : [])).filter(n => n !== name);
  if (isDemoMode) {
    s.instructors = instructors; s.instructorNames = instructors.join(', ');
    renderInstructorList(instructors); showToast(name + ' removed.'); return;
  }
  db.collection('sessions').doc(activeSessionCode).update({ instructors, instructorNames: instructors.join(', ') }).then(() => {
    s.instructors = instructors; s.instructorNames = instructors.join(', ');
    renderInstructorList(instructors); showToast(name + ' removed.');
  });
}

function renderInstructorList(instructors) {
  const el = document.getElementById('instructor-list');
  if (!el) return;
  if (!instructors || !instructors.length) {
    el.innerHTML = '<div style="font-size:0.82rem;color:var(--text-light);text-align:center;padding:0.5rem 0">No instructors added yet</div>';
    return;
  }
  el.innerHTML = instructors.map(name => `
    <div class="instructor-chip">
      <span class="instructor-chip-name">${esc(name)}</span>
      <button class="instructor-chip-remove" onclick="removeInstructor('${esc(name).replace(/'/g,"\\'")}')">×</button>
    </div>`).join('');
}

// Simple hash — not cryptographic, but prevents plain-text storage (salt prefix unchanged for existing accounts)
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(INSTRUCTOR_PIN_PEPPER + pin));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function nameToId(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

window.addEventListener('load', () => {
  // Only init Firebase if config has been filled in
  const configReady = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
  if (configReady) {
    try {
      db = firebase.firestore();
      if (firebase.storage) storage = firebase.storage();
    } catch (e) { console.warn('Firebase init failed:', e); }
  }
  document.addEventListener('paste', onAnswerBoxPaste, true);
  const savedName = readInstructorNameFromStorage();
  const savedDemo = readIsDemoFromStorage();
  if (savedName) {
    currentInstructor = savedName;
    if (savedDemo === 'true') isDemoMode = true;
    showDashboard();
  }
});

function switchMode(mode) {
  document.getElementById('mode-signin').style.display = mode === 'signin' ? 'block' : 'none';
  document.getElementById('mode-register').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
}

async function instructorLogin() {
  const name = document.getElementById('signin-name').value.trim();
  const pin = document.getElementById('signin-pin').value;
  const errEl = document.getElementById('login-error');
  if (!name) { errEl.textContent = 'Please enter your name.'; return; }
  if (!pin) { errEl.textContent = 'Please enter your PIN.'; return; }
  const id = nameToId(name);
  try {
    const doc = await db.collection('instructors').doc(id).get();
    if (!doc.exists) { errEl.textContent = 'No account found. Create one below.'; return; }
    const stored = doc.data();
    const hash = await hashPin(pin);
    if (hash !== stored.pinHash) { errEl.textContent = 'Incorrect PIN. Try again.'; return; }
    currentInstructor = stored.displayName;
    writeInstructorNameToStorage(currentInstructor);
    showDashboard();
  } catch(e) { errEl.textContent = 'Connection error. Please try again.'; }
}

async function instructorRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const pin = document.getElementById('reg-pin').value;
  const pin2 = document.getElementById('reg-pin2').value;
  const errEl = document.getElementById('register-error');
  if (!name) { errEl.textContent = 'Please enter your name.'; return; }
  if (pin.length < 4) { errEl.textContent = 'PIN must be at least 4 characters.'; return; }
  if (pin !== pin2) { errEl.textContent = 'PINs do not match.'; return; }
  const id = nameToId(name);
  try {
    const existing = await db.collection('instructors').doc(id).get();
    if (existing.exists) { errEl.textContent = 'An account with that name already exists. Sign in instead.'; return; }
    const hash = await hashPin(pin);
    await db.collection('instructors').doc(id).set({
      displayName: name,
      pinHash: hash,
      sessionsHiddenFromList: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    currentInstructor = name;
    writeInstructorNameToStorage(currentInstructor);
    try {
      sessionStorage.setItem(INSTR_ONBOARDING_WELCOME_KEY, '1');
      sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
    } catch (e) {}
    showDashboard();
  } catch(e) { errEl.textContent = 'Error creating account. Please try again.'; }
}

function instructorLogout() {
  instructorSessionStatsSerial++;
  clearTimeout(instructorStatsAggTimer);
  instructorStatsAggTimer = null;
  try {
    sessionStorage.setItem(INSTR_ONBOARDING_WELCOME_KEY, '1');
    sessionStorage.removeItem(INSTR_ONBOARDING_LEGACY);
  } catch (e) {}
  clearInstructorBrowserSessionKeys();
  persistInstructorActiveSession(null);
  currentInstructor = null;
  isDemoMode = false;
  studentViewOpen = false;
  activeSessionCode = null;
  allSessions = [];
  allQuestions = [];
  questionPages = [];
  currentQuestionPage = 0;
  hasMoreOlder = false;
  instructorOlderBeyondLoadExhausted = false;
  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  if (unsubSession) { unsubSession(); unsubSession = null; }
  // reset UI
  document.getElementById('student-demo-panel').style.display = 'none';
  document.getElementById('student-view-btn').style.display = 'none';
  syncActiveCodeBadge();
  document.getElementById('session-dependent-sections').style.display = 'none';
  document.getElementById('sessions-list').innerHTML = '';
  document.getElementById('questions-list').innerHTML = instructorCompactSelectSessionHtml();
  updateInstructorPaginationUi();
  document.getElementById('instructor-list').innerHTML = '<div style="font-size:0.82rem;color:var(--text-light);text-align:center;padding:0.5rem">No instructors added yet</div>';
  document.getElementById('instructor-name-bar').textContent = '';
  // reset stats
  ['stat-total','stat-answered','stat-pending','stat-pinned','fc-all','fc-pinned','fc-pending','fc-answered'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '0';
  });
  const scopeHint = document.getElementById('instr-stat-scope-hint');
  if (scopeHint) scopeHint.textContent = '';
  document.documentElement.classList.remove('instr-restoring-session');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('signin-name').value = '';
  document.getElementById('signin-pin').value = '';
  const logoutSearch = document.getElementById('instr-questions-search');
  if (logoutSearch) logoutSearch.value = '';
  switchMode('signin');
}

function enterDemoMode() {
  isDemoMode = true;
  currentInstructor = 'Alex Rivera (Demo)';
  writeInstructorNameToStorage(currentInstructor);
  writeIsDemoToStorage('true');
  showDashboard();
}

function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  document.documentElement.classList.remove('instr-restoring-session');
  instructorSessionStatsSerial++;
  clearTimeout(instructorStatsAggTimer);
  instructorStatsAggTimer = null;
  // reset session state for fresh login
  activeSessionCode = null;
  allSessions = [];
  allQuestions = [];
  questionPages = [];
  currentQuestionPage = 0;
  hasMoreOlder = false;
  instructorOlderBeyondLoadExhausted = false;
  Object.keys(answerDrafts).forEach(k => { delete answerDrafts[k]; });
  Object.keys(pendingAnswerImages).forEach(k => { delete pendingAnswerImages[k]; });
  const dashSearch = document.getElementById('instr-questions-search');
  if (dashSearch) dashSearch.value = '';
  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  document.getElementById('session-dependent-sections').style.display = 'none';
  const nameEl = document.getElementById('instructor-name-bar');
  if (nameEl) nameEl.textContent = currentInstructor || 'Instructor';
  // show/hide demo UI
  const demoBadge = document.getElementById('demo-badge');
  const resetBtn = document.getElementById('reset-demo-btn');
  if (isDemoMode) {
    demoBadge.style.display = 'inline-flex';
    resetBtn.style.display = 'inline-block';
    document.getElementById('student-view-btn').style.display = 'inline-block';
  } else {
    demoBadge.style.display = 'none';
    resetBtn.style.display = 'none';
    document.getElementById('student-view-btn').style.display = 'none';
  }
  isDemoMode ? loadDemoSessions() : loadSessions();
  if (!isDemoMode) {
    instructorSessionsHydrated = false;
    syncActiveCodeBadge();
    let restorePending = false;
    try { restorePending = !!readInstructorActiveSessionFromStorage(); } catch (e) {}
    const ql = document.getElementById('questions-list');
    if (restorePending) {
      ql.innerHTML = '<div class="empty-state" style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.9rem">Loading session…</div>';
    } else {
      ql.innerHTML = '<div class="empty-state" style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.9rem">Loading sessions…</div>';
    }
  }
  updateInstructorPaginationUi();
}

function loadDemoSessions() {
  instructorSessionsHydrated = true;
  const hidden = getDemoHiddenSessionIds();
  allSessions = [DEMO_SESSION].filter(s => !hidden.includes(s.id));
  const qs = DEMO_QUESTIONS_TEMPLATE.map(q => ({...q, voters: [...q.voters]}));
  questionPages = [{ questions: qs, endSnap: null }];
  currentQuestionPage = 0;
  hasMoreOlder = false;
  instructorOlderBeyondLoadExhausted = true;
  rebuildAllQuestions();
  if (allSessions.length) {
    activeSessionCode = DEMO_SESSION_CODE;
    renderSessionsList();
    renderQuestions();
    updateStats();
    updateInstructorPaginationUi();
    fillSessionForm(DEMO_SESSION);
    syncActiveCodeBadge();
    document.getElementById('session-dependent-sections').style.display = 'block';
    persistInstructorActiveSession(DEMO_SESSION_CODE);
  } else {
    if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
    activeSessionCode = null;
    questionPages = [];
    currentQuestionPage = 0;
    hasMoreOlder = false;
    instructorOlderBeyondLoadExhausted = false;
    rebuildAllQuestions();
    syncActiveCodeBadge();
    document.getElementById('session-dependent-sections').style.display = 'none';
    document.getElementById('questions-list').innerHTML = instructorWelcomeQuestionsHtml();
    ['stat-total', 'stat-answered', 'stat-pending', 'stat-pinned', 'fc-all', 'fc-pinned', 'fc-pending', 'fc-answered'].forEach(id => {
      const hel = document.getElementById(id);
      if (hel) hel.textContent = '0';
    });
    const hintClear = document.getElementById('instr-stat-scope-hint');
    if (hintClear) hintClear.textContent = '';
    updateInstructorPaginationUi();
    renderSessionsList();
    persistInstructorActiveSession(null);
  }
}

function fillSessionForm(s) {
  document.getElementById('sf-class').value = s.className || '';
  document.getElementById('sf-session').value = s.sessionName || '';
  document.getElementById('sf-room').value = s.room || '';
  document.getElementById('sf-desc').value = s.description || '';
  document.getElementById('session-note-show').checked = (s.sessionNoteShow !== false);
  document.getElementById('session-note-title-input').value = s.sessionNoteTitle || '';
  document.getElementById('session-note-body-input').value = s.sessionNoteBody || '';
  document.getElementById('session-note-urls-input').value = Array.isArray(s.sessionNoteImageUrls) ? s.sessionNoteImageUrls.join('\n') : '';
  // date/time — convert display back to input format if possible
  if (s.sessionDate) {
    try {
      const d = new Date(s.sessionDate);
      if (!isNaN(d)) document.getElementById('sf-date').value = d.toISOString().split('T')[0];
      else document.getElementById('sf-date').value = '';
    } catch(e) { document.getElementById('sf-date').value = ''; }
  } else { document.getElementById('sf-date').value = ''; }
  document.getElementById('sf-time').value = s.sessionTime || '';
  // instructors
  const instructors = s.instructors || (s.instructorNames ? s.instructorNames.split(',').map(n=>n.trim()).filter(Boolean) : []);
  renderInstructorList(instructors);
}

function parseBulletinUrls(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw).split(/\r?\n/).map(l => l.trim()).filter(u => /^https:\/\//i.test(u));
}

function rebuildAllQuestions() {
  const pg = questionPages[currentQuestionPage];
  allQuestions = pg && pg.questions ? pg.questions.slice() : [];
}

function getAllCachedInstructorQuestionsForStats() {
  const m = new Map();
  questionPages.forEach(p => { (p.questions || []).forEach(q => m.set(q.id, q)); });
  return Array.from(m.values());
}

function findInstructorQuestionById(id) {
  const hit = allQuestions.find(x => x.id === id);
  if (hit) return hit;
  return getAllCachedInstructorQuestionsForStats().find(x => x.id === id);
}

function getInstructorQuestionSearchHaystack(q) {
  const bits = [q.text, q.authorName, q.authorEmail];
  const answers = q.answers && q.answers.length ? q.answers : (q.answer ? [{ text: q.answer, instructor: 'Instructor' }] : []);
  answers.forEach(a => {
    bits.push(a.text, a.instructor);
    if (Array.isArray(a.imageUrls)) bits.push(a.imageUrls.join(' '));
  });
  return bits.filter(Boolean).join('\n');
}

function filterInstructorQuestionsBySearchQuery(corpus, query) {
  return filterCorpusByFuseSearch(corpus, query, getInstructorQuestionSearchHaystack);
}

function getInstructorSearchQuery() {
  const el = document.getElementById('instr-questions-search');
  return el && el.value ? String(el.value).trim() : '';
}

function clearInstructorSearch() {
  const el = document.getElementById('instr-questions-search');
  if (el) el.value = '';
  renderQuestions();
  updateInstructorPaginationUi();
}

function buildInstructorPaginationHtml() {
  const numLoaded = questionPages.length;
  if (!numLoaded) return '';
  const cur = questionPages[currentQuestionPage];
  const canPrev = currentQuestionPage > 0;
  const canNextCached = currentQuestionPage < numLoaded - 1;
  const canNextFetch = !instructorOlderBeyondLoadExhausted && !!(cur && cur.endSnap && cur.questions.length >= QUESTIONS_PAGE_SIZE);
  const canNext = canNextCached || canNextFetch;
  const lastPg = questionPages[numLoaded - 1];
  const showPhantomNext = !instructorOlderBeyondLoadExhausted && !!(lastPg && lastPg.endSnap && lastPg.questions.length >= QUESTIONS_PAGE_SIZE);
  const totalSlots = numLoaded + (showPhantomNext ? 1 : 0);
  const maxNums = 5;
  let lo = 0;
  let hi = totalSlots;
  if (totalSlots > maxNums) {
    const half = Math.floor(maxNums / 2);
    lo = Math.max(0, Math.min(currentQuestionPage - half, totalSlots - maxNums));
    hi = lo + maxNums;
  }
  const parts = [];
  parts.push('<div class="pagination-nav-cluster">');
  parts.push(`<button type="button" class="page-nav-btn instr-p-prev"${canPrev ? '' : ' disabled'} onclick="goInstructorPreviousPage()">Previous</button>`);
  for (let i = lo; i < hi; i++) {
    const isAct = i === currentQuestionPage;
    if (i < numLoaded) {
      parts.push(`<button type="button" class="pagination-page-btn${isAct ? ' active' : ''}" onclick="goInstructorToPage(${i})">${i + 1}</button>`);
    } else {
      parts.push(`<button type="button" class="pagination-page-btn" title="Load older questions" aria-label="Go to page ${i + 1}" onclick="goInstructorNextPage()">${i + 1}</button>`);
    }
  }
  parts.push(`<button type="button" class="page-nav-btn instr-p-next"${canNext ? '' : ' disabled'} onclick="goInstructorNextPage()">Next</button>`);
  parts.push('</div>');
  return parts.join('');
}

function updateInstructorPaginationUi() {
  const chrome = document.getElementById('instr-questions-chrome');
  if (chrome) {
    const on = !!activeSessionCode;
    chrome.classList.toggle('is-visible', on);
    chrome.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  const top = document.getElementById('instr-pagination-top');
  const bottom = document.getElementById('instr-pagination-bottom');
  if (top && bottom) {
    const searching = !!getInstructorSearchQuery();
    const show = !searching && !!activeSessionCode && questionPages.length > 0;
    const html = show ? buildInstructorPaginationHtml() : '';
    top.innerHTML = html;
    bottom.innerHTML = html;
    top.classList.toggle('visible', show);
    bottom.classList.toggle('visible', show);
    top.style.display = show ? 'flex' : 'none';
    bottom.style.display = show ? 'flex' : 'none';
  }
}

function saveSessionNote() {
  if (!activeSessionCode) { showToast('Select a session first.'); return; }
  const sessionNoteShow = document.getElementById('session-note-show').checked;
  const sessionNoteTitle = document.getElementById('session-note-title-input').value.trim();
  const sessionNoteBody = document.getElementById('session-note-body-input').value.trim();
  const sessionNoteImageUrls = parseBulletinUrls(document.getElementById('session-note-urls-input').value);
  if (isDemoMode) {
    const s = allSessions.find(x => x.id === activeSessionCode);
    if (s) {
      s.sessionNoteShow = sessionNoteShow;
      s.sessionNoteTitle = sessionNoteTitle;
      s.sessionNoteBody = sessionNoteBody;
      s.sessionNoteImageUrls = sessionNoteImageUrls;
    }
    showToast('Session note updated (demo).');
    return;
  }
  db.collection('sessions').doc(activeSessionCode).update({
    sessionNoteShow,
    sessionNoteTitle,
    sessionNoteBody,
    sessionNoteImageUrls,
    sessionNoteUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => showToast('Session note saved.')).catch(e => showToast('Error: ' + e.message));
}

function goInstructorOlderPage() {
  if (!activeSessionCode || isDemoMode || questionsLoading) return;
  const cur = questionPages[currentQuestionPage];
  if (!cur || !cur.endSnap || cur.questions.length < QUESTIONS_PAGE_SIZE) return;
  const nextIdx = currentQuestionPage + 1;
  if (questionPages[nextIdx]) {
    currentQuestionPage = nextIdx;
    rebuildAllQuestions();
    captureAnswerDrafts();
    renderQuestions();
    restoreAnswerDrafts();
    updateStats();
    updateInstructorPaginationUi();
    return;
  }
  questionsLoading = true;
  db.collection('sessions').doc(activeSessionCode).collection('questions')
    .orderBy('createdAt', 'desc')
    .startAfter(cur.endSnap)
    .limit(QUESTIONS_PAGE_SIZE)
    .get()
    .then(snap => {
      if (!snap.docs.length) {
        instructorOlderBeyondLoadExhausted = true;
        updateStats();
        updateInstructorPaginationUi();
        return;
      }
      const questions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      questionPages[nextIdx] = { questions, endSnap };
      currentQuestionPage = nextIdx;
      instructorOlderBeyondLoadExhausted = snap.docs.length < QUESTIONS_PAGE_SIZE;
      rebuildAllQuestions();
      captureAnswerDrafts();
      renderQuestions();
      restoreAnswerDrafts();
      updateStats();
      updateInstructorPaginationUi();
    })
    .finally(() => { questionsLoading = false; });
}

function goInstructorToPage(zeroBased) {
  if (zeroBased < 0 || zeroBased >= questionPages.length || !questionPages[zeroBased]) return;
  if (zeroBased === currentQuestionPage) return;
  currentQuestionPage = zeroBased;
  rebuildAllQuestions();
  captureAnswerDrafts();
  renderQuestions();
  restoreAnswerDrafts();
  updateStats();
  updateInstructorPaginationUi();
}

function goInstructorPreviousPage() {
  if (currentQuestionPage <= 0) return;
  goInstructorToPage(currentQuestionPage - 1);
}

function goInstructorNextPage() {
  if (questionsLoading) return;
  if (currentQuestionPage < questionPages.length - 1) {
    goInstructorToPage(currentQuestionPage + 1);
    return;
  }
  goInstructorOlderPage();
}

function captureAnswerDrafts() {
  document.querySelectorAll('#questions-list textarea.answer-box').forEach(ta => {
    if (ta.id && ta.id.indexOf('ans-') === 0) {
      const qid = ta.id.slice(4);
      answerDrafts[qid] = ta.value;
    }
  });
}

function restoreAnswerDrafts() {
  Object.keys(answerDrafts).forEach(qid => {
    const ta = document.getElementById('ans-' + qid);
    if (ta) ta.value = answerDrafts[qid];
  });
}

const IMG_MAX_EDGE = 1600;
const IMG_JPEG_Q = 0.82;

function collectImageFilesFromPaste(ev) {
  const out = [];
  const cd = ev.clipboardData;
  if (!cd) return out;
  if (cd.items) {
    for (let i = 0; i < cd.items.length; i++) {
      if (cd.items[i].type && cd.items[i].type.indexOf('image') === 0) {
        const f = cd.items[i].getAsFile();
        if (f) out.push(f);
      }
    }
  }
  if (!out.length && cd.files && cd.files.length) {
    for (let j = 0; j < cd.files.length; j++) {
      if (cd.files[j].type && cd.files[j].type.indexOf('image') === 0) out.push(cd.files[j]);
    }
  }
  return out;
}

function resizeImageToJpegBlobInstr(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      const w = img.width, h = img.height;
      const scale = Math.min(1, IMG_MAX_EDGE / Math.max(w, h, 1));
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      c.toBlob(blob => { if (blob) resolve(blob); else reject(new Error('encode')); }, 'image/jpeg', IMG_JPEG_Q);
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('img')); };
    img.src = u;
  });
}

function uploadInstructorAnswerImage(jpegBlob, qid) {
  if (!storage || !activeSessionCode) return Promise.reject(new Error('no storage'));
  const path = 'sessions/' + activeSessionCode + '/answer_paste/' + qid + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
  return storage.ref(path).put(jpegBlob, { contentType: 'image/jpeg' }).then(snap => snap.ref.getDownloadURL());
}

function syncAnswerPastePreviews() {
  Object.keys(pendingAnswerImages).forEach(qid => {
    const el = document.getElementById('ans-prev-' + qid);
    const urls = pendingAnswerImages[qid] || [];
    if (!el) return;
    if (!urls.length) { el.innerHTML = ''; return; }
    el.innerHTML = urls.map(url => `<span class="paste-preview-item"><img src="${esc(url)}" alt=""><button type="button" class="paste-preview-remove" data-qid="${esc(qid)}" data-url="${esc(url)}" aria-label="Remove">×</button></span>`).join('');
    el.querySelectorAll('.paste-preview-remove').forEach(btn => {
      btn.onclick = () => removePendingAnswerImage(btn.getAttribute('data-qid'), btn.getAttribute('data-url'));
    });
  });
}

function removePendingAnswerImage(qid, url) {
  if (!pendingAnswerImages[qid]) return;
  pendingAnswerImages[qid] = pendingAnswerImages[qid].filter(u => u !== url);
  if (!pendingAnswerImages[qid].length) delete pendingAnswerImages[qid];
  syncAnswerPastePreviews();
}

function onAnswerBoxPaste(e) {
  const t = e.target;
  if (!t || !t.classList || !t.classList.contains('answer-box')) return;
  const files = collectImageFilesFromPaste(e);
  if (!files.length) return;
  if (isDemoMode) {
    e.preventDefault();
    showToast('Image paste: use a live session with Firebase Storage (see SETUP.md).');
    return;
  }
  if (!activeSessionCode || !storage) {
    e.preventDefault();
    showToast('Enable Firebase Storage to paste images.');
    return;
  }
  e.preventDefault();
  const qid = t.id.replace(/^ans-/, '');
  if (!qid) return;
  if (!pendingAnswerImages[qid]) pendingAnswerImages[qid] = [];
  (async () => {
    for (const file of files) {
      try {
        showToast('Uploading image…');
        const blob = await resizeImageToJpegBlobInstr(file);
        const url = await uploadInstructorAnswerImage(blob, qid);
        pendingAnswerImages[qid].push(url);
        syncAnswerPastePreviews();
        showToast('Image attached to this answer.');
      } catch (err) {
        console.warn(err);
        showToast('Upload failed. Enable Storage + rules in Firebase (SETUP.md).');
      }
    }
  })();
}

function loadSessions() {
  const ownerId = nameToId(currentInstructor || '');
  // Load sessions this instructor owns — no orderBy to avoid composite index requirement
  db.collection('sessions')
    .where('ownerId', '==', ownerId)
    .onSnapshot(snap => {
      const owned = snap.docs.map(d => ({id: d.id, ...d.data()}));
      // Sort by createdAt descending in JS
      owned.sort((a, b) => {
        const at = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
        const bt = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
        return bt - at;
      });
      // Also load sessions this instructor has manually joined + apply per-instructor "hidden from list"
      db.collection('instructors').doc(ownerId).get().then(doc => {
        const joinedCodes = doc.exists && doc.data().joinedSessions ? doc.data().joinedSessions : [];
        const hidden = doc.exists && Array.isArray(doc.data().sessionsHiddenFromList) ? doc.data().sessionsHiddenFromList : [];
        const hiddenSet = new Set(hidden);
        const applyHidden = (arr) => arr.filter(s => s && !hiddenSet.has(s.id));
        const mergeAndRender = (joined) => {
          allSessions = applyHidden([...owned, ...joined]);
          instructorSessionsHydrated = true;
          renderSessionsList();
          tryRestoreInstructorActiveSessionFromList();
          if (!isDemoMode && !activeSessionCode) renderQuestions();
        };
        if (!joinedCodes.length) {
          mergeAndRender([]);
          return;
        }
        Promise.all(joinedCodes.map(code => db.collection('sessions').doc(code).get()))
          .then(docs => {
            const joined = docs
              .filter(d => d.exists && !owned.find(o => o.id === d.id))
              .map(d => ({id: d.id, ...d.data()}));
            mergeAndRender(joined);
          });
      });
    }, err => {
      // If query fails (e.g. no index), show empty and log
      console.error('loadSessions error:', err);
      allSessions = [];
      instructorSessionsHydrated = true;
      renderSessionsList();
      if (!isDemoMode && !activeSessionCode) renderQuestions();
      showToast('Error loading sessions: ' + err.message);
    });
}

function getDemoHiddenSessionIds() {
  try {
    const fromNew = sessionStorage.getItem(DEMO_SESSIONS_HIDDEN_KEY);
    const fromLeg = sessionStorage.getItem(DEMO_SESSIONS_HIDDEN_LEGACY);
    const raw = fromNew || fromLeg;
    if (!raw) return [];
    if (fromLeg && !fromNew) {
      sessionStorage.setItem(DEMO_SESSIONS_HIDDEN_KEY, raw);
      sessionStorage.removeItem(DEMO_SESSIONS_HIDDEN_LEGACY);
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

function renderSessionsList() {
  const el = document.getElementById('sessions-list');
  if (!allSessions.length) {
    el.innerHTML = `<div style="font-size:0.82rem;color:var(--text-light);text-align:center;padding:0.75rem;line-height:1.6;">
      No sessions in your list.<br>Create one, join with a code, or un-hide by joining a hidden session again.
    </div>`;
    return;
  }
  el.innerHTML = allSessions.map(s => {
    const active = activeSessionCode === s.id;
    const title = esc(s.sessionName || s.className || 'Untitled');
    return `<div class="session-list-row">
      <button type="button" class="session-select-btn${active ? ' session-select-btn--active' : ''}" onclick="selectSession('${s.id}')">
        <div style="font-family:'DM Mono',monospace;font-size:0.75rem;letter-spacing:0.08em">${esc(s.id)}</div>
        <div style="margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
      </button>
      <button type="button" class="session-hide-btn" onclick="hideSessionFromList('${s.id}', event)" title="Hide from your list" aria-label="Hide session from list">✕</button>
    </div>`;
  }).join('');
}

function hideSessionFromList(sessionCode, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  if (!sessionCode) return;
  const clearActivePanel = () => {
    instructorSessionStatsSerial++;
    clearTimeout(instructorStatsAggTimer);
    instructorStatsAggTimer = null;
    if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
    activeSessionCode = null;
    const iqSearch = document.getElementById('instr-questions-search');
    if (iqSearch) iqSearch.value = '';
    questionPages = [];
    currentQuestionPage = 0;
    hasMoreOlder = false;
    instructorOlderBeyondLoadExhausted = false;
    rebuildAllQuestions();
    renderQuestions();
    ['stat-total', 'stat-answered', 'stat-pending', 'stat-pinned', 'fc-all', 'fc-pinned', 'fc-pending', 'fc-answered'].forEach(id => {
      const hel = document.getElementById(id);
      if (hel) hel.textContent = '0';
    });
    const hintEl = document.getElementById('instr-stat-scope-hint');
    if (hintEl) hintEl.textContent = '';
    updateInstructorPaginationUi();
    syncActiveCodeBadge();
    document.getElementById('session-dependent-sections').style.display = 'none';
    persistInstructorActiveSession(null);
  };
  const finishHide = () => {
    const wasActive = activeSessionCode === sessionCode;
    allSessions = allSessions.filter(s => s.id !== sessionCode);
    if (wasActive) {
      if (allSessions.length) selectSession(allSessions[0].id);
      else clearActivePanel();
    }
    renderSessionsList();
    showToast('Removed from your list. Join with the code again to restore it.');
  };

  if (isDemoMode) {
    const arr = getDemoHiddenSessionIds();
    if (!arr.includes(sessionCode)) arr.push(sessionCode);
    sessionStorage.setItem(DEMO_SESSIONS_HIDDEN_KEY, JSON.stringify(arr));
    try { sessionStorage.removeItem(DEMO_SESSIONS_HIDDEN_LEGACY); } catch (e) {}
    finishHide();
    return;
  }
  const ownerId = nameToId(currentInstructor || '');
  db.collection('instructors').doc(ownerId).update({
    sessionsHiddenFromList: firebase.firestore.FieldValue.arrayUnion(sessionCode)
  }).then(finishHide).catch(e => showToast('Could not update list: ' + (e.message || e)));
}

function selectSession(code) {
  activeSessionCode = code;
  instructorSessionStatsSerial++;
  clearTimeout(instructorStatsAggTimer);
  instructorStatsAggTimer = null;
  clearInstructorOnboardingWelcomeFlag();
  if (!isDemoMode) persistInstructorActiveSession(code);
  renderSessionsList();
  syncActiveCodeBadge();
  document.getElementById('session-dependent-sections').style.display = 'block';
  const s = allSessions.find(x => x.id === code);
  if (s) fillSessionForm(s);

  if (unsubQuestions) { unsubQuestions(); unsubQuestions = null; }
  questionPages = [];
  currentQuestionPage = 0;
  hasMoreOlder = false;
  instructorOlderBeyondLoadExhausted = false;
  Object.keys(pendingAnswerImages).forEach(k => { delete pendingAnswerImages[k]; });
  const iqSearch = document.getElementById('instr-questions-search');
  if (iqSearch) iqSearch.value = '';

  if (isDemoMode) {
    const qsDemo = DEMO_QUESTIONS_TEMPLATE.map(q => ({ ...q, voters: [...q.voters] }));
    questionPages = [{ questions: qsDemo, endSnap: null }];
    currentQuestionPage = 0;
    hasMoreOlder = false;
    instructorOlderBeyondLoadExhausted = true;
    rebuildAllQuestions();
    renderQuestions();
    updateStats();
    updateInstructorPaginationUi();
    return;
  }

  unsubQuestions = db.collection('sessions').doc(code).collection('questions')
    .orderBy('createdAt', 'desc')
    .limit(QUESTIONS_PAGE_SIZE)
    .onSnapshot(snap => {
      const questions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const endSnap = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      questionPages[0] = { questions, endSnap };
      hasMoreOlder = snap.docs.length >= QUESTIONS_PAGE_SIZE;
      if (currentQuestionPage === 0) {
        if (questionPages.length > 1) questionPages.length = 1;
        instructorOlderBeyondLoadExhausted = questions.length < QUESTIONS_PAGE_SIZE;
        rebuildAllQuestions();
        captureAnswerDrafts();
        renderQuestions();
        restoreAnswerDrafts();
        updateStats();
        updateInstructorPaginationUi();
      }
    });
  updateInstructorPaginationUi();
  runInstructorAggregateStatsRefresh();
}

function openJoinSessionModal() {
  document.getElementById('join-session-code').value = '';
  document.getElementById('join-session-error').textContent = '';
  document.getElementById('join-session-modal').classList.add('open');
}
function closeJoinSessionModal() {
  document.getElementById('join-session-modal').classList.remove('open');
}

function instructorJoinSession() {
  const raw = document.getElementById('join-session-code').value.trim().toUpperCase();
  const code = raw.replace(/[^A-Z0-9-]/g, '');
  if (!code) { document.getElementById('join-session-error').textContent = 'Please enter a session code.'; return; }
  db.collection('sessions').doc(code).get().then(doc => {
    if (!doc.exists) { document.getElementById('join-session-error').textContent = 'Session not found. Check the code.'; return; }
    // Add to instructor's joined sessions list in Firestore; un-hide if it was hidden from this list only
    const ownerId = nameToId(currentInstructor || '');
    const joinPayload = {
      joinedSessions: firebase.firestore.FieldValue.arrayUnion(code),
      sessionsHiddenFromList: firebase.firestore.FieldValue.arrayRemove(code)
    };
    db.collection('instructors').doc(ownerId).update(joinPayload).catch(() => {
      db.collection('instructors').doc(ownerId).get().then(idoc => {
        const d = idoc.exists ? idoc.data() : {};
        const joined = Array.isArray(d.joinedSessions) ? [...new Set([...d.joinedSessions, code])] : [code];
        const hidden = Array.isArray(d.sessionsHiddenFromList) ? d.sessionsHiddenFromList.filter(c => c !== code) : [];
        return db.collection('instructors').doc(ownerId).set(
          { joinedSessions: joined, sessionsHiddenFromList: hidden },
          { merge: true }
        );
      });
    });
    const sessionData = {id: code, ...doc.data()};
    if (!allSessions.find(s => s.id === code)) allSessions.unshift(sessionData);
    renderSessionsList();
    selectSession(code);
    closeJoinSessionModal();
    showToast('Joined session ' + code);
  }).catch(e => {
    document.getElementById('join-session-error').textContent = 'Error: ' + e.message;
  });
}

function openCreateSessionModal() {
  if (isDemoMode) { showToast('Exit demo mode to create real sessions.'); return; }
  document.getElementById('new-sf-class').value = '';
  document.getElementById('new-sf-session').value = '';
  document.getElementById('new-sf-date').value = '';
  document.getElementById('new-sf-time').value = '';
  document.getElementById('new-sf-room').value = '';
  document.getElementById('new-sf-desc').value = '';
  document.getElementById('create-session-error').textContent = '';
  document.getElementById('create-session-modal').classList.add('open');
}
function closeCreateSessionModal() {
  document.getElementById('create-session-modal').classList.remove('open');
}

function confirmCreateSession() {
  const sessionName = document.getElementById('new-sf-session').value.trim();
  const className = document.getElementById('new-sf-class').value.trim();
  if (!sessionName && !className) {
    document.getElementById('create-session-error').textContent = 'Please enter at least a class name or session name.';
    return;
  }
  const code = genCode();
  const ownerId = nameToId(currentInstructor || '');
  const dateVal = document.getElementById('new-sf-date').value;
  const timeVal = document.getElementById('new-sf-time').value;
  const btn = document.querySelector('#create-session-modal .save-btn');
  btn.disabled = true; btn.textContent = 'Creating...';
  db.collection('sessions').doc(code).set({
    className,
    sessionName,
    instructorNames: currentInstructor || '',
    instructors: currentInstructor ? [currentInstructor] : [],
    sessionDate: dateVal ? new Date(dateVal).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '',
    sessionTime: timeVal ? formatDisplayTime(timeVal) : '',
    room: document.getElementById('new-sf-room').value.trim(),
    description: document.getElementById('new-sf-desc').value.trim(),
    sessionNoteShow: true,
    sessionNoteTitle: '',
    sessionNoteBody: '',
    sessionNoteImageUrls: [],
    ownerId,
    ownerName: currentInstructor || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    btn.disabled = false; btn.textContent = 'Create session';
    closeCreateSessionModal();
    selectSession(code);
    showToast('Session created: ' + code);
  }).catch(e => {
    btn.disabled = false; btn.textContent = 'Create session';
    document.getElementById('create-session-error').textContent = 'Error: ' + e.message;
  });
}

function saveSession() {
  if (isDemoMode) { showToast('Session info updated! (demo — not saved to database)'); return; }
  if (!activeSessionCode) { showToast('Select a session first.'); return; }
  const dateVal = document.getElementById('sf-date').value;
  const timeVal = document.getElementById('sf-time').value;
  db.collection('sessions').doc(activeSessionCode).update({
    className: document.getElementById('sf-class').value.trim(),
    sessionName: document.getElementById('sf-session').value.trim(),
    sessionDate: dateVal ? new Date(dateVal).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '',
    sessionTime: timeVal ? formatDisplayTime(timeVal) : '',
    room: document.getElementById('sf-room').value.trim(),
    description: document.getElementById('sf-desc').value.trim()
  }).then(() => showToast('Session info saved!'));
}

function formatDisplayTime(t) {
  const [h,m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h%12||12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function syncActiveCodeBadge() {
  const el = document.getElementById('active-code');
  if (!el) return;
  if (!activeSessionCode) {
    el.style.display = 'none';
    el.textContent = '';
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  el.style.display = '';
  el.textContent = activeSessionCode;
  el.setAttribute('aria-hidden', 'false');
  el.title = 'Click to copy session code';
}

function copyCode() {
  if (!activeSessionCode) return;
  navigator.clipboard.writeText(activeSessionCode).then(()=>showToast('Code copied!'));
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-item').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderQuestions();
}

function setSort(s, btn) {
  currentSort = s;
  document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderQuestions();
}

function normalizeQuestionImageUrls(q) {
  const raw = q.imageUrls;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(u => String(u).trim()).filter(isHttpsUrl);
  if (typeof raw === 'string') return isHttpsUrl(raw) ? [raw.trim()] : [];
  if (typeof raw === 'object') return Object.keys(raw).sort().map(k => raw[k]).map(u => String(u).trim()).filter(isHttpsUrl);
  return [];
}

function htmlQuestionAttachedImagesInstr(q) {
  const urls = normalizeQuestionImageUrls(q);
  if (!urls.length) return '';
  return '<div class="q-attached-images">' + urls.map(u => {
    const safe = String(u).replace(/"/g, '');
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer"><img src="' + safe + '" alt="" loading="lazy" referrerpolicy="no-referrer"></a>';
  }).join('') + '</div>';
}

function isImageOnlyPlaceholderText(text) {
  const t = (text || '').trim().toLowerCase();
  return t === '(image)' || t === '(photo)';
}

function htmlQuestionBodyInstr(q) {
  const urls = normalizeQuestionImageUrls(q);
  const rawText = q.text || '';
  if (!String(rawText).trim() && urls.length) return '';
  if (isImageOnlyPlaceholderText(rawText) && urls.length) return '';
  if (isImageOnlyPlaceholderText(rawText) && !urls.length) {
    return '<div class="q-text q-text-muted" style="white-space:pre-wrap;word-break:break-word;">No image was saved on this question.</div>';
  }
  if (!String(rawText).trim()) return '';
  return '<div class="q-text rich-message" style="white-space:pre-wrap;word-break:break-word;">' + formatRichMessage(rawText) + '</div>';
}

function renderQuestions() {
  captureAnswerDrafts();
  if (!activeSessionCode) {
    const list0 = document.getElementById('questions-list');
    if (list0) {
      if (instructorOnboardingWelcomePending()) {
        list0.innerHTML = instructorWelcomeQuestionsHtml();
        clearInstructorOnboardingWelcomeFlag();
      } else if (instructorSessionsHydrated && !allSessions.length) {
        list0.innerHTML = instructorWelcomeQuestionsHtml();
      } else {
        list0.innerHTML = instructorCompactSelectSessionHtml();
      }
    }
    restoreAnswerDrafts();
    syncAnswerPastePreviews();
    updateInstructorPaginationUi();
    return;
  }
  const searchQ = getInstructorSearchQuery();
  const corpus = getAllCachedInstructorQuestionsForStats();
  let qs = searchQ ? filterInstructorQuestionsBySearchQuery(corpus, searchQ) : [...allQuestions];
  if (currentFilter==='pinned') qs = qs.filter(q=>q.pinned);
  if (currentFilter==='answered') qs = qs.filter(q=>q.status==='answered');
  if (currentFilter==='pending') qs = qs.filter(q=>q.status!=='answered');
  qs.sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (currentSort==='votes') return (b.votes||0)-(a.votes||0);
    const at = a.createdAt?(a.createdAt.toDate?a.createdAt.toDate():new Date(a.createdAt)):new Date(0);
    const bt = b.createdAt?(b.createdAt.toDate?b.createdAt.toDate():new Date(b.createdAt)):new Date(0);
    return bt-at;
  });
  const list = document.getElementById('questions-list');
  if (!qs.length) {
    const emptyMsg = searchQ
      ? 'No matches in loaded questions. Load more pages or clear the search.'
      : 'No questions in this view.';
    list.innerHTML = '<div class="empty-state"><p>' + emptyMsg + '</p></div>';
    restoreAnswerDrafts();
    syncAnswerPastePreviews();
    return;
  }
  list.innerHTML = qs.map(q => {
    // answers: support both old single `answer` string and new `answers` array
    const answers = q.answers && q.answers.length ? q.answers : (q.answer ? [{ instructor: 'Instructor', text: q.answer, ts: null }] : []);
    const answersHtml = answers.map((a, i) => `
      <div style="background:var(--accent-light);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;padding:0.6rem 0.9rem;margin-bottom:0.4rem;position:relative;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.3rem;">
          <span style="font-size:0.72rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;">${esc(a.instructor||'Instructor')}</span>
          <button onclick="deleteAnswer('${q.id}',${i})" style="background:none;border:none;font-size:0.8rem;color:var(--text-light);cursor:pointer;padding:0 2px;line-height:1;transition:color 0.15s;" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--text-light)'">×</button>
        </div>
        <div class="rich-message" style="font-size:0.88rem;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${formatRichMessage(a.text||'')}</div>
        ${(Array.isArray(a.imageUrls) && a.imageUrls.length) ? '<div class="answer-attached-images">' + a.imageUrls.filter(isHttpsUrl).map(u => { const safe = String(u).replace(/"/g, ''); return '<a href="'+safe+'" target="_blank" rel="noopener noreferrer"><img src="'+safe+'" alt="" loading="lazy" referrerpolicy="no-referrer"></a>'; }).join('') + '</div>' : ''}
      </div>`).join('');
    return `
    <div class="q-card ${q.pinned?'pinned':''} ${q.status==='answered'?'answered':''}" id="qcard-${q.id}">
      <div class="q-top">
        <div>
          <div class="q-author-row">
            <span class="q-author">${esc(q.authorName||'Anonymous')}</span>
            ${q.authorEmail ? `` : ''}
            <span class="q-time" title="Posted time">${formatQuestionWhen(q.createdAt)}</span>
          </div>
          <div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;">
            ${q.pinned?'<span class="q-badge badge-pinned">Pinned</span>':''}
            ${q.status==='answered'?'<span class="q-badge badge-answered">Answered</span>':'<span class="q-badge badge-pending">Pending</span>'}
          </div>
        </div>
        <div class="q-votes">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          ${q.votes||0}
        </div>
      </div>
      ${htmlQuestionBodyInstr(q)}
      ${htmlQuestionAttachedImagesInstr(q)}
      ${answersHtml ? `<div style="margin-bottom:0.75rem;">${answersHtml}</div>` : ''}
      <div class="q-answer-area">
        <div class="answer-label">${answers.length ? 'Add another answer' : 'Answer'}</div>
        <div class="answer-paste-preview" id="ans-prev-${q.id}"></div>
        ${instructorFormatToolbarHtml('ans-' + q.id)}
        <textarea class="answer-box" id="ans-${q.id}" placeholder="Type your answer here… Paste links or screenshots (images upload to Firebase Storage)."></textarea>
      </div>
      <div class="q-actions">
        <button class="action-btn btn-answer" onclick="saveAnswer('${q.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          Save answer
        </button>
        <button class="action-btn btn-pin" onclick="togglePin('${q.id}')">
          📌 ${q.pinned?'Unpin':'Pin'}
        </button>
        ${q.status!=='answered'
          ? `<button class="action-btn btn-done" onclick="setStatus('${q.id}','answered')">✅ Mark answered</button>`
          : `<button class="action-btn btn-pending" onclick="setStatus('${q.id}','pending')">⏳ Mark pending</button>`
        }
        <button class="action-btn btn-delete" onclick="openDelete('${q.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Delete
        </button>
      </div>
    </div>`;
  }).join('');
  restoreAnswerDrafts();
  syncAnswerPastePreviews();
  fillFmtEmojiPickerGrids();
}

function saveAnswer(id) {
  const text = (document.getElementById('ans-'+id) && document.getElementById('ans-'+id).value) || '';
  const imgs = pendingAnswerImages[id] && pendingAnswerImages[id].length ? [...pendingAnswerImages[id]] : [];
  if (!text.trim() && !imgs.length) return;
  const q = findInstructorQuestionById(id);
  if (!q) return;
  const newAnswer = { instructor: currentInstructor || 'Instructor', text: text.trim() || (imgs.length ? '(Image)' : ''), ts: new Date().toISOString() };
  if (imgs.length) newAnswer.imageUrls = imgs;
  const answers = q.answers ? [...q.answers] : (q.answer ? [{ instructor: 'Instructor', text: q.answer, ts: null }] : []);
  answers.push(newAnswer);
  delete pendingAnswerImages[id];
  if (isDemoMode) {
    q.answers = answers; q.answer = ''; q.status = 'answered';
    delete answerDrafts[id];
    renderQuestions(); updateStats();
    showToast('Answer saved!');
    return;
  }
  db.collection('sessions').doc(activeSessionCode).collection('questions').doc(id).update({
    answers, answer: '', status: 'answered'
  }).then(() => {
    delete answerDrafts[id];
    const ta = document.getElementById('ans-' + id);
    if (ta) ta.value = '';
    showToast('Answer saved!');
  });
}

function deleteAnswer(qId, index) {
  const q = findInstructorQuestionById(qId);
  if (!q) return;
  const answers = q.answers ? [...q.answers] : [];
  answers.splice(index, 1);
  const status = answers.length ? 'answered' : 'pending';
  if (isDemoMode) {
    q.answers = answers; q.status = status;
    renderQuestions(); updateStats();
    showToast('Answer removed.');
    return;
  }
  db.collection('sessions').doc(activeSessionCode).collection('questions').doc(qId).update({
    answers, status
  }).then(() => showToast('Answer removed.'));
}

function togglePin(id) {
  const q = findInstructorQuestionById(id);
  if (!q) return;
  if (isDemoMode) {
    q.pinned = !q.pinned;
    const msg = q.pinned ? 'Question pinned!' : 'Unpinned.';
    renderQuestions(); updateStats(); showToast(msg);
    return;
  }
  db.collection('sessions').doc(activeSessionCode).collection('questions').doc(id).update({ pinned: !q.pinned })
    .then(() => showToast(q.pinned ? 'Unpinned.' : 'Question pinned!'));
}

function setStatus(id, status) {
  if (isDemoMode) {
    const q = findInstructorQuestionById(id);
    if (q) q.status = status;
    renderQuestions(); updateStats();
    showToast(status==='answered' ? 'Marked as answered.' : 'Marked as pending.');
    return;
  }
  db.collection('sessions').doc(activeSessionCode).collection('questions').doc(id).update({ status })
    .then(() => showToast(status==='answered' ? 'Marked as answered.' : 'Marked as pending.'));
}

let deleteInProgress = false;

function openDelete(id) {
  deleteTargetId = id;
  document.getElementById('delete-modal').classList.add('open');
}

function closeDelete() {
  document.getElementById('delete-modal').classList.remove('open');
  deleteTargetId = null;
  deleteInProgress = false;
  const dangerBtn = document.querySelector('#delete-modal .btn-danger');
  if (dangerBtn) dangerBtn.disabled = false;
}

function confirmDelete() {
  if (!deleteTargetId || deleteInProgress) return;
  const rid = deleteTargetId;
  const dangerBtn = document.querySelector('#delete-modal .btn-danger');

  if (isDemoMode) {
    questionPages.forEach(p => { p.questions = p.questions.filter(x => x.id !== rid); });
    rebuildAllQuestions();
    delete answerDrafts[rid];
    delete pendingAnswerImages[rid];
    renderQuestions();
    updateStats();
    showToast('Question deleted.');
    closeDelete();
    return;
  }

  deleteInProgress = true;
  if (dangerBtn) dangerBtn.disabled = true;

  db.collection('sessions').doc(activeSessionCode).collection('questions').doc(rid).delete()
    .then(() => {
      questionPages.forEach(p => { p.questions = p.questions.filter(x => x.id !== rid); });
      rebuildAllQuestions();
      delete answerDrafts[rid];
      delete pendingAnswerImages[rid];
      try {
        renderQuestions();
        updateStats();
        showToast('Question deleted.');
      } catch (err) {
        console.error(err);
        showToast('Question deleted on the server. Refresh the page if the list looks wrong.');
      }
    })
    .catch((err) => {
      console.error(err);
      var msg = (err && err.code === 'permission-denied')
        ? 'Firestore denied delete. In Firebase → Firestore → Rules, allow delete on questions (see SETUP.md).'
        : ('Could not delete: ' + (err && err.message ? err.message : 'unknown error'));
      showToast(msg);
    })
    .finally(() => {
      deleteInProgress = false;
      if (dangerBtn) dangerBtn.disabled = false;
      closeDelete();
    });
}

function applyInstructorStatAndFcFromCache(qs) {
  document.getElementById('stat-total').textContent = qs.length;
  document.getElementById('stat-answered').textContent = qs.filter(q => q.status === 'answered').length;
  document.getElementById('stat-pending').textContent = qs.filter(q => q.status !== 'answered').length;
  document.getElementById('stat-pinned').textContent = qs.filter(q => q.pinned).length;
  document.getElementById('fc-all').textContent = qs.length;
  document.getElementById('fc-pinned').textContent = qs.filter(q => q.pinned).length;
  document.getElementById('fc-pending').textContent = qs.filter(q => q.status !== 'answered').length;
  document.getElementById('fc-answered').textContent = qs.filter(q => q.status === 'answered').length;
}

function setInstructorStatHintAggregatesOk() {
  const el = document.getElementById('instr-stat-scope-hint');
  if (el) el.textContent = 'Session-wide totals for this whole class (from Firestore). The list below still loads in pages (newest first).';
}

function setInstructorStatHintFallback() {
  const el = document.getElementById('instr-stat-scope-hint');
  if (el) el.textContent = 'Could not load session-wide totals. Showing counts from posts loaded in this browser only.';
}

function runInstructorAggregateStatsRefresh() {
  const code = activeSessionCode;
  if (!code || !db || isDemoMode) return;
  const serialAtStart = instructorSessionStatsSerial;
  fetchSessionQuestionCountStats(code)
    .then((stats) => {
      if (serialAtStart !== instructorSessionStatsSerial || code !== activeSessionCode) return;
      document.getElementById('stat-total').textContent = String(stats.total);
      document.getElementById('stat-answered').textContent = String(stats.answered);
      document.getElementById('stat-pending').textContent = String(stats.pending);
      document.getElementById('stat-pinned').textContent = String(stats.pinned);
      document.getElementById('fc-all').textContent = String(stats.total);
      document.getElementById('fc-pinned').textContent = String(stats.pinned);
      document.getElementById('fc-pending').textContent = String(stats.pending);
      document.getElementById('fc-answered').textContent = String(stats.answered);
      setInstructorStatHintAggregatesOk();
    })
    .catch(() => {
      if (serialAtStart !== instructorSessionStatsSerial || code !== activeSessionCode) return;
      const qs = getAllCachedInstructorQuestionsForStats();
      applyInstructorStatAndFcFromCache(qs);
      setInstructorStatHintFallback();
    });
}

function scheduleInstructorAggregateStatsRefresh() {
  if (isDemoMode || !activeSessionCode || !db) return;
  clearTimeout(instructorStatsAggTimer);
  instructorStatsAggTimer = setTimeout(() => {
    instructorStatsAggTimer = null;
    runInstructorAggregateStatsRefresh();
  }, 400);
}

function updateStats() {
  const qs = getAllCachedInstructorQuestionsForStats();
  updateInstructorPaginationUi();
  if (studentViewOpen) sdemoRender();
  if (isDemoMode) {
    applyInstructorStatAndFcFromCache(qs);
    const el = document.getElementById('instr-stat-scope-hint');
    if (el) el.textContent = qs.length ? 'Demo — counts are for the built-in sample questions.' : '';
    return;
  }
  if (!activeSessionCode || !db) {
    applyInstructorStatAndFcFromCache(qs);
    const h = document.getElementById('instr-stat-scope-hint');
    if (h) h.textContent = '';
    return;
  }
  scheduleInstructorAggregateStatsRefresh();
}

// ── STUDENT DEMO VIEW ──────────────────────────
let sdemoFilter = 'all';
let sdemoUserId = 'demo-student-' + Math.random().toString(36).slice(2,8);
let sdemoEditingId = null;
let studentViewOpen = false;

function toggleStudentView() {
  studentViewOpen = !studentViewOpen;
  const panel = document.getElementById('student-demo-panel');
  const btn = document.getElementById('student-view-btn');
  panel.style.display = studentViewOpen ? 'block' : 'none';
  btn.style.background = studentViewOpen ? '#f3e8ff' : 'none';
  if (studentViewOpen) sdemoRender();
}

function sdemoSetFilter(f, btn) {
  sdemoFilter = f;
  document.querySelectorAll('.sdemo-filter').forEach(b => {
    b.style.background = '#fff';
    b.style.borderColor = '#e2ddd6';
    b.style.color = '#7a7570';
  });
  btn.style.background = '#e8f2fc';
  btn.style.borderColor = '#0070d2';
  btn.style.color = '#0070d2';
  sdemoRender();
}

function sdemoSubmit() {
  const text = document.getElementById('sdemo-q-text').value.trim();
  if (!text) return;
  const name = document.getElementById('sdemo-name').value.trim() || 'Demo Student';
  const newQ = {
    id: 'sdemo-' + Date.now(),
    text,
    authorName: name,
    authorEmail: '',
    authorId: sdemoUserId,
    status: 'pending',
    pinned: false,
    votes: 0,
    voters: [],
    answer: '',
    createdAt: new Date()
  };
  allQuestions.unshift(newQ);
  document.getElementById('sdemo-q-text').value = '';
  sdemoRender();
  // also refresh instructor view
  renderQuestions();
  updateStats();
  showToast('Student question submitted!');
}

function sdemoToggleUpvote(id) {
  const q = allQuestions.find(x => x.id === id);
  if (!q) return;
  if ((q.voters||[]).includes(sdemoUserId)) {
    q.votes = Math.max(0, (q.votes||0) - 1);
    q.voters = q.voters.filter(v => v !== sdemoUserId);
  } else {
    q.votes = (q.votes||0) + 1;
    q.voters = [...(q.voters||[]), sdemoUserId];
  }
  sdemoRender();
  renderQuestions();
}

function sdemoOpenEdit(id) {
  const q = allQuestions.find(x => x.id === id);
  if (!q) return;
  sdemoEditingId = id;
  // reuse instructor edit modal
  document.getElementById('edit-text') ? null : null;
  // inline edit — replace text with textarea
  const textEl = document.getElementById('sdemo-text-' + id);
  if (!textEl) return;
  const current = q.text;
  textEl.innerHTML = `<div class="format-toolbar format-toolbar--compact" style="margin-bottom:.35rem;">
    <button type="button" class="fmt-btn fmt-btn-b" title="Bold" onclick="insertSlackFormat('sdemo-edit-ta-${id}','bold')"><strong>B</strong></button>
    <button type="button" class="fmt-btn fmt-btn-i" title="Italic" onclick="insertSlackFormat('sdemo-edit-ta-${id}','italic')"><em>I</em></button>
    <button type="button" class="fmt-btn fmt-btn-s" title="Strike" onclick="insertSlackFormat('sdemo-edit-ta-${id}','strike')"><span style="text-decoration:line-through;">S</span></button>
    <button type="button" class="fmt-btn fmt-btn-mono" title="Code" onclick="insertSlackFormat('sdemo-edit-ta-${id}','code')">\`</button>
    <button type="button" class="fmt-btn fmt-btn-mono" title="Block" onclick="insertSlackFormat('sdemo-edit-ta-${id}','fenced')">{ }</button>
    <button type="button" class="fmt-btn fmt-emoji" onclick="insertEmoji('sdemo-edit-ta-${id}','👍')">👍</button>
    <button type="button" class="fmt-btn fmt-emoji" onclick="insertEmoji('sdemo-edit-ta-${id}','✅')">✅</button>
    <button type="button" class="fmt-btn fmt-emoji" onclick="insertEmoji('sdemo-edit-ta-${id}','💡')">💡</button>
    <details class="fmt-emoji-more">
      <summary class="fmt-more-summary" title="More emojis — opens below or above to fit (Unicode)">⋯</summary>
      <div class="fmt-emoji-grid" data-emoji-picker-autofill data-emoji-target-id="sdemo-edit-ta-${id}" role="group" aria-label="More emojis"></div>
    </details>
  </div>
  <textarea id="sdemo-edit-ta-${id}" style="width:100%;border:1.5px solid #0070d2;border-radius:6px;padding:.5rem .7rem;font-family:inherit;font-size:.88rem;resize:vertical;outline:none;background:#fff;">${esc(current)}</textarea>
  <div style="display:flex;gap:.4rem;margin-top:.4rem;justify-content:flex-end;">
    <button onclick="sdemoCancelEdit('${id}','${esc(current)}')" style="padding:3px 10px;border:1.5px solid #e2ddd6;border-radius:6px;font-family:inherit;font-size:.78rem;cursor:pointer;background:none;">Cancel</button>
    <button onclick="sdemoSaveEdit('${id}')" style="padding:3px 10px;background:#0070d2;color:#fff;border:none;border-radius:6px;font-family:inherit;font-size:.78rem;cursor:pointer;">Save</button>
  </div>`;
  fillFmtEmojiPickerGrids();
}

function sdemoSaveEdit(id) {
  const ta = document.getElementById('sdemo-edit-ta-' + id);
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) return;
  const q = allQuestions.find(x => x.id === id);
  if (q) q.text = text;
  sdemoRender();
  renderQuestions();
}

function sdemoCancelEdit(id, original) {
  sdemoRender();
}

function sdemoRender() {
  let qs = [...allQuestions];
  if (sdemoFilter === 'pinned') qs = qs.filter(q => q.pinned);
  if (sdemoFilter === 'answered') qs = qs.filter(q => q.status === 'answered');
  if (sdemoFilter === 'unanswered') qs = qs.filter(q => q.status !== 'answered');
  // pinned always first
  qs.sort((a,b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    const at = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
    const bt = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
    return bt - at;
  });

  // update stats
  document.getElementById('sdemo-stat-total').textContent = allQuestions.length;
  document.getElementById('sdemo-stat-ans').textContent = allQuestions.filter(q=>q.status==='answered').length;
  document.getElementById('sdemo-stat-pen').textContent = allQuestions.filter(q=>q.status!=='answered').length;

  const container = document.getElementById('sdemo-questions');
  if (!qs.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:#b0aba4;font-size:.88rem;">No questions here yet.</div>';
    return;
  }

  container.innerHTML = qs.map(q => {
    const mine = q.authorId === sdemoUserId;
    const voted = (q.voters||[]).includes(sdemoUserId);
    return `
    <div style="background:#fff;border:1px solid ${q.pinned?'#6a0dad':'#e2ddd6'};border-radius:10px;padding:.85rem 1rem;${q.pinned?'background:#faf5ff;':''}" >
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.4rem;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:.75rem;font-weight:500;color:#7a7570;">${esc(q.authorName||'Anonymous')}</span>
          ${q.pinned ? '<span style="font-size:.65rem;font-weight:500;padding:2px 6px;border-radius:20px;background:#f3e8ff;color:#6a0dad;">Pinned</span>' : ''}
          ${q.status==='answered' ? '<span style="font-size:.65rem;font-weight:500;padding:2px 6px;border-radius:20px;background:#e8f5e9;color:#2e7d32;">Answered</span>' : '<span style="font-size:.65rem;font-weight:500;padding:2px 6px;border-radius:20px;background:#fff3e0;color:#e65100;">Pending</span>'}
        </div>
        ${mine ? `<button onclick="sdemoOpenEdit('${q.id}')" style="font-size:.72rem;color:#b0aba4;background:none;border:none;cursor:pointer;font-family:inherit;padding:2px 6px;border-radius:4px;">Edit</button>` : ''}
      </div>
      <div class="rich-message" id="sdemo-text-${q.id}" style="font-size:.88rem;line-height:1.55;margin-bottom:.45rem;white-space:pre-wrap;word-break:break-word;">${formatRichMessage(q.text||'')}</div>
      ${(() => {
        const answers = q.answers && q.answers.length ? q.answers : (q.answer ? [{instructor:'Instructor',text:q.answer}] : []);
        return answers.map(a => `
          <div style="background:#e8f2fc;border-left:3px solid #0070d2;border-radius:0 6px 6px 0;padding:.5rem .75rem;margin-top:.4rem;">
            <div style="font-size:.65rem;font-weight:600;color:#0070d2;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.2rem;">${esc(a.instructor||'Instructor')}</div>
            <div class="rich-message" style="font-size:.82rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${formatRichMessage(a.text)}</div>
          </div>`).join('');
      })()}
      <div style="margin-top:.45rem;">
        <button onclick="sdemoToggleUpvote('${q.id}')" style="display:flex;align-items:center;gap:4px;padding:3px 9px;border:1.5px solid ${voted?'#0070d2':'#e2ddd6'};border-radius:20px;background:${voted?'#e8f2fc':'none'};font-family:inherit;font-size:.75rem;color:${voted?'#0070d2':'#7a7570'};cursor:pointer;">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="${voted?'currentColor':'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          ${q.votes||0}
        </button>
      </div>
    </div>`;
  }).join('');
}

// patch resetDemo to also reset student view state and re-render if open
// patch resetDemo to also reset student view state and re-render if open
function resetDemo() {
  try {
    sessionStorage.removeItem(DEMO_SESSIONS_HIDDEN_KEY);
    sessionStorage.removeItem(DEMO_SESSIONS_HIDDEN_LEGACY);
  } catch (e) {}
  const qs = DEMO_QUESTIONS_TEMPLATE.map(q => ({...q, voters: [...q.voters]}));
  questionPages = [{ questions: qs, endSnap: null }];
  currentQuestionPage = 0;
  hasMoreOlder = false;
  instructorOlderBeyondLoadExhausted = true;
  const rs = document.getElementById('instr-questions-search');
  if (rs) rs.value = '';
  rebuildAllQuestions();
  allSessions = [DEMO_SESSION];
  activeSessionCode = DEMO_SESSION_CODE;
  persistInstructorActiveSession(DEMO_SESSION_CODE);
  sdemoUserId = 'demo-student-' + Math.random().toString(36).slice(2,8);
  renderSessionsList();
  renderQuestions();
  updateStats();
  updateInstructorPaginationUi();
  fillSessionForm(DEMO_SESSION);
  syncActiveCodeBadge();
  if (studentViewOpen) sdemoRender();
  showToast('Demo data reset!');
}
// ── END STUDENT DEMO VIEW ───────────────────────

function insertSlackFormat(textareaId, mode) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const v = ta.value;
  const sel = v.slice(start, end);
  let ins, c0, c1;
  if (mode === 'fenced') {
    const openLen = '\n```\n'.length;
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
  let before, after, mid;
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
  const ns = start + before.length;
  const ne = ns + mid.length;
  ta.setSelectionRange(ns, ne);
}

/** Large Unicode emoji set — system font renders each; scroll for more. */
const FORMAT_EMOJI_PICKER_RAW = "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁☹😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁👅👄❤🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝💟☮✝☪🕉☸✡🔯🪄🪅🎴🎭🖼🎨🔮🧿🐵🐒🦍🦧🐶🐕🦮🐩🐺🦊🦝🐱🐈🦁🐯🐅🐆🐴🐎🦄🦓🦌🦬🐮🐂🐃🐄🐷🐖🐗🐽🐏🐑🐐🐪🐫🦙🦒🐘🦣🦏🦛🐭🐁🐀🐹🐰🐇🐿🦫🦔🦇🐻🐨🐼🐾🦃🐔🐓🐣🐤🐥🐦🐧🕊🦅🦆🦢🦉🦤🪶🦩🦚🦜🐸🐊🐢🦎🐍🐲🐉🦕🦖🐳🐋🐬🦭🐟🐠🐡🦈🐙🐚🪸🐌🦋🐛🐜🐝🪲🐞🦗🪳🕷🕸🦂🦟🪰🪱🦠💐🌸💮🌹🥀🌺🌻🌼🌷🪻🌱🪴🌲🌳🌴🌵🌾🌿☘🍀🍁🍂🍃🪹🪺🍄🍇🍈🍉🍊🍋🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🥥🥑🍆🥔🥕🌽🌶🫑🥒🥬🥦🧄🧅🥜🫘🌰🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🦀🦞🦐🦑🦪🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🥤🧋🧃🧉🧊🥢🍽🍴🥄🔪🫙🌍🌎🌏🌐🗺🧭🏔⛰🌋🗻🏕🏖🏜🏝🏞🏟🏛🏗🧱🪨🪵🛖🏘🏚🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬🏭🏯🏰💒🗼🗽⛪🕌🛕🕍⛩🕋⛲⛺🌁🌃🌄🌅🌆🌇🌉♨🎠🛝🎡🎢💈🎪🚂🚃🚄🚅🚆🚇🚈🚉🚊🚝🚞🚋🚌🚍🚎🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🛻🚚🚛🚜🏎🏍🛵🦽🦼🛺🚲🛴🛹🛼🚏🛣🛤⛽🚨🚥🚦🛑🚧⚓🛟⛵🛶🚤🛳⛴🛥🚢✈🛩🛫🛬🪂💺🚁🚟🚠🚡🛰🚀🛸🪐🌠🌌⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛷⛸🥌🎿⛷🏂🏋🤼🤸🤺⛹🤹🧘🏌🏇🧗🚵🚴🏆🥇🥈🥉🏅🎖🏵🎗🎫🎟🩰🎬🎤🎧🎼🎹🥁🪘🎷🎺🎸🪕🎻🪈🎲♟🎯🎳🎮🕹🎰🧩📱📲☎📞📟📠🔋🪫🔌💻🖥🖨⌨🖱🖲💽💾💿📀🧮🎥🎞📽📺📷📸📹📼🔍🔎🕯💡🔦🏮🪔📔📕📖📗📘📙📚📓📒📃📜📄📰🗞📑🔖🏷💰🪙💴💵💶💷💸💳🧾✉📧📨📩📤📥📦📫📪📬📭📮🗳✏✒🖋🖊🖌🖍📝💼📁📂🗂📅📆🗒🗓📇📈📉📊📋📌📍📎🖇📏📐✂🗃🗄🗑🔒🔓🔏🔐🔑🗝🔨🪓⛏⚒🛠🗡⚔🔫🛡🔧🪛🔩⚙🗜⚖🦯🔗⛓🪝🧰🧲🪜💯💢💥💫💦💨🕳💬🗨🗯💭💤🔔🔕📣📢📿🏧🚮🚰♿🚹🚺🚻🚼🚾🛂🛃🛄🛅⚠🚸⛔🚫🚳🚭🚯🚱🚷📵🔞☢☣⬆↗➡↘⬇↙⬅↖↕↔↩↪⤴⤵🔃🔄🔙🔚🔛🔜🔝🛐⚛☯🕎♈♉♊♋♌♍♎♏♐♑♒♓⛎🔀🔁🔂▶⏩⏭⏯◀⏪⏮🔼⏫🔽⏬⏸⏹⏺⏏🎦🔅🔆📶📳📴♀♂⚧✖➕➖➗🟰♾‼⁉❓❔❕❗〰💱💲⚕♻❇✳❎🆎🆑🆘📛🔠🔡🔢🔣🔤⌚⏰⏱⏲🕰🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕡🕖🕢🕗🕣🕘🕤🕙🕥🕚🕦🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞⭐🌟☀🌤⛅🌥☁🌦🌧⛈🌩🌨❄☃⛄🌬🌪🌫🌈☂☔⛱⚡🔥💧🌊🎃🎄🎆🎇🧨✨🎈🎉🎊🎋🎍🎎🎏🎐🎑🧧🎀🎁🧸🪆🃏🀄";
const FORMAT_EMOJI_PICKER_CHARS = Array.from(FORMAT_EMOJI_PICKER_RAW);

function escFmtAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Wrap scrollable grid so ▲/▼ hints are not clipped by overflow-y (pseudo-elements scroll away inside the grid). */
function ensureFmtEmojiGridShell(grid) {
  if (!grid || !grid.parentNode) return null;
  const existing = grid.closest('.fmt-emoji-grid-shell');
  if (existing) {
    const det = grid.closest('details.fmt-emoji-more') || existing._fmtEmojiDetails;
    if (det) {
      det._fmtEmojiShell = existing;
      existing._fmtEmojiDetails = det;
    }
    return existing;
  }
  const shell = document.createElement('div');
  shell.className = 'fmt-emoji-grid-shell';
  const top = document.createElement('div');
  top.className = 'fmt-emoji-scroll-hint fmt-emoji-scroll-hint--top is-hidden';
  top.setAttribute('aria-hidden', 'true');
  top.textContent = '\u25B2';
  top.title = 'More emojis above — scroll up';
  const bot = document.createElement('div');
  bot.className = 'fmt-emoji-scroll-hint fmt-emoji-scroll-hint--bottom is-hidden';
  bot.setAttribute('aria-hidden', 'true');
  bot.textContent = '\u25BC';
  bot.title = 'More emojis below — scroll down';
  const parent = grid.parentNode;
  parent.insertBefore(shell, grid);
  shell.appendChild(top);
  shell.appendChild(grid);
  shell.appendChild(bot);
  const det = grid.closest('details.fmt-emoji-more');
  if (det) {
    det._fmtEmojiShell = shell;
    shell._fmtEmojiDetails = det;
  }
  return shell;
}

/** Grid may live in a shell portaled to document.body — do not use details.querySelector('.fmt-emoji-grid'). */
function getFmtEmojiGridForDetails(details) {
  if (!details) return null;
  if (details._fmtEmojiShell) return details._fmtEmojiShell.querySelector('.fmt-emoji-grid');
  return details.querySelector('.fmt-emoji-grid');
}

/** Move picker out of nested cards so fixed + z-index stacks at the viewport root (avoids sibling paint-order bugs). */
function mountFmtEmojiShellToBody(details) {
  if (!details || !details.open) return;
  const grid = getFmtEmojiGridForDetails(details);
  if (!grid) return;
  ensureFmtEmojiGridShell(grid);
  const shell = details._fmtEmojiShell;
  if (!shell || shell.parentNode === document.body) return;
  document.body.appendChild(shell);
}

function updateFmtEmojiGridOverflowClasses(grid) {
  if (!grid || !grid.isConnected) return;
  const sh = grid.scrollHeight;
  const ch = grid.clientHeight;
  const EPS = 4;
  const hasMore = sh > ch + EPS;
  grid.classList.toggle('fmt-emoji-grid--has-overflow', hasMore);
  const atEnd = grid.scrollTop + ch >= sh - EPS;
  grid.classList.toggle('fmt-emoji-grid--scrolled-end', atEnd);
  const atStart = grid.scrollTop <= EPS;
  const shell = grid.closest('.fmt-emoji-grid-shell');
  const hintTop = shell && shell.querySelector('.fmt-emoji-scroll-hint--top');
  const hintBot = shell && shell.querySelector('.fmt-emoji-scroll-hint--bottom');
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
  /* Grid flags drive inset shadows only (arrows are on .fmt-emoji-grid-shell). */
  grid.classList.toggle('fmt-emoji-grid--hint-up', hasMore && !atStart);
  grid.classList.toggle('fmt-emoji-grid--hint-down', hasMore && !atEnd);
}

function bindFmtEmojiGridResizeObserver(grid) {
  if (!grid || grid._fmtEmojiRo || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => {
    updateFmtEmojiGridOverflowClasses(grid);
  });
  grid._fmtEmojiRo = ro;
  ro.observe(grid);
  const shell = grid.closest('.fmt-emoji-grid-shell');
  if (shell) ro.observe(shell);
}

function clearFmtEmojiGridDock(grid) {
  if (!grid) return;
  const shell = grid.closest('.fmt-emoji-grid-shell');
  if (shell && shell.parentNode === document.body && shell._fmtEmojiDetails) {
    const det = shell._fmtEmojiDetails;
    const sum = det.querySelector('summary.fmt-more-summary');
    if (sum) det.insertBefore(shell, sum.nextSibling);
    else det.appendChild(shell);
  }
  if (grid._fmtEmojiRo) {
    grid._fmtEmojiRo.disconnect();
    grid._fmtEmojiRo = null;
  }
  const dock = shell || grid;
  ['position', 'top', 'right', 'bottom', 'left', 'width', 'maxHeight', 'zIndex', 'margin', 'marginTop', 'marginBottom'].forEach((p) => {
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
    shell.querySelectorAll('.fmt-emoji-scroll-hint').forEach((el) => {
      el.classList.add('is-hidden');
      el.classList.remove('fmt-emoji-scroll-hint--dim');
    });
  }
}

/** Preferred picker height when viewport allows (panel is position:fixed — not clamped to parent cards). */
const EMOJI_PANEL_PREFERRED_PX = 380;

function positionFmtEmojiMore(details) {
  if (!details || !details.open) return;
  const grid = getFmtEmojiGridForDetails(details);
  const sum = details.querySelector('summary');
  if (!grid || !sum) return;
  ensureFmtEmojiGridShell(grid);
  const shell = grid.closest('.fmt-emoji-grid-shell');
  const dock = shell || grid;
  ['position', 'top', 'right', 'bottom', 'left', 'width', 'maxHeight', 'zIndex', 'margin', 'marginTop', 'marginBottom'].forEach((p) => {
    try { grid.style.removeProperty(p); } catch (e) {}
  });

  const rect = sum.getBoundingClientRect();
  const gap = 8;
  const vwPad = 8;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  /* Viewport only: .q-card used to shrink this, but the picker overlays the page and felt unusably small. */
  const belowSlice = vh - rect.bottom - gap - vwPad;
  const aboveSlice = rect.top - gap - vwPad;
  const panelMax = Math.min(480, vh * 0.62);
  const preferBelow = belowSlice >= Math.min(panelMax, 220) || (belowSlice >= aboveSlice && belowSlice >= 100);
  grid.classList.remove('fmt-emoji-grid--flip-above');
  if (shell) shell.classList.remove('fmt-emoji-grid-shell--flip-above');

  const w = Math.min(380, vw - vwPad * 2);
  let left = rect.right - w;
  left = Math.max(vwPad, Math.min(left, vw - w - vwPad));

  const preferredH = Math.min(EMOJI_PANEL_PREFERRED_PX, panelMax);
  let capPx;
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
  requestAnimationFrame(() => updateFmtEmojiGridOverflowClasses(grid));
}

function disconnectFmtEmojiSummaryObserver(details) {
  const sum = details && details.querySelector('summary.fmt-more-summary');
  if (sum && sum._fmtEmojiIo) {
    sum._fmtEmojiIo.disconnect();
    sum._fmtEmojiIo = null;
  }
}

function initFmtEmojiPickerLayout() {
  let rafRe = 0;
  function scheduleEmojiPickerReposition() {
    cancelAnimationFrame(rafRe);
    rafRe = requestAnimationFrame(() => {
      document.querySelectorAll('details.fmt-emoji-more[open]').forEach(positionFmtEmojiMore);
      document.querySelectorAll('details.fmt-emoji-more[open]').forEach((det) => {
        const g = getFmtEmojiGridForDetails(det);
        if (g) updateFmtEmojiGridOverflowClasses(g);
      });
    });
  }

  document.addEventListener('toggle', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('details.fmt-emoji-more')) return;
    const g = t.querySelector('.fmt-emoji-grid');
    if (!t.open) {
      disconnectFmtEmojiSummaryObserver(t);
      clearFmtEmojiGridDock(getFmtEmojiGridForDetails(t));
      return;
    }
    requestAnimationFrame(() => {
      const sum = t.querySelector('summary.fmt-more-summary');
      if (sum && typeof IntersectionObserver !== 'undefined') {
        disconnectFmtEmojiSummaryObserver(t);
        sum._fmtEmojiIo = new IntersectionObserver(
          () => { scheduleEmojiPickerReposition(); },
          { root: null, threshold: Array.from({ length: 21 }, (_, i) => i / 20) }
        );
        sum._fmtEmojiIo.observe(sum);
      }
      if (g) ensureFmtEmojiGridShell(g);
      mountFmtEmojiShellToBody(t);
      positionFmtEmojiMore(t);
      const g2 = getFmtEmojiGridForDetails(t);
      if (!g2) return;
      updateFmtEmojiGridOverflowClasses(g2);
      bindFmtEmojiGridResizeObserver(g2);
      if (!g2._fmtEmojiScrollBound) {
        g2._fmtEmojiScrollBound = true;
        g2.addEventListener('scroll', () => updateFmtEmojiGridOverflowClasses(g2), { passive: true });
      }
    });
  }, true);

  /* Scroll does not bubble: capture on window+document catches nested overflow scrollers (e.g. .main-panel, #sdemo-questions). */
  const cap = { passive: true, capture: true };
  window.addEventListener('scroll', scheduleEmojiPickerReposition, cap);
  document.addEventListener('scroll', scheduleEmojiPickerReposition, cap);
  window.addEventListener('resize', scheduleEmojiPickerReposition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('scroll', scheduleEmojiPickerReposition, { passive: true });
    window.visualViewport.addEventListener('resize', scheduleEmojiPickerReposition, { passive: true });
  }
}

function fillFmtEmojiPickerGrids() {
  document.querySelectorAll('.fmt-emoji-grid[data-emoji-picker-autofill]').forEach(grid => {
    const tid = grid.getAttribute('data-emoji-target-id');
    if (!tid) return;
    ensureFmtEmojiGridShell(grid);
    grid.innerHTML = FORMAT_EMOJI_PICKER_CHARS.map(ch =>
      '<button type="button" class="fmt-btn fmt-emoji fmt-emoji-picker-cell" data-emoji-target="' + escFmtAttr(tid) + '" data-ch="' + escFmtAttr(ch) + '" title="Insert" aria-label="Insert emoji">' + ch + '</button>'
    ).join('');
    requestAnimationFrame(() => {
      const shell = grid.closest('.fmt-emoji-grid-shell');
      const det = (shell && shell._fmtEmojiDetails) || grid.closest('details.fmt-emoji-more');
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
  const ta = document.getElementById(textareaId);
  if (!ta || ch == null) return;
  ch = String(ch);
  const start = ta.selectionStart, end = ta.selectionEnd;
  const v = ta.value;
  ta.value = v.slice(0, start) + ch + v.slice(end);
  ta.focus();
  const p = start + ch.length;
  ta.setSelectionRange(p, p);
}

function closeFmtEmojiDetails(detailsId) {
  const d = document.getElementById(detailsId);
  if (d) d.open = false;
}

function instructorFormatToolbarAttrId(textareaId) {
  return String(textareaId).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function instructorFormatToolbarHtml(textareaId) {
  const safe = instructorFormatToolbarAttrId(textareaId);
  return `<div class="format-toolbar format-toolbar--compact" data-fmt-target="${safe}" role="toolbar" aria-label="Insert formatting">
    <span class="format-toolbar-label">Format</span>
    <button type="button" class="fmt-btn fmt-btn-b" data-fmt="bold" title="Bold" aria-label="Bold"><strong>B</strong></button>
    <button type="button" class="fmt-btn fmt-btn-i" data-fmt="italic" title="Italic" aria-label="Italic"><em>I</em></button>
    <button type="button" class="fmt-btn fmt-btn-s" data-fmt="strike" title="Strikethrough" aria-label="Strikethrough"><span style="text-decoration:line-through;">S</span></button>
    <button type="button" class="fmt-btn fmt-btn-mono" data-fmt="code" title="Inline code" aria-label="Inline code">\`</button>
    <button type="button" class="fmt-btn fmt-btn-mono" data-fmt="fenced" title="Code block" aria-label="Code block">{ }</button>
    <span class="fmt-sep" aria-hidden="true"></span>
    <button type="button" class="fmt-btn fmt-emoji" data-emoji="👍" title="Thumbs up">👍</button>
    <button type="button" class="fmt-btn fmt-emoji" data-emoji="✅" title="Check">✅</button>
    <button type="button" class="fmt-btn fmt-emoji" data-emoji="💡" title="Idea">💡</button>
    <details class="fmt-emoji-more">
      <summary class="fmt-more-summary" title="More emojis — opens below or above to fit (Unicode)">⋯</summary>
      <div class="fmt-emoji-grid" data-emoji-picker-autofill data-emoji-target-id="${escFmtAttr(textareaId)}" role="group" aria-label="More emojis"></div>
    </details>
  </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  initFmtEmojiPickerLayout();
  fillFmtEmojiPickerGrids();
  document.getElementById('signin-pin').addEventListener('keydown', e => { if (e.key==='Enter') instructorLogin(); });
  document.getElementById('reg-pin2').addEventListener('keydown', e => { if (e.key==='Enter') instructorRegister(); });
  let instrSearchTimer = null;
  const isSearch = document.getElementById('instr-questions-search');
  if (isSearch) {
    isSearch.addEventListener('input', () => {
      clearTimeout(instrSearchTimer);
      instrSearchTimer = setTimeout(() => {
        renderQuestions();
        updateInstructorPaginationUi();
      }, 200);
    });
  }
  const qListFmt = document.getElementById('questions-list');
  if (qListFmt) {
    qListFmt.addEventListener('click', function (e) {
      const fmtBtn = e.target.closest('.format-toolbar[data-fmt-target] .fmt-btn[data-fmt]');
      const emBtn = e.target.closest('.format-toolbar[data-fmt-target] .fmt-btn[data-emoji]');
      if (!fmtBtn && !emBtn) return;
      const bar = (fmtBtn || emBtn).closest('.format-toolbar[data-fmt-target]');
      if (!bar) return;
      const tid = bar.getAttribute('data-fmt-target');
      if (!tid) return;
      e.preventDefault();
      if (fmtBtn) insertSlackFormat(tid, fmtBtn.getAttribute('data-fmt'));
      else insertEmoji(tid, emBtn.getAttribute('data-emoji'));
      const det = (fmtBtn || emBtn).closest('details');
      if (det) det.open = false;
    });
  }
  document.body.addEventListener('click', (e) => {
    const pick = e.target.closest && e.target.closest('.fmt-emoji-picker-cell[data-emoji-target]');
    if (pick) {
      e.preventDefault();
      const tid = pick.getAttribute('data-emoji-target');
      const ch = pick.getAttribute('data-ch');
      if (tid && ch != null) insertEmoji(tid, ch);
      const shellPick = pick.closest('.fmt-emoji-grid-shell');
      const detPick = (shellPick && shellPick._fmtEmojiDetails) || pick.closest('details');
      if (detPick) detPick.open = false;
      return;
    }
    const btn = e.target.closest && e.target.closest('.rich-copy-btn');
    if (!btn) return;
    e.preventDefault();
    copyRichCodeBlockInstr(btn);
  });
  function closeFmtEmojiPickersIfOutside(e) {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    document.querySelectorAll('details.fmt-emoji-more[open]').forEach((d) => {
      if (d.contains(t)) return;
      const shell = d._fmtEmojiShell;
      if (shell && shell.contains(t)) return;
      d.open = false;
    });
  }
  /* Capture so this runs before other handlers; pointerdown + touchstart for outside dismiss. */
  document.addEventListener('pointerdown', closeFmtEmojiPickersIfOutside, true);
  document.addEventListener('touchstart', closeFmtEmojiPickersIfOutside, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('details.fmt-emoji-more[open]').forEach((d) => { d.open = false; });
  });
});

Object.assign(globalThis, {
  instructorLogin,
  enterDemoMode,
  switchMode,
  instructorRegister,
  resetDemo,
  toggleStudentView,
  copyCode,
  instructorLogout,
  toggleSection,
  openJoinSessionModal,
  openCreateSessionModal,
  setFilter,
  saveSession,
  insertSlackFormat,
  insertEmoji,
  saveSessionNote,
  addInstructor,
  setSort,
  clearInstructorSearch,
  sdemoSubmit,
  sdemoSetFilter,
  closeJoinSessionModal,
  instructorJoinSession,
  closeCreateSessionModal,
  confirmCreateSession,
  closeDelete,
  confirmDelete,
  removeInstructor,
  goInstructorPreviousPage,
  goInstructorToPage,
  goInstructorNextPage,
  selectSession,
  hideSessionFromList,
  deleteAnswer,
  saveAnswer,
  togglePin,
  setStatus,
  openDelete,
  sdemoCancelEdit,
  sdemoSaveEdit,
  sdemoOpenEdit,
  sdemoToggleUpvote,
});
