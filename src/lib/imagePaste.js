/**
 * Shared student question image-paste pipeline (ask box + edit modal).
 *
 * Instructor answer/note paste lives next to those editors — different Storage
 * paths and identity gates — and is not routed through here.
 */
import { IMAGE_MAX_EDGE, IMAGE_JPEG_QUALITY, QUESTION_IMAGE_URLS_MAX } from '../constants/app.js';
import { extractImageUrlForQuestionPaste } from './clipboardImagePaste.js';
import { isHttpsUrl } from './richText.js';

export function newPasteId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Resize an image file/blob to JPEG, capped at IMAGE_MAX_EDGE on the longest side. */
export function resizeImageToJpegBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(u);
      const w = img.width, h = img.height;
      const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h, 1));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      c.toBlob(
        (blob) => { blob ? resolve(blob) : reject(new Error('encode')); },
        'image/jpeg',
        IMAGE_JPEG_QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('image')); };
    img.src = u;
  });
}

/** Extract image File objects from a paste event's clipboard data. */
export function collectImageFilesFromPaste(e) {
  const out = [];
  const cd = e.clipboardData;
  if (!cd) return out;
  if (cd.items && cd.items.length) {
    for (let i = 0; i < cd.items.length; i++) {
      const it = cd.items[i];
      if (it.kind === 'file' && it.type && it.type.indexOf('image') === 0) {
        const f = it.getAsFile();
        if (f && f.size > 0) out.push(f);
      }
    }
  }
  if (!out.length && cd.files && cd.files.length) {
    for (let j = 0; j < cd.files.length; j++) {
      if (cd.files[j].type && cd.files[j].type.indexOf('image') === 0 && cd.files[j].size > 0) {
        out.push(cd.files[j]);
      }
    }
  }
  return out;
}

/** Human-readable upload error with CORS hint. */
export function formatUploadError(err) {
  const m = (err && err.message) ? String(err.message) : '';
  const code = (err && err.code) ? String(err.code) : '';
  const blob = (m + ' ' + code).toLowerCase();
  if (
    blob.indexOf('cors') >= 0 ||
    blob.indexOf('network') >= 0 ||
    blob.indexOf('preflight') >= 0 ||
    blob.indexOf('xmlhttprequest') >= 0
  ) {
    return 'Image upload blocked (browser ↔ Storage). Apply storage-cors.json to your bucket with this origin — SETUP.md step "CORS".';
  }
  return 'Upload failed: ' + (m || 'check Storage rules in SETUP.md');
}

/** https-only image URLs from the imageUrls field (array, string, or legacy map). */
export function httpsImageUrlList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((u) => String(u).trim()).filter(isHttpsUrl);
  if (typeof raw === 'string') return isHttpsUrl(raw) ? [raw.trim()] : [];
  if (typeof raw === 'object') {
    return Object.keys(raw)
      .sort()
      .map((k) => raw[k])
      .map((u) => String(u).trim())
      .filter(isHttpsUrl);
  }
  return [];
}

/** Preview rows for images already saved on a question. */
export function pendingRowsFromImageUrls(raw) {
  return httpsImageUrlList(raw)
    .slice(0, QUESTION_IMAGE_URLS_MAX)
    .map((url) => ({ pid: newPasteId(), url, blobUrl: '', uploading: false }));
}

export function questionImageUrlsFromPending(pending) {
  return (pending || []).map((r) => r && r.url).filter(Boolean).slice(0, QUESTION_IMAGE_URLS_MAX);
}

/** Pull pasted image URLs back out of the textarea so they are not stored twice. */
export function stripEmbeddedImageUrls(text, urls) {
  let t = text == null ? '' : String(text);
  (urls || []).forEach((u) => {
    if (!u) return;
    const re = new RegExp(String(u).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    t = t.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  });
  return t;
}

export function questionPasteStoragePath(sessionCode, userId) {
  return (
    'sessions/' +
    sessionCode +
    '/question_paste/' +
    userId +
    '_' +
    Date.now() +
    '_' +
    newPasteId() +
    '.jpg'
  );
}

export function revokePendingBlobUrl(row) {
  if (row && row.blobUrl) {
    try { URL.revokeObjectURL(row.blobUrl); } catch (e) {}
  }
}

/**
 * Handle a paste on a student question textarea (ask box or edit modal).
 * No-ops for ordinary text pastes so the browser can insert them.
 */
export async function runStudentQuestionImagePaste(e, opts) {
  const {
    sessionCode,
    storage,
    isDemoMode,
    showToast,
    uploadImage,
    setPendingImages,
    maxImages = QUESTION_IMAGE_URLS_MAX,
    attachedToast = 'Image attached. Add text or submit.',
    linkFallbackToast = 'Using image link (download or upload was blocked). Submit to attach.',
  } = opts || {};
  if (!sessionCode) return;

  const files = collectImageFilesFromPaste(e);
  const htmlSrc = extractImageUrlForQuestionPaste(e, files.length > 0);
  if (!files.length && !htmlSrc) return;

  // Demo mode has no Firebase Storage: block image paste with a friendly
  // toast but let text (and the format toolbar) work normally.
  if (isDemoMode) {
    e.preventDefault();
    showToast('Image paste: use a live session (demo has no Storage).');
    return;
  }

  if (!storage) {
    if (htmlSrc) {
      e.preventDefault();
      let added = false;
      setPendingImages((prev) => {
        if (prev.length >= maxImages) return prev;
        added = true;
        return [...prev, { pid: newPasteId() + newPasteId(), url: htmlSrc, blobUrl: '' }];
      });
      showToast(
        added
          ? 'Image link added (Firebase Storage not active—this uses the original URL).'
          : `You can attach up to ${maxImages} images.`,
      );
      return;
    }
    showToast(
      'Image files need Firebase Storage (paid plan). Paste an https:// image link instead, or upgrade Storage.',
    );
    return;
  }

  e.preventDefault();

  if (files.length) {
    for (let k = 0; k < files.length; k++) {
      const pid = newPasteId() + '_' + Date.now() + '_' + k;
      let accepted = false;
      setPendingImages((prev) => {
        if (prev.length >= maxImages) return prev;
        accepted = true;
        return [...prev, { pid, url: '', blobUrl: '', uploading: true }];
      });
      if (!accepted) {
        showToast(`You can attach up to ${maxImages} images.`);
        break;
      }
      showToast('Uploading image…');
      try {
        const jpegBlob = await resizeImageToJpegBlob(files[k]);
        const blobUrl = URL.createObjectURL(jpegBlob);
        setPendingImages((prev) =>
          prev.map((r) => (r.pid === pid ? { pid, url: '', blobUrl, uploading: false } : r)),
        );
        const url = await uploadImage(jpegBlob);
        setPendingImages((prev) =>
          prev.map((r) => {
            if (r.pid !== pid) return r;
            revokePendingBlobUrl(r);
            return { pid, url, blobUrl: '' };
          }),
        );
        showToast(attachedToast);
      } catch (err) {
        console.warn(err);
        setPendingImages((prev) => {
          const row = prev.find((r) => r.pid === pid);
          revokePendingBlobUrl(row);
          return prev.filter((r) => r.pid !== pid);
        });
        showToast(formatUploadError(err));
      }
    }
    return;
  }

  if (htmlSrc) {
    const pid2 = newPasteId() + '_' + Date.now();
    let accepted = false;
    setPendingImages((prev) => {
      if (prev.length >= maxImages) return prev;
      accepted = true;
      return [...prev, { pid: pid2, url: htmlSrc, blobUrl: '' }];
    });
    if (!accepted) {
      showToast(`You can attach up to ${maxImages} images.`);
      return;
    }
    showToast('Uploading image…');
    try {
      const r = await fetch(htmlSrc, { mode: 'cors' });
      if (!r.ok) throw new Error('Could not download image (site blocked copy). Try right-click → Copy image.');
      const blob0 = await r.blob();
      const jpeg2 = await resizeImageToJpegBlob(blob0);
      const url2 = await uploadImage(jpeg2);
      setPendingImages((prev) =>
        prev.map((row) => (row.pid === pid2 ? { pid: pid2, url: url2, blobUrl: '' } : row)),
      );
      showToast(attachedToast);
    } catch (err) {
      console.warn(err);
      showToast(linkFallbackToast);
    }
  }
}
