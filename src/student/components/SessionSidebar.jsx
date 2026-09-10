import { useEffect, useRef, useState } from 'react';
import SessionInfo from './SessionInfo.jsx';

const STU_SECTION_COLLAPSE_LS = 'sqa_student_section_collapsed_v1';

function readSectionCollapsed(id, defaultVal) {
  try {
    const raw = localStorage.getItem(STU_SECTION_COLLAPSE_LS);
    const o = raw ? JSON.parse(raw) : {};
    if (Object.prototype.hasOwnProperty.call(o, id)) return !!o[id];
  } catch (e) {}
  return defaultVal;
}

function persistSectionCollapsed(id, val) {
  try {
    const raw = localStorage.getItem(STU_SECTION_COLLAPSE_LS);
    const o = raw ? JSON.parse(raw) : {};
    o[id] = val;
    localStorage.setItem(STU_SECTION_COLLAPSE_LS, JSON.stringify(o));
  } catch (e) {}
}

function SideSection({ id, title, defaultCollapsed = false, children }) {
  const [collapsed, setCollapsed] = useState(() => readSectionCollapsed(id, defaultCollapsed));
  function toggle() {
    setCollapsed(prev => {
      const next = !prev;
      persistSectionCollapsed(id, next);
      return next;
    });
  }
  return (
    <div className={`side-section student-side-section${collapsed ? ' student-side-section--collapsed' : ''}`}>
      <div className="student-side-section-header" onClick={toggle} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <span className="side-title" style={{ margin: 0 }}>{title}</span>
        <span className="student-side-chevron" style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-light)', transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'none' }}>▾</span>
      </div>
      {!collapsed && <div className="student-side-section-body">{children}</div>}
    </div>
  );
}

const STUDENT_SIDEBAR_LS_W = 'sqa_student_sidebar_px';
const STUDENT_SIDEBAR_LS_COLLAPSED = 'sqa_student_sidebar_collapsed';
const STUDENT_SIDEBAR_MIN = 240;
const STUDENT_SIDEBAR_DEFAULT = 320;

function safeLsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeLsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function safeLsRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

function sidebarIsStacked() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches;
}

function getMaxPx() {
  const vw = typeof window.innerWidth === 'number' ? window.innerWidth : 1024;
  return Math.max(STUDENT_SIDEBAR_MIN, Math.min(560, Math.floor(vw * 0.48)));
}

function clampW(w) {
  return Math.max(STUDENT_SIDEBAR_MIN, Math.min(getMaxPx(), Math.round(Number(w) || STUDENT_SIDEBAR_DEFAULT)));
}

function readCollapsed() { return safeLsGet(STUDENT_SIDEBAR_LS_COLLAPSED) === '1'; }
function readWidth() {
  const v = safeLsGet(STUDENT_SIDEBAR_LS_W);
  if (v != null && v !== '') return clampW(parseInt(v, 10));
  return STUDENT_SIDEBAR_DEFAULT;
}

function persistState(collapsed, w) {
  if (collapsed) {
    safeLsSet(STUDENT_SIDEBAR_LS_COLLAPSED, '1');
  } else {
    safeLsRemove(STUDENT_SIDEBAR_LS_COLLAPSED);
    safeLsSet(STUDENT_SIDEBAR_LS_W, String(clampW(w)));
  }
}

function updateResizerAria(resizerEl, layoutEl, currentW, maxPx) {
  if (!resizerEl) return;
  const collapsed = layoutEl && layoutEl.classList.contains('app-layout--sidebar-collapsed');
  resizerEl.setAttribute('aria-valuenow', String(collapsed ? 0 : currentW));
  resizerEl.setAttribute('aria-valuemin', String(collapsed ? 0 : STUDENT_SIDEBAR_MIN));
  resizerEl.setAttribute('aria-valuemax', String(maxPx != null ? maxPx : getMaxPx()));
  resizerEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

/**
 * Applies sidebar width / collapsed state to the layout DOM element.
 * All layout geometry is vanilla JS — React's render cycle cannot express
 * live pointer/drag state efficiently.
 */
function applyToDom(layoutEl, resizerEl) {
  if (!layoutEl) return;
  const maxPx = getMaxPx();
  if (sidebarIsStacked()) {
    layoutEl.classList.remove('app-layout--sidebar-collapsed');
    layoutEl.style.removeProperty('--student-sidebar-px');
    if (resizerEl) {
      resizerEl.setAttribute('aria-hidden', 'true');
      resizerEl.setAttribute('tabindex', '-1');
    }
    return;
  }
  if (resizerEl) {
    resizerEl.removeAttribute('aria-hidden');
    resizerEl.setAttribute('tabindex', '0');
  }
  const collapsed = readCollapsed();
  const w = clampW(readWidth());
  layoutEl.classList.toggle('app-layout--sidebar-collapsed', collapsed);
  if (collapsed) {
    layoutEl.style.setProperty('--student-sidebar-px', '0px');
  } else {
    layoutEl.style.setProperty('--student-sidebar-px', w + 'px');
  }
  updateResizerAria(resizerEl, layoutEl, collapsed ? 0 : w, maxPx);
}

function toggleCollapsed(layoutEl, resizerEl) {
  if (sidebarIsStacked()) return;
  if (!layoutEl) return;
  const collapsed = layoutEl.classList.contains('app-layout--sidebar-collapsed');
  if (collapsed) {
    const w = readWidth();
    persistState(false, w);
  } else {
    const curStr = layoutEl.style.getPropertyValue('--student-sidebar-px');
    let cur = parseInt(curStr, 10);
    if (!isFinite(cur) || cur <= 0) cur = readWidth();
    cur = clampW(cur);
    try { safeLsSet(STUDENT_SIDEBAR_LS_W, String(cur)); } catch (e) {}
    try { safeLsSet(STUDENT_SIDEBAR_LS_COLLAPSED, '1'); } catch (e) {}
  }
  applyToDom(layoutEl, resizerEl);
}

/**
 * SessionSidebar — the right column in the app layout.
 *
 * All resize drag geometry is kept as vanilla JS in a useEffect — this is
 * intentional. Pointer capture, getBoundingClientRect, and CSS custom property
 * mutations cannot be driven cleanly through React state without introducing lag.
 */
export default function SessionSidebar({
  currentSession,
  sessionCode,
  userId,
  userName,
  stats,
  showToast,
  onOpenFeedback,
}) {
  const layoutRef = useRef(null);
  const resizerRef = useRef(null);
  const trackRef = useRef(null);

  // Wire up drag and keyboard resizing with vanilla JS
  useEffect(() => {
    const layout = document.getElementById('student-app-layout');
    const track = document.getElementById('student-sidebar-resizer-track');
    const resizer = document.getElementById('student-sidebar-resizer');
    if (!layout || !track || !resizer) return undefined;

    layoutRef.current = layout;
    resizerRef.current = resizer;
    trackRef.current = track;

    let drag = null;

    function endDrag(ev) {
      if (!drag) return;
      const pid = drag.pointerId;
      const lastW = drag.lastW;
      drag = null;
      document.body.classList.remove('student-sidebar-is-resizing');
      try { if (track.releasePointerCapture && pid != null) track.releasePointerCapture(pid); } catch (e) {}
      persistState(false, lastW);
      applyToDom(layout, resizer);
    }

    function onPointerDown(e) {
      if (e.button !== 0) return;
      if (sidebarIsStacked()) return;
      e.preventDefault();
      const side = document.getElementById('student-side-col');
      let startW;
      if (layout.classList.contains('app-layout--sidebar-collapsed')) {
        startW = clampW(readWidth());
        layout.classList.remove('app-layout--sidebar-collapsed');
        safeLsRemove(STUDENT_SIDEBAR_LS_COLLAPSED);
        layout.style.setProperty('--student-sidebar-px', startW + 'px');
      } else {
        const rw = side && side.getBoundingClientRect ? side.getBoundingClientRect().width : 0;
        startW = clampW(rw > 40 ? rw : readWidth());
      }
      drag = { startX: e.clientX, startW, lastW: startW, pointerId: e.pointerId };
      document.body.classList.add('student-sidebar-is-resizing');
      try { track.setPointerCapture(e.pointerId); } catch (e2) {}
    }

    function onPointerMove(e) {
      if (!drag) return;
      const dx = drag.startX - e.clientX;
      const nw = clampW(drag.startW + dx);
      drag.lastW = nw;
      layout.classList.remove('app-layout--sidebar-collapsed');
      safeLsRemove(STUDENT_SIDEBAR_LS_COLLAPSED);
      layout.style.setProperty('--student-sidebar-px', nw + 'px');
      updateResizerAria(resizer, layout, nw, getMaxPx());
    }

    function onDblClick(e) {
      if (sidebarIsStacked()) return;
      if (drag) return;
      e.preventDefault();
      toggleCollapsed(layout, resizer);
    }

    function onKeyDown(e) {
      if (sidebarIsStacked()) return;
      const maxPx = getMaxPx();
      const curStr = layout.style.getPropertyValue('--student-sidebar-px');
      let cur = layout.classList.contains('app-layout--sidebar-collapsed')
        ? STUDENT_SIDEBAR_MIN
        : parseInt(curStr, 10);
      if (!isFinite(cur) || cur <= 0) cur = readWidth();
      cur = clampW(cur);
      const step = 24;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (layout.classList.contains('app-layout--sidebar-collapsed')) return;
        const nwL = clampW(cur + step);
        layout.style.setProperty('--student-sidebar-px', nwL + 'px');
        persistState(false, nwL);
        applyToDom(layout, resizer);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (layout.classList.contains('app-layout--sidebar-collapsed')) return;
        const nwR = clampW(cur - step);
        layout.style.setProperty('--student-sidebar-px', nwR + 'px');
        persistState(false, nwR);
        applyToDom(layout, resizer);
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (!layout.classList.contains('app-layout--sidebar-collapsed')) {
          layout.style.setProperty('--student-sidebar-px', maxPx + 'px');
          persistState(false, maxPx);
          applyToDom(layout, resizer);
        }
      } else if (e.key === 'End') {
        e.preventDefault();
        if (!layout.classList.contains('app-layout--sidebar-collapsed')) {
          layout.style.setProperty('--student-sidebar-px', STUDENT_SIDEBAR_MIN + 'px');
          persistState(false, STUDENT_SIDEBAR_MIN);
          applyToDom(layout, resizer);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCollapsed(layout, resizer);
      }
    }

    let resizeTimer = null;
    function onWindowResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => applyToDom(layout, resizer), 120);
    }

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    resizer.addEventListener('dblclick', onDblClick);
    resizer.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onWindowResize);

    applyToDom(layout, resizer);

    // Every listener above is removed here. The previous version removed none
    // and cleared a `dataset.sidebarInit` guard instead, so a remount re-ran the
    // whole init and stacked a second anonymous window `resize` listener on top
    // of an unreachable first one.
    return () => {
      track.removeEventListener('pointerdown', onPointerDown);
      track.removeEventListener('pointermove', onPointerMove);
      track.removeEventListener('pointerup', endDrag);
      track.removeEventListener('pointercancel', endDrag);
      resizer.removeEventListener('dblclick', onDblClick);
      resizer.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onWindowResize);
      clearTimeout(resizeTimer);
      // Unmounting mid-drag otherwise strands the resizing cursor/overlay class
      // on <body> for the rest of the page's life.
      document.body.classList.remove('student-sidebar-is-resizing');
      if (drag && drag.pointerId != null) {
        try { track.releasePointerCapture(drag.pointerId); } catch (e) {}
      }
      drag = null;
    };
  }, []);

  return (
    <>
      {/* Resizer handle between main-col and side-col */}
      <div
        className="student-sidebar-resizer"
        id="student-sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session sidebar. Double-click to hide or show."
        title="Drag left or right to resize. Double-click to hide or show the sidebar."
      >
        <div
          className="student-sidebar-resizer-track"
          id="student-sidebar-resizer-track"
          aria-hidden="true"
        />
      </div>

      {/* Side column */}
      <div className="side-col" id="student-side-col">
        <div className="student-sidebar-scroll">
          <SideSection id="stu-sec-session" title="Session">
            <SessionInfo
              currentSession={currentSession}
              showToast={showToast}
            />
          </SideSection>
          <SideSection id="stu-sec-stats" title="Session stats">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-num" id="stat-total">{stats.total}</div>
                <div className="stat-label">Total</div>
              </div>
              <div className="stat-card">
                <div className="stat-num" id="stat-answered" style={{ color: 'var(--success)' }}>
                  {stats.answered}
                </div>
                <div className="stat-label">Answered</div>
              </div>
              <div className="stat-card">
                <div className="stat-num" id="stat-pending" style={{ color: 'var(--warn)' }}>
                  {stats.pending}
                </div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-num" id="stat-pinned" style={{ color: 'var(--pin)' }}>
                  {stats.pinned}
                </div>
                <div className="stat-label">Pinned</div>
              </div>
            </div>
          </SideSection>
        </div>
        <footer className="student-sidebar-footer" aria-label="Dashboard feedback">
          <p className="student-feedback-hint">
            Please share feedback on this dashboard for improvements or suggestions.
          </p>
          <button
            type="button"
            className="student-feedback-icon-btn"
            id="student-feedback-open-btn"
            onClick={onOpenFeedback}
            title="Send feedback"
            aria-label="Send feedback"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
            </svg>
          </button>
        </footer>
      </div>
    </>
  );
}
