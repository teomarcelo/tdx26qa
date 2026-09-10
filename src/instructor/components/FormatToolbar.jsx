/**
 * FormatToolbar — Slack-style formatting buttons + emoji picker.
 * Targets a <textarea> by id (textareaId). Uses vanilla JS for
 * selection manipulation (textarea APIs are DOM-only).
 *
 * The emoji picker panel is portaled to document.body via a
 * <details> element whose shell is moved by the existing
 * vanilla positioning logic in useEffect.
 */
import { useEffect, useRef } from 'react';
import {
  emojiKeywordsReady,
  getEmojiIndex,
  loadEmojiKeywords,
  subscribeEmojiKeywords,
} from '../../lib/emojiData.js';

// ── Emoji data ─────────────────────────────────────────────────
const FORMAT_EMOJI_PICKER_RAW = "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁☹😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁👅👄❤🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝💟☮✝☪🕉☸✡🔯🪄🪅🎴🎭🖼🎨🔮🧿🐵🐒🦍🦧🐶🐕🦮🐩🐺🦊🦝🐱🐈🦁🐯🐅🐆🐴🐎🦄🦓🦌🦬🐮🐂🐃🐄🐷🐖🐗🐽🐏🐑🐐🐪🐫🦙🦒🐘🦣🦏🦛🐭🐁🐀🐹🐰🐇🐿🦫🦔🦇🐻🐨🐼🐾🦃🐔🐓🐣🐤🐥🐦🐧🕊🦅🦆🦢🦉🦤🪶🦩🦚🦜🐸🐊🐢🦎🐍🐲🐉🦕🦖🐳🐋🐬🦭🐟🐠🐡🦈🐙🐚🪸🐌🦋🐛🐜🐝🪲🐞🦗🪳🕷🕸🦂🦟🪰🪱🦠💐🌸💮🌹🥀🌺🌻🌼🌷🪻🌱🪴🌲🌳🌴🌵🌾🌿☘🍀🍁🍂🍃🪹🪺🍄🍇🍈🍉🍊🍋🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🥥🥑🍆🥔🥕🌽🌶🫑🥒🥬🥦🧄🧅🥜🫘🌰🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🦀🦞🦐🦑🦪🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🥤🧋🧃🧉🧊🥢🍽🍴🥄🔪🫙🌍🌎🌏🌐🗺🧭🏔⛰🌋🗻🏕🏖🏜🏝🏞🏟🏛🏗🧱🪨🪵🛖🏘🏚🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬🏭🏯🏰💒🗼🗽⛪🕌🛕🕍⛩🕋⛲⛺🌁🌃🌄🌅🌆🌇🌉♨🎠🛝🎡🎢💈🎪🚂🚃🚄🚅🚆🚇🚈🚉🚊🚝🚞🚋🚌🚍🚎🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🛻🚚🚛🚜🏎🏍🛵🦽🦼🛺🚲🛴🛹🛼🚏🛣🛤⛽🚨🚥🚦🛑🚧⚓🛟⛵🛶🚤🛳⛴🛥🚢✈🛩🛫🛬🪂💺🚁🚟🚠🚡🛰🚀🛸🪐🌠🌌⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛷⛸🥌🎿⛷🏂🏋🤼🤸🤺⛹🤹🧘🏌🏇🧗🚵🚴🏆🥇🥈🥉🏅🎖🏵🎗🎫🎟🩰🎬🎤🎧🎼🎹🥁🪘🎷🎺🎸🪕🎻🪈🎲♟🎯🎳🎮🕹🎰🧩📱📲☎📞📟📠🔋🪫🔌💻🖥🖨⌨🖱🖲💽💾💿📀🧮🎥🎞📽📺📷📸📹📼🔍🔎🕯💡🔦🏮🪔📔📕📖📗📘📙📚📓📒📃📜📄📰🗞📑🔖🏷💰🪙💴💵💶💷💸💳🧾✉📧📨📩📤📥📦📫📪📬📭📮🗳✏✒🖋🖊🖌🖍📝💼📁📂🗂📅📆🗒🗓📇📈📉📊📋📌📍📎🖇📏📐✂🗃🗄🗑🔒🔓🔏🔐🔑🗝🔨🪓⛏⚒🛠🗡⚔🔫🛡🔧🪛🔩⚙🗜⚖🦯🔗⛓🪝🧰🧲🪜💯💢💥💫💦💨🕳💬🗨🗯💭💤🔔🔕📣📢📿🏧🚮🚰♿🚹🚺🚻🚼🚾🛂🛃🛄🛅⚠🚸⛔🚫🚳🚭🚯🚱🚷📵🔞☢☣⬆↗➡↘⬇↙⬅↖↕↔↩↪⤴⤵🔃🔄🔙🔚🔛🔜🔝🛐⚛☯🕎♈♉♊♋♌♍♎♏♐♑♒♓⛎🔀🔁🔂▶⏩⏭⏯◀⏪⏮🔼⏫🔽⏬⏸⏹⏺⏏🎦🔅🔆📶📳📴♀♂⚧✖➕➖➗🟰♾‼⁉❓❔❕❗〰💱💲⚕♻❇✳❎🆎🆑🆘📛🔠🔡🔢🔣🔤⌚⏰⏱⏲🕰🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕡🕖🕢🕗🕣🕘🕤🕙🕥🕚🕦🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞⭐🌟☀🌤⛅🌥☁🌦🌧⛈🌩🌨❄☃⛄🌬🌪🌫🌈☂☔⛱⚡🔥💧🌊🎃🎄🎆🎇🧨✨🎈🎉🎊🎋🎍🎎🎏🎐🎑🧧🎀🎁🧸🪆🃏🀄";
export const FORMAT_EMOJI_PICKER_CHARS = Array.from(FORMAT_EMOJI_PICKER_RAW);

const FMT_EMOJI_PICKER_INLINE_STYLE =
  "font-family:'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol','Noto Color Emoji','Twemoji Mozilla',emoji,system-ui,sans-serif;" +
  "color:inherit;border:0!important;box-shadow:none!important;background:transparent!important;";

// ── Toolbar insertion helpers (vanilla DOM, not React state) ───

/**
 * setNativeValue — sets a textarea/input value in a way that triggers React's
 * synthetic onChange. React 16+ tracks the internal value via a _valueTracker;
 * we must go through the native setter so React detects the change and fires
 * onChange when we subsequently dispatch the 'input' event.
 */
function setNativeValue(el, value) {
  const descriptor = Object.getOwnPropertyDescriptor(el, 'value') ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

export function insertSlackFormat(textareaId, mode) {
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
    setNativeValue(ta, v.slice(0, start) + ins + v.slice(end));
    ta.focus();
    ta.setSelectionRange(c0, c1);
    // Trigger React onChange so the store stays in sync
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (mode === 'link') {
    const label = sel || 'link text';
    ins = `[${label}](https://)`;
    setNativeValue(ta, v.slice(0, start) + ins + v.slice(end));
    ta.focus();
    const urlStart = start + label.length + 3;
    ta.setSelectionRange(urlStart, urlStart + 8);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
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
  setNativeValue(ta, v.slice(0, start) + ins + v.slice(end));
  ta.focus();
  const ns = start + before.length;
  const ne = ns + mid.length;
  ta.setSelectionRange(ns, ne);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export function clearTextarea(textareaId) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  setNativeValue(ta, '');
  ta.focus();
  // Fire React onChange so the store/component state clears too.
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertEmoji(textareaId, ch) {
  const ta = document.getElementById(textareaId);
  if (!ta || ch == null) return;
  ch = String(ch);
  const start = ta.selectionStart, end = ta.selectionEnd;
  const v = ta.value;
  setNativeValue(ta, v.slice(0, start) + ch + v.slice(end));
  ta.focus();
  const p = start + ch.length;
  ta.setSelectionRange(p, p);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Emoji picker grid portal ───────────────────────────────────

function emojiCellHtml(ch, targetId, searchText) {
  return `<button type="button" class="fmt-btn fmt-emoji fmt-emoji-picker-cell" style="${FMT_EMOJI_PICKER_INLINE_STYLE}" data-emoji-target="${escAttr(targetId)}" data-ch="${escAttr(ch)}" data-search="${escAttr(searchText)}" title="Insert" aria-label="Insert emoji"><span class="fmt-emoji-char">${ch}</span></button>`;
}

/**
 * Write the keyword text onto cells that were built before the dataset arrived,
 * then replay any query already in the search box. Dashboard filters off the
 * data-search attribute on each cell and re-filters on 'input', so re-dispatching
 * the event is what makes a mid-load query correct itself.
 */
function applyEmojiKeywordsToGrid(grid) {
  if (!grid || !grid.isConnected || !emojiKeywordsReady()) return;
  const index = getEmojiIndex(FORMAT_EMOJI_PICKER_CHARS);
  grid.querySelectorAll('.fmt-emoji-picker-cell').forEach(cell => {
    cell.setAttribute('data-search', index.get(cell.getAttribute('data-ch')) || '');
  });
  const shell = grid.closest('.fmt-emoji-grid-shell');
  const input = shell && shell.querySelector('.fmt-emoji-search-input');
  if (input && input.value) input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** EmojiPickerGrid — fills the grid and portals it to body.
 *  Kept as a separate component so it can be portaled. */
function EmojiPickerGrid({ targetId, detailsRef }) {
  const gridRef = useRef(null);
  const filledForRef = useRef(null);

  useEffect(() => {
    const grid = gridRef.current;
    const details = detailsRef.current;
    if (!grid || !details) return;

    // Filling is deferred to the first open. An instructor page renders one
    // toolbar per question plus one per session note, so building the cells on
    // mount put ~11k buttons in the DOM — and ran an 1,035-glyph keyword pass per
    // toolbar — for a panel that is opened at most once.
    function fillGrid() {
      if (filledForRef.current === targetId) return;
      filledForRef.current = targetId;
      const index = getEmojiIndex(FORMAT_EMOJI_PICKER_CHARS);
      grid.innerHTML = FORMAT_EMOJI_PICKER_CHARS
        .map(ch => emojiCellHtml(ch, targetId, index.get(ch) || ''))
        .join('');
      ensureShell(grid, details);
      // Nothing above waits on the network: the glyphs come from the literal, and
      // the keyword dataset arrives in its own chunk to fill in data-search.
      if (!emojiKeywordsReady()) loadEmojiKeywords();
    }

    function onToggle() {
      if (details.open) fillGrid();
    }

    // A picker already open when targetId changes needs its cells rewritten now;
    // the toggle that would have done it has been and gone. fillGrid no-ops when
    // the cells already point at this target, so the StrictMode second pass and
    // any unrelated re-run are free.
    if (details.open) fillGrid();

    // Activating the summary — by pointer or by keyboard — dispatches a click
    // before <details> flips open, so filling here puts the cells in place ahead
    // of every toggle handler, including Dashboard's layout pass. The toggle
    // listener is the backstop for an open that never went through a click.
    details.addEventListener('click', fillGrid);
    details.addEventListener('toggle', onToggle);
    // Whichever picker triggered the fetch, every already-filled grid needs its
    // data-search backfilled when the keywords land.
    const unsubscribe = subscribeEmojiKeywords(() => applyEmojiKeywordsToGrid(grid));

    return () => {
      details.removeEventListener('click', fillGrid);
      details.removeEventListener('toggle', onToggle);
      unsubscribe();
    };
    // detailsRef is a useRef object owned by the parent, so it is stable and
    // never re-runs this effect on its own.
  }, [targetId, detailsRef]);

  return (
    <div
      ref={gridRef}
      className="fmt-emoji-grid"
      data-emoji-picker-autofill
      data-emoji-target-id={targetId}
      role="group"
      aria-label="More emojis"
    />
  );
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function ensureShell(grid, details) {
  if (!grid || !grid.parentNode) return null;
  const existing = grid.closest('.fmt-emoji-grid-shell');
  if (existing) {
    if (details) {
      details._fmtEmojiShell = existing;
      existing._fmtEmojiDetails = details;
    }
    return existing;
  }
  const shell = document.createElement('div');
  shell.className = 'fmt-emoji-grid-shell';
  // Search field (keyword filter over the grid cells).
  const search = document.createElement('div');
  search.className = 'fmt-emoji-search';
  search.innerHTML =
    '<svg class="fmt-emoji-search-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>' +
    '<input type="text" class="fmt-emoji-search-input" placeholder="Search emoji…" aria-label="Search emoji" autocomplete="off" spellcheck="false" />';
  const top = document.createElement('div');
  top.className = 'fmt-emoji-scroll-hint fmt-emoji-scroll-hint--top is-hidden';
  top.setAttribute('aria-hidden', 'true');
  top.textContent = '▲';
  const bot = document.createElement('div');
  bot.className = 'fmt-emoji-scroll-hint fmt-emoji-scroll-hint--bottom is-hidden';
  bot.setAttribute('aria-hidden', 'true');
  bot.textContent = '▼';
  const empty = document.createElement('div');
  empty.className = 'fmt-emoji-empty is-hidden';
  empty.textContent = 'No emoji match';
  const parent = grid.parentNode;
  parent.insertBefore(shell, grid);
  shell.appendChild(search);
  shell.appendChild(top);
  shell.appendChild(grid);
  shell.appendChild(empty);
  shell.appendChild(bot);
  if (details) {
    details._fmtEmojiShell = shell;
    shell._fmtEmojiDetails = details;
  }
  return shell;
}

// ── Main FormatToolbar component ───────────────────────────────
export default function FormatToolbar({ textareaId, compact = true }) {
  const detailsRef = useRef(null);
  const containerRef = useRef(null);

  // Wire click delegation for this toolbar
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onClick = (e) => {
      const clearBtn = e.target.closest('.fmt-btn[data-fmt-clear]');
      if (clearBtn) {
        e.preventDefault();
        clearTextarea(textareaId);
        return;
      }
      const fmtBtn = e.target.closest('.fmt-btn[data-fmt]');
      const emBtn = e.target.closest('.fmt-btn[data-emoji]');
      if (!fmtBtn && !emBtn) return;
      e.preventDefault();
      if (fmtBtn) insertSlackFormat(textareaId, fmtBtn.getAttribute('data-fmt'));
      else insertEmoji(textareaId, emBtn.getAttribute('data-emoji'));
      const det = (fmtBtn || emBtn).closest('details');
      if (det) det.open = false;
    };

    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, [textareaId]);

  return (
    <div
      ref={containerRef}
      className={`format-toolbar${compact ? ' format-toolbar--compact' : ''}`}
      data-fmt-target={textareaId}
      role="toolbar"
      aria-label="Insert formatting"
    >
      <span className="format-toolbar-label">Format</span>
      <div className="format-toolbar-rail">
        <button type="button" className="fmt-btn fmt-btn-b" data-fmt="bold" title="Bold" aria-label="Bold"><strong>B</strong></button>
        <button type="button" className="fmt-btn fmt-btn-i" data-fmt="italic" title="Italic" aria-label="Italic"><em>I</em></button>
        <button type="button" className="fmt-btn fmt-btn-s" data-fmt="strike" title="Strikethrough" aria-label="Strikethrough"><span style={{ textDecoration: 'line-through' }}>S</span></button>
        <button type="button" className="fmt-btn fmt-btn-mono" data-fmt="code" title="Inline code" aria-label="Inline code">`</button>
        <button type="button" className="fmt-btn fmt-btn-mono" data-fmt="fenced" title="Code block" aria-label="Code block">{'{ }'}</button>
        <button type="button" className="fmt-btn fmt-btn-link" data-fmt="link" title="Link — [label](url). Select text first to use it as the label." aria-label="Insert link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
        <span className="fmt-sep" aria-hidden="true"></span>
        <details ref={detailsRef} className="fmt-emoji-more">
          <summary className="fmt-more-summary" title="More emojis — opens below or above to fit (Unicode)">⋯</summary>
          <EmojiPickerGrid targetId={textareaId} detailsRef={detailsRef} />
        </details>
        <button type="button" className="fmt-btn fmt-btn-clear" data-fmt-clear="1" style={{ marginLeft: 'auto' }} title="Clear the text box" aria-label="Clear the text box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  );
}
