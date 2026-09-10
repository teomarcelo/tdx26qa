export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function linkify(text) {
  return String(text).replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;word-break:break-all;">$1</a>',
  );
}

const URL_TAIL_PUNCTUATION = '*_~.,;:!?';

/**
 * Split trailing punctuation off an auto-detected URL. A trailing `.` or `*` is
 * far more likely to be prose or emphasis markup than part of the link:
 * "see https://x.com." and "*https://x.com*" should both link to the bare URL.
 * A closing paren is only trimmed when it is unbalanced, so links like
 * https://en.wikipedia.org/wiki/Foo_(bar) survive intact.
 */
function splitUrlTail(url) {
  let core = url;
  let tail = '';
  while (core) {
    const last = core[core.length - 1];
    const unbalancedParen =
      last === ')' && (core.split('(').length - 1) < (core.split(')').length - 1);
    if (!URL_TAIL_PUNCTUATION.includes(last) && !unbalancedParen) break;
    tail = last + tail;
    core = core.slice(0, -1);
  }
  return { core, tail };
}

/**
 * Emphasis delimiters, deliberately conservative.
 *
 * `_` may not be flanked by word characters (the CommonMark / Slack rule), so
 * Salesforce API names such as Custom_Field__c and Owner_Id__c survive verbatim
 * instead of rendering as Custom<em>Field</em>_c. Every delimiter must also hug
 * non-space text on both sides and stay on one line, so arithmetic ("5 * 3") and
 * a stray asterisk at the end of a line are read as prose, not markup.
 *
 * These run after esc(), so the subject string already contains HTML entities
 * and the extracted-chunk sentinels; none of those are word characters, and no
 * pattern here can produce a tag or an attribute.
 */
const BOLD_DOUBLE_RE = /\*\*([^*\n\s](?:[^*\n]*[^*\n\s])?)\*\*/g;
const BOLD_RE = /\*([^*\n\s](?:[^*\n]*[^*\n\s])?)\*/g;
const ITALIC_RE = /(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g;
const STRIKE_RE = /~([^~\n\s](?:[^~\n]*[^~\n\s])?)~/g;

/** Slack-style: *bold*, _italic_, ~strike~, `inline code`, fenced ``` blocks, [label](url) links. */
export function formatRichMessage(raw) {
  const PH = '\uFFF0';
  const PH2 = '\uFFF1';
  // These sentinels mark extracted chunks below. They are typeable characters,
  // so strip them from the input first: otherwise crafted text could reference
  // a chunk it did not author.
  let s = String(raw || '').split(PH).join('').split(PH2).join('');
  const chunks = [];
  const copySvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  s = s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const i = chunks.length;
    chunks.push(
      '<div class="rich-pre-wrap">' +
        '<div class="rich-pre-toolbar"><button type="button" class="rich-copy-btn" aria-label="Copy code" title="Copy code">' +
        copySvg +
        '</button></div>' +
        '<pre class="rich-pre"><code>' +
        esc(code) +
        '</code></pre></div>',
    );
    return PH + 'R' + i + PH2;
  });
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => {
    const i = chunks.length;
    chunks.push(
      '<span class="rich-code-line-wrap" role="group">' +
        '<code class="rich-code">' +
        esc(code) +
        '</code>' +
        '<button type="button" class="rich-copy-btn rich-copy-btn--inline" aria-label="Copy code" title="Copy code">' +
        copySvg +
        '</button></span>',
    );
    return PH + 'R' + i + PH2;
  });
  // Extract [label](url) links before esc so the href doesn't get double-escaped
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => {
    const i = chunks.length;
    chunks.push(
      `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:underline;word-break:break-all;">${esc(label)}</a>`
    );
    return PH + 'R' + i + PH2;
  });
  s = esc(s);
  // Pull bare URLs out before emphasis runs. Underscores and asterisks are
  // ordinary URL characters, so `https://x.com/a_b_c` would otherwise become
  // `https://x.com/a<em>b</em>c` and linkify would then stop at the `<`.
  // The placeholder sentinels are excluded so a URL sitting directly against an
  // already-extracted chunk cannot swallow its marker.
  s = s.replace(/(https?:\/\/[^\s<>"'\uFFF0\uFFF1]+)/g, (_m, url) => {
    const { core, tail } = splitUrlTail(url);
    if (!core) return url;
    const i = chunks.length;
    chunks.push(linkify(core));
    return PH + 'R' + i + PH2 + tail;
  });
  s = s.replace(BOLD_DOUBLE_RE, '<strong>$1</strong>');
  s = s.replace(BOLD_RE, '<strong>$1</strong>');
  s = s.replace(ITALIC_RE, '$1<em>$2</em>');
  s = s.replace(STRIKE_RE, '<del>$1</del>');
  s = s.replace(/\uFFF0R(\d+)\uFFF1/g, (_m, n) => chunks[parseInt(n, 10)] || '');
  return s;
}

/**
 * Convert the raw rich-text source (Slack-style markup) to readable plain text
 * for copying: strips emphasis markers, unwraps code, and renders
 * [label](url) as "label (url)". Preserves newlines.
 */
export function richSourceToPlainText(raw) {
  let s = String(raw || '');
  s = s.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, code) => String(code).replace(/\n+$/, ''));
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
  // Same delimiter rules as the renderer, so copied text and rendered text agree
  // on what was markup: an API name that stays intact on screen stays intact here.
  s = s.replace(BOLD_DOUBLE_RE, '$1');
  s = s.replace(BOLD_RE, '$1');
  s = s.replace(ITALIC_RE, '$1$2');
  s = s.replace(STRIKE_RE, '$1');
  return s.trim();
}

/**
 * Write text to the clipboard with a graceful execCommand fallback.
 * @param {string} txt
 * @returns {Promise<void>}
 */
export function writeTextToClipboard(txt) {
  const text = String(txt == null ? '' : txt);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function legacyCopy(text) {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

export function isHttpsUrl(u) {
  return !!u && /^https:\/\//i.test(String(u).trim());
}

/** Session launch links that allow Salesforce short links (e.g. OrgClaim). */
export function isHttpOrHttpsUrl(u) {
  return !!u && /^https?:\/\//i.test(String(u).trim());
}

/**
 * @param {HTMLElement} button
 * @param {(msg: string) => void} showToast
 */
export function copyRichCodeBlock(button, showToast) {
  const wrap =
    button &&
    button.closest &&
    (button.closest('.rich-pre-wrap') || button.closest('.rich-code-line-wrap'));
  const codeEl =
    wrap && (wrap.querySelector('.rich-pre code') || wrap.querySelector('code.rich-code'));
  if (!codeEl) return;
  const txt = codeEl.textContent || '';
  function done() {
    showToast('Copied to clipboard');
    button.classList.add('rich-copy-btn--done');
    setTimeout(() => button.classList.remove('rich-copy-btn--done'), 1600);
  }
  writeTextToClipboard(txt).then(done).catch(() => showToast('Could not copy'));
}
