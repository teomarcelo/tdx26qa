/**
 * ImageLightbox — an in-app viewer for attached images.
 *
 * Renders nothing until an image is opened. It attaches a single document-level
 * click listener that intercepts PLAIN left-clicks on viewer image links
 * (anchors with class "attachment-img-link") and opens the image in a centered
 * lightbox instead of a new browser tab.
 *
 * Deliberate "open in new tab" gestures are respected: cmd/ctrl-click,
 * shift-click, alt-click, and middle/right-click fall through to the anchor's
 * native target="_blank" behavior (we never call preventDefault for those).
 *
 * Accessibility: role="dialog" + aria-modal, focuses the close button on open,
 * closes on Escape or backdrop click, restores focus to the opener on close,
 * and locks body scroll while open.
 *
 * Mount this ONCE per app (student + instructor). It uses a portal to
 * document.body so it always paints above cards, modals, overlays, and toasts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isHttpsUrl } from '../lib/richText.js';

export default function ImageLightbox() {
  const [src, setSrc] = useState(null);
  const closeBtnRef = useRef(null);
  const openerRef = useRef(null);

  const close = useCallback(() => setSrc(null), []);

  // Document-level delegation: intercept plain left-clicks on viewer image links.
  useEffect(() => {
    const onClick = (e) => {
      // Respect deliberate new-tab gestures: only plain left-clicks are intercepted.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target && e.target.closest && e.target.closest('a.attachment-img-link');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href) return;
      // The href becomes an <img src>. Every caller already filters attachment
      // URLs to https, so this is defence in depth: re-check here rather than
      // trusting whatever markup put the anchor in the DOM.
      if (!isHttpsUrl(href)) return;
      e.preventDefault();
      // Remember what had focus so we can restore it when the lightbox closes.
      openerRef.current = document.activeElement;
      setSrc(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // While open: lock body scroll, focus the close button, handle Escape,
  // and restore both on close.
  useEffect(() => {
    if (!src) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Escape closes. Capture phase + stopPropagation so app-level Escape handlers
    // (e.g. the instructor Dashboard's modal/emoji handlers) don't also fire.
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSrc(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    const raf = requestAnimationFrame(() => {
      if (closeBtnRef.current) {
        try { closeBtnRef.current.focus(); } catch (err) {}
      }
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKeyDown, true);
      cancelAnimationFrame(raf);
      // Return focus to the element that opened the lightbox.
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') {
        try { opener.focus(); } catch (err) {}
      }
      openerRef.current = null;
    };
  }, [src]);

  if (!src) return null;

  return createPortal(
    <div
      className="img-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={close}
    >
      <button
        type="button"
        className="img-lightbox-close"
        aria-label="Close image viewer"
        ref={closeBtnRef}
        onClick={close}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      {/* Clicks on the image itself must NOT close the lightbox. */}
      <img
        className="img-lightbox-img"
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
