/**
 * InstructorSidebar — collapsible accordion sections.
 * Sidebar resize/collapse is handled via vanilla JS in useEffect (pointer events + DOM geometry).
 * Accordion collapse state is persisted in localStorage.
 */
import { useEffect, useRef } from 'react';
import useInstructorStore from '../../store/useInstructorStore.js';
import SessionsList from './SessionsList.jsx';
import SessionSettings from './SessionSettings.jsx';
import InstructorManager from './InstructorManager.jsx';
import FilterSort from './FilterSort.jsx';
import StatsSection from './StatsSection.jsx';
import SessionNotesEditor from './SessionNotesEditor.jsx';
import SessionFeedbackList from './SessionFeedbackList.jsx';

// ── Sidebar accordion ──────────────────────────────────────────
const INSTR_SECTION_COLLAPSE_LS = 'sqa_instructor_section_collapsed_v1';
const INSTR_SECTION_IDS = [
  'sec-sessions', 'sec-session', 'sec-stats', 'sec-filters',
  'sec-session-sidebar', 'sec-session-feedback',
];

function readCollapseOverrides() {
  try {
    const raw = localStorage.getItem(INSTR_SECTION_COLLAPSE_LS);
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return {};
    const out = {};
    INSTR_SECTION_IDS.forEach(sid => {
      if (Object.prototype.hasOwnProperty.call(o, sid) && typeof o[sid] === 'boolean') out[sid] = o[sid];
    });
    return out;
  } catch (e) { return {}; }
}

function persistCollapseOverrides(overrides) {
  try { localStorage.setItem(INSTR_SECTION_COLLAPSE_LS, JSON.stringify(overrides)); } catch (e) {}
}

function SideSection({ id, label, defaultCollapsed = false, children }) {
  const sectionRef = useRef(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const overrides = readCollapseOverrides();
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      el.classList.toggle('collapsed', !!overrides[id]);
    } else if (defaultCollapsed) {
      el.classList.add('collapsed');
    }
  }, [id, defaultCollapsed]);

  const toggle = () => {
    const el = sectionRef.current;
    if (!el) return;
    el.classList.toggle('collapsed');
    const overrides = readCollapseOverrides();
    overrides[id] = el.classList.contains('collapsed');
    persistCollapseOverrides(overrides);
  };

  return (
    <div className="side-section" id={id} ref={sectionRef}>
      <div className="side-section-header" onClick={toggle}>
        <span className="side-label">{label}</span>
        <span className="side-chevron">▾</span>
      </div>
      <div className="side-section-body">
        {children}
      </div>
    </div>
  );
}

// ── Sidebar resizer ────────────────────────────────────────────
const INSTR_SIDEBAR_LS_W = 'sqa_instructor_sidebar_px';
const INSTR_SIDEBAR_LS_COLLAPSED = 'sqa_instructor_sidebar_collapsed';
const INSTR_SIDEBAR_MIN = 220;
const INSTR_SIDEBAR_DEFAULT = 320;

function sidebarIsStacked() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
}

function getMaxPx() {
  const vw = typeof window.innerWidth === 'number' ? window.innerWidth : 1024;
  return Math.max(INSTR_SIDEBAR_MIN, Math.min(520, Math.floor(vw * 0.46)));
}

function clampW(w) {
  return Math.max(INSTR_SIDEBAR_MIN, Math.min(getMaxPx(), Math.round(Number(w) || INSTR_SIDEBAR_DEFAULT)));
}

function readCollapsed() {
  try { return localStorage.getItem(INSTR_SIDEBAR_LS_COLLAPSED) === '1'; } catch (e) { return false; }
}

function readWidthPx() {
  try {
    const v = localStorage.getItem(INSTR_SIDEBAR_LS_W);
    if (v != null && v !== '') return clampW(parseInt(v, 10));
  } catch (e) {}
  return INSTR_SIDEBAR_DEFAULT;
}

function persistState(collapsed, w) {
  try {
    if (collapsed) {
      localStorage.setItem(INSTR_SIDEBAR_LS_COLLAPSED, '1');
    } else {
      localStorage.removeItem(INSTR_SIDEBAR_LS_COLLAPSED);
      localStorage.setItem(INSTR_SIDEBAR_LS_W, String(clampW(w)));
    }
  } catch (e) {}
}

function applyToDom(layout) {
  const resizer = document.getElementById('instr-sidebar-resizer');
  if (!layout) return;
  const maxPx = getMaxPx();
  if (sidebarIsStacked()) {
    layout.classList.remove('app-body--sidebar-collapsed');
    layout.style.removeProperty('--instr-sidebar-px');
    if (resizer) { resizer.setAttribute('aria-hidden', 'true'); resizer.setAttribute('tabindex', '-1'); }
    return;
  }
  if (resizer) { resizer.removeAttribute('aria-hidden'); resizer.setAttribute('tabindex', '0'); }
  const collapsed = readCollapsed();
  const w = clampW(readWidthPx());
  layout.classList.toggle('app-body--sidebar-collapsed', collapsed);
  layout.style.setProperty('--instr-sidebar-px', collapsed ? '0px' : `${w}px`);
  if (resizer) {
    resizer.setAttribute('aria-valuenow', String(collapsed ? 0 : w));
    resizer.setAttribute('aria-valuemin', String(collapsed ? 0 : INSTR_SIDEBAR_MIN));
    resizer.setAttribute('aria-valuemax', String(maxPx));
    resizer.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

export default function InstructorSidebar() {
  const activeSessionCode = useInstructorStore(s => s.activeSessionCode);
  const hasSession = !!activeSessionCode;

  // Wire sidebar resizer with vanilla JS (pointer events + geometry)
  useEffect(() => {
    const layout = document.getElementById('instr-app-body');
    const track = document.getElementById('instr-sidebar-resizer-track');
    const resizer = document.getElementById('instr-sidebar-resizer');
    if (!layout || !track || !resizer) return;

    let drag = null;

    const endDrag = () => {
      if (!drag) return;
      const pid = drag.pointerId;
      const lastW = drag.lastW;
      drag = null;
      document.body.classList.remove('instr-sidebar-is-resizing');
      try { if (track.releasePointerCapture && pid != null) track.releasePointerCapture(pid); } catch (e) {}
      persistState(false, lastW);
      applyToDom(layout);
    };

    const onPointerDown = (e) => {
      if (e.button !== 0 || sidebarIsStacked()) return;
      e.preventDefault();
      const side = document.getElementById('instr-side-panel');
      let startW;
      if (layout.classList.contains('app-body--sidebar-collapsed')) {
        startW = clampW(readWidthPx());
        layout.classList.remove('app-body--sidebar-collapsed');
        try { localStorage.removeItem(INSTR_SIDEBAR_LS_COLLAPSED); } catch (err) {}
        layout.style.setProperty('--instr-sidebar-px', `${startW}px`);
      } else {
        const rw = side && side.getBoundingClientRect ? side.getBoundingClientRect().width : 0;
        startW = clampW(rw > 40 ? rw : readWidthPx());
      }
      drag = { startX: e.clientX, startW, lastW: startW, pointerId: e.pointerId };
      document.body.classList.add('instr-sidebar-is-resizing');
      try { track.setPointerCapture(e.pointerId); } catch (e2) {}
    };

    const onPointerMove = (e) => {
      if (!drag) return;
      const nw = clampW(drag.startW + (e.clientX - drag.startX));
      drag.lastW = nw;
      layout.classList.remove('app-body--sidebar-collapsed');
      try { localStorage.removeItem(INSTR_SIDEBAR_LS_COLLAPSED); } catch (e3) {}
      layout.style.setProperty('--instr-sidebar-px', `${nw}px`);
    };

    const onDblClick = (e) => {
      if (sidebarIsStacked() || drag) return;
      e.preventDefault();
      const collapsed = layout.classList.contains('app-body--sidebar-collapsed');
      if (collapsed) {
        const w = readWidthPx();
        persistState(false, w);
      } else {
        let cur = parseInt(layout.style.getPropertyValue('--instr-sidebar-px'), 10);
        if (!Number.isFinite(cur) || cur <= 0) cur = readWidthPx();
        try { localStorage.setItem(INSTR_SIDEBAR_LS_W, String(clampW(cur))); } catch (e) {}
        try { localStorage.setItem(INSTR_SIDEBAR_LS_COLLAPSED, '1'); } catch (e2) {}
      }
      applyToDom(layout);
    };

    const onKeyDown = (e) => {
      if (sidebarIsStacked()) return;
      const maxPx = getMaxPx();
      let cur = parseInt(layout.style.getPropertyValue('--instr-sidebar-px'), 10);
      if (layout.classList.contains('app-body--sidebar-collapsed')) cur = INSTR_SIDEBAR_MIN;
      if (!Number.isFinite(cur) || cur <= 0) cur = readWidthPx();
      cur = clampW(cur);
      const step = 24;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (!layout.classList.contains('app-body--sidebar-collapsed')) {
          layout.style.setProperty('--instr-sidebar-px', `${clampW(cur + step)}px`);
          persistState(false, clampW(cur + step));
          applyToDom(layout);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!layout.classList.contains('app-body--sidebar-collapsed')) {
          layout.style.setProperty('--instr-sidebar-px', `${clampW(cur - step)}px`);
          persistState(false, clampW(cur - step));
          applyToDom(layout);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (!layout.classList.contains('app-body--sidebar-collapsed')) {
          layout.style.setProperty('--instr-sidebar-px', `${maxPx}px`);
          persistState(false, maxPx);
          applyToDom(layout);
        }
      } else if (e.key === 'End') {
        e.preventDefault();
        if (!layout.classList.contains('app-body--sidebar-collapsed')) {
          layout.style.setProperty('--instr-sidebar-px', `${INSTR_SIDEBAR_MIN}px`);
          persistState(false, INSTR_SIDEBAR_MIN);
          applyToDom(layout);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const isCollapsed = layout.classList.contains('app-body--sidebar-collapsed');
        if (isCollapsed) {
          persistState(false, readWidthPx());
        } else {
          let c2 = parseInt(layout.style.getPropertyValue('--instr-sidebar-px'), 10);
          if (!Number.isFinite(c2) || c2 <= 0) c2 = readWidthPx();
          try { localStorage.setItem(INSTR_SIDEBAR_LS_W, String(clampW(c2))); } catch (e) {}
          try { localStorage.setItem(INSTR_SIDEBAR_LS_COLLAPSED, '1'); } catch (e2) {}
        }
        applyToDom(layout);
      }
    };

    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => applyToDom(layout), 120);
    };

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    resizer.addEventListener('dblclick', onDblClick);
    resizer.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);

    applyToDom(layout);

    // Every listener is removed here, and there is no dataset "already initialised"
    // flag: that flag survived unmount, so StrictMode's second effect pass bailed out
    // and left the app with pass 1's pointer listeners and no resize listener at all.
    return () => {
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', endDrag);
      track.removeEventListener('pointercancel', endDrag);
      resizer.removeEventListener('dblclick', onDblClick);
      resizer.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      document.body.classList.remove('instr-sidebar-is-resizing');
    };
  }, []);

  return (
    <div className="side-panel" id="instr-side-panel">
      <SideSection id="sec-sessions" label="My sessions">
        <SessionsList />
      </SideSection>

      {hasSession && (
        <div id="session-dependent-sections">
          <SideSection id="sec-session" label="Session settings" defaultCollapsed={true}>
            <SessionSettings />
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Instructors</div>
              <InstructorManager />
            </div>
          </SideSection>

          <SideSection id="sec-stats" label="Overview">
            <StatsSection />
          </SideSection>

          <SideSection id="sec-filters" label="Filter" defaultCollapsed={true}>
            <FilterSort />
          </SideSection>

          <SideSection id="sec-session-sidebar" label="Instructor Notes">
            <SessionNotesEditor />
          </SideSection>

          <SideSection id="sec-session-feedback" label="Dashboard feedback" defaultCollapsed={true}>
            <p className="instr-feedback-lead">Anonymous notes from the student dashboard (newest first).</p>
            <SessionFeedbackList />
          </SideSection>
        </div>
      )}
    </div>
  );
}
