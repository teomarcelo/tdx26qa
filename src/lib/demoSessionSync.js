/**
 * Keep the instructor demo and the student demo (`student.html?demo=1`) on the
 * same session snapshot. They are separate JS heaps (the student view is an
 * iframe, and a second tab is another heap), so patching the instructor store
 * alone never reaches the student board.
 *
 * localStorage is the source of truth across reloads; BroadcastChannel covers
 * the same-tab iframe, which may or may not get a `storage` event from its parent.
 */
export const DEMO_SESSION_PATCH_KEY = 'sqa_demo_session_patch';
export const DEMO_SESSION_CHANNEL = 'sqa-demo-session';
export const DEMO_SESSION_MESSAGE = 'sqa-demo-session-patch';

export function readDemoSessionPatch() {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_PATCH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function applyDemoSessionPatch(session, patch) {
  const base = session && typeof session === 'object' ? session : {};
  const extra = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return { ...base, ...extra };
}

export function publishDemoSessionPatch(patch) {
  if (!patch || typeof patch !== 'object') return readDemoSessionPatch();
  const next = { ...readDemoSessionPatch(), ...patch };
  try {
    localStorage.setItem(DEMO_SESSION_PATCH_KEY, JSON.stringify(next));
  } catch (e) {}
  try {
    const ch = new BroadcastChannel(DEMO_SESSION_CHANNEL);
    ch.postMessage(next);
    ch.close();
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.location) {
      const payload = { type: DEMO_SESSION_MESSAGE, patch: next };
      window.postMessage(payload, window.location.origin);
      Array.from(document.querySelectorAll('iframe')).forEach((frame) => {
        try { frame.contentWindow.postMessage(payload, window.location.origin); } catch (err) {}
      });
    }
  } catch (e) {}
  return next;
}

export function clearDemoSessionPatch() {
  try { localStorage.removeItem(DEMO_SESSION_PATCH_KEY); } catch (e) {}
  try {
    const ch = new BroadcastChannel(DEMO_SESSION_CHANNEL);
    ch.postMessage({});
    ch.close();
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.location) {
      const payload = { type: DEMO_SESSION_MESSAGE, patch: {} };
      window.postMessage(payload, window.location.origin);
      Array.from(document.querySelectorAll('iframe')).forEach((frame) => {
        try { frame.contentWindow.postMessage(payload, window.location.origin); } catch (err) {}
      });
    }
  } catch (e) {}
}

export function subscribeDemoSessionPatch(onPatch) {
  if (typeof onPatch !== 'function') return () => {};
  const emit = (patch) => {
    onPatch(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {});
  };
  const onStorage = (e) => {
    if (e.key !== DEMO_SESSION_PATCH_KEY) return;
    emit(readDemoSessionPatch());
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  const onMessage = (e) => {
    if (typeof window === 'undefined' || e.origin !== window.location.origin) return;
    if (!e.data || e.data.type !== DEMO_SESSION_MESSAGE) return;
    emit(e.data.patch);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('message', onMessage);
  }
  let ch = null;
  try {
    ch = new BroadcastChannel(DEMO_SESSION_CHANNEL);
    ch.onmessage = (ev) => emit(ev.data);
  } catch (e) {}
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
    }
    if (ch) {
      try { ch.close(); } catch (e) {}
    }
  };
}
