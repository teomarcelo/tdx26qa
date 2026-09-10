import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  emojiKeywordsReady,
  filterEmojiChars,
  getEmojiIndex,
  loadEmojiKeywords,
  subscribeEmojiKeywords,
} from '../../lib/emojiData.js';

/** Large Unicode emoji set (~750 emojis). System font renders each glyph. */
const FORMAT_EMOJI_PICKER_RAW =
  "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁☹😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾👋🤚🖐✋🖖👌🤌🤏✌🤞🤟🤘🤙👈👉👆🖕👇☝👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍💅🤳💪🦾🦿🦵🦶👂🦻👃🧠🫀🫁🦷🦴👀👁👅👄❤🧡💛💚💙💜🖤🤍🤎💔❣💕💞💓💗💖💘💝💟☮✝☪🕉☸✡🔯🪄🪅🎴🎭🖼🎨🔮🧿🐵🐒🦍🦧🐶🐕🦮🐩🐺🦊🦝🐱🐈🦁🐯🐅🐆🐴🐎🦄🦓🦌🦬🐮🐂🐃🐄🐷🐖🐗🐽🐏🐑🐐🐪🐫🦙🦒🐘🦣🦏🦛🐭🐁🐀🐹🐰🐇🐿🦫🦔🦇🐻🐨🐼🐾🦃🐔🐓🐣🐤🐥🐦🐧🕊🦅🦆🦢🦉🦤🪶🦩🦚🦜🐸🐊🐢🦎🐍🐲🐉🦕🦖🐳🐋🐬🦭🐟🐠🐡🦈🐙🐚🪸🐌🦋🐛🐜🐝🪲🐞🦗🪳🕷🕸🦂🦟🪰🪱🦠💐🌸💮🌹🥀🌺🌻🌼🌷🪻🌱🪴🌲🌳🌴🌵🌾🌿☘🍀🍁🍂🍃🪹🪺🍄🍇🍈🍉🍊🍋🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🥥🥑🍆🥔🥕🌽🌶🫑🥒🥬🥦🧄🧅🥜🫘🌰🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🦀🦞🦐🦑🦪🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🥤🧋🧃🧉🧊🥢🍽🍴🥄🔪🫙🌍🌎🌏🌐🗺🧭🏔⛰🌋🗻🏕🏖🏜🏝🏞🏟🏛🏗🧱🪨🪵🛖🏘🏚🏠🏡🏢🏣🏤🏥🏦🏨🏩🏪🏫🏬🏭🏯🏰💒🗼🗽⛪🕌🛕🕍⛩🕋⛲⛺🌁🌃🌄🌅🌆🌇🌉♨🎠🛝🎡🎢💈🎪🚂🚃🚄🚅🚆🚇🚈🚉🚊🚝🚞🚋🚌🚍🚎🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🛻🚚🚛🚜🏎🏍🛵🦽🦼🛺🚲🛴🛹🛼🚏🛣🛤⛽🚨🚥🚦🛑🚧⚓🛟⛵🛶🚤🛳⛴🛥🚢✈🛩🛫🛬🪂💺🚁🚟🚠🚡🛰🚀🛸🪐🌠🌌⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🪀🏓🏸🏒🏑🥍🏏🪃🥅⛳🪁🏹🎣🤿🥊🥋🎽🛷⛸🥌🎿⛷🏂🏋🤼🤸🤺⛹🤹🧘🏌🏇🧗🚵🚴🏆🥇🥈🥉🏅🎖🏵🎗🎫🎟🩰🎬🎤🎧🎼🎹🥁🪘🎷🎺🎸🪕🎻🪈🎲♟🎯🎳🎮🕹🎰🧩📱📲☎📞📟📠🔋🪫🔌💻🖥🖨⌨🖱🖲💽💾💿📀🧮🎥🎞📽📺📷📸📹📼🔍🔎🕯💡🔦🏮🪔📔📕📖📗📘📙📚📓📒📃📜📄📰🗞📑🔖🏷💰🪙💴💵💶💷💸💳🧾✉📧📨📩📤📥📦📫📪📬📭📮🗳✏✒🖋🖊🖌🖍📝💼📁📂🗂📅📆🗒🗓📇📈📉📊📋📌📍📎🖇📏📐✂🗃🗄🗑🔒🔓🔏🔐🔑🗝🔨🪓⛏⚒🛠🗡⚔🔫🛡🔧🪛🔩⚙🗜⚖🦯🔗⛓🪝🧰🧲🪜💯💢💥💫💦💨🕳💬🗨🗯💭💤🔔🔕📣📢📿🏧🚮🚰♿🚹🚺🚻🚼🚾🛂🛃🛄🛅⚠🚸⛔🚫🚳🚭🚯🚱🚷📵🔞☢☣⬆↗➡↘⬇↙⬅↖↕↔↩↪⤴⤵🔃🔄🔙🔚🔛🔜🔝🛐⚛☯🕎♈♉♊♋♌♍♎♏♐♑♒♓⛎🔀🔁🔂▶⏩⏭⏯◀⏪⏮🔼⏫🔽⏬⏸⏹⏺⏏🎦🔅🔆📶📳📴♀♂⚧✖➕➖➗🟰♾‼⁉❓❔❕❗〰💱💲⚕♻❇✳❎🆎🆑🆘📛🔠🔡🔢🔣🔤⌚⏰⏱⏲🕰🕛🕧🕐🕜🕑🕝🕒🕞🕓🕟🕔🕠🕕🕡🕖🕢🕗🕣🕘🕤🕙🕥🕚🕦🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞⭐🌟☀🌤⛅🌥☁🌦🌧⛈🌩🌨❄☃⛄🌬🌪🌫🌈☂☔⛱⚡🔥💧🌊🎃🎄🎆🎇🧨✨🎈🎉🎊🎋🎍🎎🎏🎐🎑🧧🎀🎁🧸🪆🃏🀄";
const EMOJI_CHARS = Array.from(FORMAT_EMOJI_PICKER_RAW);

/** Inline font so embedded hosts cannot strip emojis with button { font-family } !important. */
const EMOJI_CELL_STYLE =
  "font-family:'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol','Noto Color Emoji','Twemoji Mozilla',emoji,system-ui,sans-serif;" +
  'color:inherit;border:0!important;box-shadow:none!important;background:transparent!important;';

const EMOJI_PANEL_PREFERRED_PX = 380;

/**
 * FormatToolbar — bold/italic/strike/code/fenced + quickemoji + emoji picker.
 *
 * The emoji picker opens as a fixed-position panel portaled to document.body
 * to avoid z-index / overflow clipping from ancestor containers.
 *
 * Positioning (getBoundingClientRect, flip above/below, IntersectionObserver,
 * ResizeObserver) is kept as vanilla JS inside a useEffect — this is intentional
 * because the layout math depends on live viewport geometry that React's render
 * cycle doesn't expose.
 */
export default function FormatToolbar({ targetId, targetRef, onInsertFormat, onInsertEmoji, onClear }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const summaryRef = useRef(null);
  const shellRef = useRef(null);
  const gridRef = useRef(null);
  const searchRef = useRef(null);
  const ioRef = useRef(null);
  const roRef = useRef(null);
  // Every requestAnimationFrame id this component has scheduled and not yet run.
  // Closing the picker within one frame (a double-click, fast toggling) used to
  // let a pending callback build observers after cleanup had already run, leaving
  // them connected with nothing left to disconnect them.
  const rafIdsRef = useRef(new Set());
  // positionPicker runs from rAF and observer callbacks that outlive the render
  // that scheduled them, so it must read open state from a ref, not from a value
  // captured at schedule time.
  const pickerOpenRef = useRef(false);
  const [pickerStyle, setPickerStyle] = useState({});
  const [flipAbove, setFlipAbove] = useState(false);
  const [gridScrollState, setGridScrollState] = useState({ hasOverflow: false, atStart: true, atEnd: false });

  // The keyword data arrives from a dynamic import. Subscribing re-renders the
  // filtered list the moment it lands, so a query typed during the fetch starts
  // matching on its own instead of sitting on a stale empty result.
  useSyncExternalStore(subscribeEmojiKeywords, emojiKeywordsReady);

  const filteredEmojis = pickerOpen
    ? filterEmojiChars(EMOJI_CHARS, query, getEmojiIndex(EMOJI_CHARS))
    : [];

  pickerOpenRef.current = pickerOpen;

  /** Schedule a frame and remember its id so cleanup can cancel it. */
  const scheduleFrame = useCallback((fn) => {
    const id = requestAnimationFrame(() => {
      rafIdsRef.current.delete(id);
      fn();
    });
    rafIdsRef.current.add(id);
    return id;
  }, []);

  /** Cancel every frame still pending. */
  const cancelFrames = useCallback(() => {
    rafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
    rafIdsRef.current.clear();
  }, []);

  // Cancel anything still scheduled when the toolbar itself goes away.
  useEffect(() => cancelFrames, [cancelFrames]);

  // --- Position the picker panel ---
  function positionPicker() {
    if (!pickerOpenRef.current || !summaryRef.current) return;
    const sum = summaryRef.current;
    const rect = sum.getBoundingClientRect();
    const gap = 8;
    const vwPad = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const belowSlice = vh - rect.bottom - gap - vwPad;
    const aboveSlice = rect.top - gap - vwPad;
    const panelMax = Math.min(480, vh * 0.62);
    const preferBelow =
      belowSlice >= Math.min(panelMax, 220) ||
      (belowSlice >= aboveSlice && belowSlice >= 100);
    const w = Math.min(380, vw - vwPad * 2);
    let left = rect.right - w;
    left = Math.max(vwPad, Math.min(left, vw - w - vwPad));
    const preferredH = Math.min(EMOJI_PANEL_PREFERRED_PX, panelMax);
    let capPx, topVal, bottomVal;
    if (preferBelow) {
      capPx = Math.max(48, Math.min(preferredH, belowSlice));
      topVal = rect.bottom + gap;
      bottomVal = 'auto';
      setFlipAbove(false);
    } else {
      capPx = Math.max(48, Math.min(preferredH, aboveSlice));
      topVal = 'auto';
      bottomVal = vh - rect.top + gap;
      setFlipAbove(true);
    }
    setPickerStyle({
      position: 'fixed',
      left: left + 'px',
      right: 'auto',
      width: w + 'px',
      top: typeof topVal === 'number' ? topVal + 'px' : topVal,
      bottom: typeof bottomVal === 'number' ? bottomVal + 'px' : bottomVal,
      maxHeight: capPx + 'px',
      zIndex: 12000,
      margin: 0,
    });
    updateScrollState();
  }

  function updateScrollState() {
    const grid = gridRef.current;
    if (!grid) return;
    const sh = grid.scrollHeight;
    const ch = grid.clientHeight;
    const EPS = 4;
    const hasOverflow = sh > ch + EPS;
    const atEnd = grid.scrollTop + ch >= sh - EPS;
    const atStart = grid.scrollTop <= EPS;
    setGridScrollState({ hasOverflow, atStart, atEnd });
  }

  // Position the panel synchronously before the browser paints. Without this,
  // the portal first commits with the CSS default (position: absolute, no
  // coordinates) which lands it at the bottom of <body>; focusing the search
  // field there makes the browser auto-scroll the page and hide the ask box.
  useLayoutEffect(() => {
    if (pickerOpen) positionPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  // --- Open / close effects ---
  useEffect(() => {
    if (!pickerOpen) {
      // Clean up observers
      cancelFrames();
      if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null; }
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      return;
    }

    // Position immediately after open
    scheduleFrame(() => {
      positionPicker();
      // Focus the search field so people can just start typing. preventScroll
      // stops the browser from scrolling the page to the (portaled) input.
      if (searchRef.current) {
        try { searchRef.current.focus({ preventScroll: true }); } catch (e) {}
      }
      // IntersectionObserver to reposition when summary scrolls out of view
      if (summaryRef.current && typeof IntersectionObserver !== 'undefined') {
        const thresholds = [];
        for (let i = 0; i <= 20; i++) thresholds.push(i / 20);
        ioRef.current = new IntersectionObserver(
          () => { scheduleFrame(positionPicker); },
          { root: null, threshold: thresholds },
        );
        ioRef.current.observe(summaryRef.current);
      }
      // ResizeObserver to reposition when panel size changes
      if (gridRef.current && typeof ResizeObserver !== 'undefined') {
        roRef.current = new ResizeObserver(() => {
          positionPicker();
          updateScrollState();
        });
        roRef.current.observe(gridRef.current);
        if (shellRef.current) roRef.current.observe(shellRef.current);
      }
    });

    // Scroll / resize repositioning
    const scheduleRepos = () => scheduleFrame(positionPicker);
    const capOpts = { passive: true, capture: true };
    window.addEventListener('scroll', scheduleRepos, capOpts);
    document.addEventListener('scroll', scheduleRepos, capOpts);
    window.addEventListener('resize', scheduleRepos);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('scroll', scheduleRepos, { passive: true });
      window.visualViewport.addEventListener('resize', scheduleRepos, { passive: true });
    }

    // Close when clicking outside
    function onPointerDown(e) {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (summaryRef.current && summaryRef.current.contains(t)) return;
      if (shellRef.current && shellRef.current.contains(t)) return;
      setPickerOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener(
      'touchstart',
      onPointerDown,
      { capture: true, passive: true },
    );

    return () => {
      window.removeEventListener('scroll', scheduleRepos, capOpts);
      document.removeEventListener('scroll', scheduleRepos, capOpts);
      window.removeEventListener('resize', scheduleRepos);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('scroll', scheduleRepos);
        window.visualViewport.removeEventListener('resize', scheduleRepos);
      }
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
      // Cancel before disconnecting: a frame that runs after this point would
      // build a fresh pair of observers that nothing else will ever clean up.
      cancelFrames();
      if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null; }
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  // Clear the search when the picker closes.
  useEffect(() => {
    if (!pickerOpen) setQuery('');
  }, [pickerOpen]);

  // Start fetching keywords the moment the picker opens, well before anyone can
  // finish typing a word. Repeated calls share one in-flight import, so the
  // StrictMode double pass costs nothing.
  useEffect(() => {
    if (pickerOpen) loadEmojiKeywords();
  }, [pickerOpen]);

  // Recompute overflow hints + reposition when the filtered result set changes.
  useEffect(() => {
    if (!pickerOpen) return;
    // Not cancelled on query change: this frame only repositions and recomputes
    // scroll hints, and cancelling here could kill the open effect's frame (the
    // one that installs the observers) if a keystroke lands in the same frame.
    // Closing the picker cancels it, via the open/close effect's cleanup.
    scheduleFrame(() => {
      if (gridRef.current) gridRef.current.scrollTop = 0;
      positionPicker();
      updateScrollState();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pickerOpen]);

  // Close picker on ESC (clear the search first if there's a query).
  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (query) setQuery('');
        else setPickerOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen, query]);

  function handleEmojiClick(ch) {
    onInsertEmoji(ch);
    setPickerOpen(false);
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredEmojis.length) handleEmojiClick(filteredEmojis[0]);
    }
  }

  const { hasOverflow, atStart, atEnd } = gridScrollState;

  const pickerPortal = pickerOpen
    ? createPortal(
        <div
          ref={shellRef}
          className={`fmt-emoji-grid-shell${flipAbove ? ' fmt-emoji-grid-shell--flip-above' : ''}`}
          style={pickerStyle}
        >
          <div className="fmt-emoji-search">
            <svg className="fmt-emoji-search-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="fmt-emoji-search-input"
              placeholder="Search emoji…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="Search emoji"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="fmt-emoji-search-clear"
                aria-label="Clear search"
                title="Clear"
                onClick={() => { setQuery(''); if (searchRef.current) searchRef.current.focus(); }}
              >
                ×
              </button>
            )}
          </div>
          <div
            className={`fmt-emoji-scroll-hint fmt-emoji-scroll-hint--top${!hasOverflow ? ' is-hidden' : ''}${hasOverflow && atStart ? ' fmt-emoji-scroll-hint--dim' : ''}`}
            aria-hidden="true"
            title={hasOverflow && atStart ? 'Top of the list' : 'More emojis above — scroll up'}
          >
            ▲
          </div>
          <div
            ref={gridRef}
            className={[
              'fmt-emoji-grid',
              flipAbove ? 'fmt-emoji-grid--flip-above' : '',
              hasOverflow ? 'fmt-emoji-grid--has-overflow' : '',
              hasOverflow && !atEnd ? 'fmt-emoji-grid--hint-down' : '',
              hasOverflow && !atStart ? 'fmt-emoji-grid--hint-up' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role="group"
            aria-label="More emojis"
            onScroll={updateScrollState}
          >
            {filteredEmojis.length === 0 && (
              <div className="fmt-emoji-empty">No emoji match &ldquo;{query}&rdquo;</div>
            )}
            {filteredEmojis.map((ch, i) => (
              <button
                key={i}
                type="button"
                className="fmt-btn fmt-emoji fmt-emoji-picker-cell"
                style={{ cssText: EMOJI_CELL_STYLE } /* applied as inline styles below */}
                title="Insert"
                aria-label="Insert emoji"
                onClick={() => handleEmojiClick(ch)}
              >
                <span
                  className="fmt-emoji-char"
                  style={{
                    fontFamily:
                      "'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol','Noto Color Emoji','Twemoji Mozilla',emoji,system-ui,sans-serif",
                  }}
                >
                  {ch}
                </span>
              </button>
            ))}
          </div>
          <div
            className={`fmt-emoji-scroll-hint fmt-emoji-scroll-hint--bottom${!hasOverflow ? ' is-hidden' : ''}${hasOverflow && atEnd ? ' fmt-emoji-scroll-hint--dim' : ''}`}
            aria-hidden="true"
            title={hasOverflow && atEnd ? 'End of the list' : 'More emojis below — scroll down'}
          >
            ▼
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="format-toolbar" role="toolbar" aria-label="Insert formatting">
      <span className="format-toolbar-label">Format</span>
      <div className="format-toolbar-rail">
        <button type="button" className="fmt-btn fmt-btn-b" title="Bold (*text*)" aria-label="Bold" onClick={() => onInsertFormat('bold')}>
          <strong>B</strong>
        </button>
        <button type="button" className="fmt-btn fmt-btn-i" title="Italic (_text_)" aria-label="Italic" onClick={() => onInsertFormat('italic')}>
          <em>I</em>
        </button>
        <button type="button" className="fmt-btn fmt-btn-s" title="Strikethrough (~text~)" aria-label="Strikethrough" onClick={() => onInsertFormat('strike')}>
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </button>
        <button type="button" className="fmt-btn fmt-btn-mono" title="Inline code (`text`)" aria-label="Inline code" onClick={() => onInsertFormat('code')}>
          `
        </button>
        <button type="button" className="fmt-btn fmt-btn-mono" title="Code block (triple backticks)" aria-label="Code block" onClick={() => onInsertFormat('fenced')}>
          {'{ }'}
        </button>
        <button type="button" className="fmt-btn fmt-btn-link" title="Link — [label](url). Select text first to use it as the label." aria-label="Insert link" onClick={() => onInsertFormat('link')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
        <span className="fmt-sep" aria-hidden="true" />
        <button
          ref={summaryRef}
          type="button"
          className="fmt-btn fmt-more-summary"
          title="More emojis — opens below or above to fit (Unicode)"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
        >
          ⋯
        </button>
        {onClear && (
          <button
            type="button"
            className="fmt-btn fmt-btn-clear"
            style={{ marginLeft: 'auto' }}
            title="Clear the text box"
            aria-label="Clear the text box"
            onClick={onClear}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}
      </div>
      {pickerPortal}
    </div>
  );
}
