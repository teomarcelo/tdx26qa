import { create } from 'zustand';
// Demo fixtures now live in a shared module so the instructor demo and the
// student demo (student.html?demo=1) render identical seed data. Re-exported
// below so existing importers of this store keep working unchanged.
import {
  DEMO_SESSION_CODE,
  DEMO_INSTRUCTOR_NAME,
  DEMO_CO_INSTRUCTORS,
  DEMO_INSTRUCTOR_OWNER_ID,
  DEMO_SESSION,
  DEMO_QUESTIONS_TEMPLATE,
  DEMO_FEEDBACK_TEMPLATE,
  freshDemoQuestions,
  freshDemoFeedback,
  freshDemoSession,
} from '../../lib/demoData.js';

export {
  DEMO_SESSION_CODE,
  DEMO_INSTRUCTOR_NAME,
  DEMO_CO_INSTRUCTORS,
  DEMO_INSTRUCTOR_OWNER_ID,
  DEMO_SESSION,
  DEMO_QUESTIONS_TEMPLATE,
  DEMO_FEEDBACK_TEMPLATE,
  freshDemoQuestions,
  freshDemoFeedback,
  freshDemoSession,
};

const useInstructorStore = create((set, get) => ({
  // Auth
  currentInstructor: null,      // editable DISPLAY name (what students see)
  instructorOwnerId: null,      // session-lookup key (from verified Google email)
  instructorLegacyOwnerId: null,// pre-OAuth name-based id, still queried so old sessions show
  // The verified Google email, set by the auth listener in InstructorApp. This is
  // the ownership identity — the same value the token carries and the only thing
  // firestore.rules compares against a session's ownerEmail — and it is here so
  // instructorOwnsSession can decide during render without awaiting auth.
  instructorEmail: null,
  isDemoMode: false,

  // Sessions
  allSessions: [],
  activeSessionCode: null,
  instructorSessionsHydrated: false,

  // Questions
  // Pages carry `stale: true` once a new question shifts page 0's boundary: their
  // cached cursors no longer line up, so they are refetched when navigated into
  // (see useQuestions). They stay in the array meanwhile because search and the
  // votes sort read every cached page.
  questionPages: [],      // [{ questions: [...], endSnap, stale }]
  currentPage: 0,
  questionsLoading: false, // true only while "Load older" fetches an extra page
  questionsHydrated: false,// false until the active session's first snapshot lands
  instructorOlderBeyondLoadExhausted: false,
  allQuestions: [],       // derived from questionPages[currentPage]

  // UI state
  currentFilter: 'all',   // 'all' | 'pinned' | 'pending' | 'answered'
  currentSort: 'recent',  // 'recent' | 'votes'
  searchQuery: '',

  // Answer editing
  answerDrafts: {},        // { [questionId]: string }
  pendingAnswerImages: {}, // { [questionId]: string[] }
  // `identity` (from answerIdentity()) is what the write commits to; `index` is
  // only a hint, since a co-instructor's reply shifts every later position.
  answerEditState: null,   // { qId, index, identity } | null

  // Session notes editor
  sessionNotesDraft: [],
  // The remote sessionNotes array as it looked when the draft was hydrated. Used
  // as the common ancestor when merging a save against a co-instructor's changes.
  sessionNotesBase: [],
  sessionNoteShow: true,

  // Modals
  deleteTargetId: null,
  joinSessionModalOpen: false,
  createSessionModalOpen: false,

  // Student view overlay
  studentViewOpen: false,

  // Stats serial (cancels stale requests)
  statsSerial: 0,

  // Stats values (shown in sidebar)
  stats: { total: 0, answered: 0, pending: 0, pinned: 0 },

  // Toast
  toast: { message: '', visible: false },

  // Demo-only, in-memory session feedback (seeded + appended from the demo
  // student view; never read from or written to Firestore).
  demoFeedback: freshDemoFeedback(),
  // Bumped on Reset Demo so the demo student view remounts and clears its local
  // UI state (voters, edit drafts, search, sort, feed toggle).
  demoResetNonce: 0,

  // Actions
  setCurrentInstructor: (name) => set({ currentInstructor: name }),
  // Set the stable identity separately from the display name. ownerId is required;
  // legacyOwnerId/email are optional (null when unknown, e.g. demo or direct access).
  setInstructorIdentity: ({ ownerId, legacyOwnerId = null, email = null }) => set({
    instructorOwnerId: ownerId || null,
    instructorLegacyOwnerId: legacyOwnerId || null,
    instructorEmail: email || null,
  }),
  setIsDemoMode: (val) => set({ isDemoMode: val }),
  setAllSessions: (sessions) => set({ allSessions: sessions }),
  setActiveSessionCode: (code) => set({ activeSessionCode: code }),

  setQuestionPages: (pages) => set((state) => {
    const cur = pages[state.currentPage];
    const allQuestions = cur && cur.questions ? cur.questions.slice() : [];
    return { questionPages: pages, allQuestions };
  }),

  setCurrentPage: (page) => set((state) => {
    const cur = state.questionPages[page];
    const allQuestions = cur && cur.questions ? cur.questions.slice() : [];
    return { currentPage: page, allQuestions };
  }),

  // Replace the pages and land on a page in ONE update. Refetching stale pages can
  // shorten the array, and doing that as two updates renders an empty list for a
  // frame while currentPage still points past the end.
  setQuestionPagesAndPage: (pages, page) => set(() => {
    const idx = Math.max(0, Math.min(page, pages.length - 1));
    const cur = pages[idx];
    return {
      questionPages: pages,
      currentPage: idx,
      allQuestions: cur && cur.questions ? cur.questions.slice() : [],
    };
  }),

  rebuildAllQuestions: () => set((state) => {
    const cur = state.questionPages[state.currentPage];
    const allQuestions = cur && cur.questions ? cur.questions.slice() : [];
    return { allQuestions };
  }),

  setCurrentFilter: (f) => set({ currentFilter: f }),
  setCurrentSort: (s) => set({ currentSort: s }),
  setSearchQuery: (q) => set({ searchQuery: q }),

  setAnswerDraft: (qId, text) => set(state => ({ answerDrafts: { ...state.answerDrafts, [qId]: text } })),
  clearAnswerDraft: (qId) => set(state => {
    const drafts = { ...state.answerDrafts };
    delete drafts[qId];
    return { answerDrafts: drafts };
  }),
  setPendingAnswerImages: (qId, urls) => set(state => ({ pendingAnswerImages: { ...state.pendingAnswerImages, [qId]: urls } })),
  clearPendingAnswerImages: (qId) => set(state => {
    const imgs = { ...state.pendingAnswerImages };
    delete imgs[qId];
    return { pendingAnswerImages: imgs };
  }),
  setAnswerEditState: (editState) => set({ answerEditState: editState }),

  setSessionNotesDraft: (notes) => set({ sessionNotesDraft: notes }),
  setSessionNotesBase: (notes) => set({ sessionNotesBase: notes }),
  setSessionNoteShow: (val) => set({ sessionNoteShow: val }),

  setDeleteTargetId: (id) => set({ deleteTargetId: id }),
  openDeleteModal: (id) => set({ deleteTargetId: id }),
  closeDeleteModal: () => set({ deleteTargetId: null }),

  setJoinSessionModalOpen: (v) => set({ joinSessionModalOpen: v }),
  setCreateSessionModalOpen: (v) => set({ createSessionModalOpen: v }),

  setStudentViewOpen: (v) => set({ studentViewOpen: v }),

  incrementStatsSerial: () => set(state => ({ statsSerial: state.statsSerial + 1 })),
  setStats: (stats) => set({ stats }),

  setInstructorSessionsHydrated: (v) => set({ instructorSessionsHydrated: v }),
  setQuestionsLoading: (v) => set({ questionsLoading: v }),
  setQuestionsHydrated: (v) => set({ questionsHydrated: v }),
  setInstructorOlderBeyondLoadExhausted: (v) => set({ instructorOlderBeyondLoadExhausted: v }),

  // Drop the outgoing session's questions as soon as the active session changes.
  // The cached pages otherwise survive the switch and render under the incoming
  // session's header until its first snapshot replaces them.
  resetQuestionsForSession: () => set({
    questionPages: [],
    allQuestions: [],
    currentPage: 0,
    questionsHydrated: false,
    instructorOlderBeyondLoadExhausted: false,
  }),

  showToast: (message) => {
    set({ toast: { message, visible: true } });
    setTimeout(() => set({ toast: { message: '', visible: false } }), 2500);
  },

  // Prepend an in-memory feedback entry (demo student view → instructor feedback list).
  addDemoFeedback: (entry) => set(state => ({ demoFeedback: [entry, ...state.demoFeedback] })),

  // Re-seed ALL demo data + reset the demo-facing UI state in one place. Shared by
  // both Reset Demo buttons (instructor top bar + student view overlay) so they can
  // never drift. Only demo/UI state is touched — never real/authed state.
  resetDemoState: () => set(state => {
    const qs = freshDemoQuestions();
    return {
      currentInstructor: DEMO_INSTRUCTOR_NAME,
      allSessions: [freshDemoSession()],
      activeSessionCode: DEMO_SESSION_CODE,
      questionPages: [{ questions: qs, endSnap: null }],
      currentPage: 0,
      allQuestions: qs,
      questionsHydrated: true,
      instructorOlderBeyondLoadExhausted: true,
      currentFilter: 'all',
      currentSort: 'recent',
      searchQuery: '',
      answerDrafts: {},
      pendingAnswerImages: {},
      answerEditState: null,
      demoFeedback: freshDemoFeedback(),
      demoResetNonce: state.demoResetNonce + 1,
    };
  }),

  // Update a question in-place within all pages (for demo mode mutations)
  updateQuestionInPages: (qId, updater) => set(state => {
    const questionPages = state.questionPages.map(page => ({
      ...page,
      questions: page.questions.map(q => q.id === qId ? updater(q) : q),
    }));
    const cur = questionPages[state.currentPage];
    const allQuestions = cur && cur.questions ? cur.questions.slice() : [];
    return { questionPages, allQuestions };
  }),

  // Remove a question from all pages (for delete)
  removeQuestionFromPages: (qId) => set(state => {
    const questionPages = state.questionPages.map(page => ({
      ...page,
      questions: page.questions.filter(q => q.id !== qId),
    }));
    const cur = questionPages[state.currentPage];
    const allQuestions = cur && cur.questions ? cur.questions.slice() : [];
    const answerDrafts = { ...state.answerDrafts };
    const pendingAnswerImages = { ...state.pendingAnswerImages };
    delete answerDrafts[qId];
    delete pendingAnswerImages[qId];
    return { questionPages, allQuestions, answerDrafts, pendingAnswerImages };
  }),

  // Prepend a question to page 0 (for sdemo submit)
  prependQuestion: (q) => set(state => {
    const questionPages = state.questionPages.length > 0
      ? state.questionPages.map((page, i) => i === 0
          ? { ...page, questions: [q, ...page.questions] }
          : page
        )
      : [{ questions: [q], endSnap: null }];
    const cur = questionPages[state.currentPage];
    const allQuestions = cur && cur.questions ? cur.questions.slice() : [];
    return { questionPages, allQuestions };
  }),

  // Full reset for logout / new login
  resetForLogin: () => set({
    currentInstructor: null,
    instructorOwnerId: null,
    instructorLegacyOwnerId: null,
    instructorEmail: null,
    isDemoMode: false,
    allSessions: [],
    activeSessionCode: null,
    instructorSessionsHydrated: false,
    questionPages: [],
    currentPage: 0,
    questionsLoading: false,
    questionsHydrated: false,
    instructorOlderBeyondLoadExhausted: false,
    allQuestions: [],
    currentFilter: 'all',
    currentSort: 'recent',
    searchQuery: '',
    answerDrafts: {},
    pendingAnswerImages: {},
    answerEditState: null,
    sessionNotesDraft: [],
    sessionNotesBase: [],
    sessionNoteShow: true,
    deleteTargetId: null,
    joinSessionModalOpen: false,
    createSessionModalOpen: false,
    studentViewOpen: false,
    stats: { total: 0, answered: 0, pending: 0, pinned: 0 },
    demoFeedback: freshDemoFeedback(),
    demoResetNonce: 0,
  }),
}));

export default useInstructorStore;
