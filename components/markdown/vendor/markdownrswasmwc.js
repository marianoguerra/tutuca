import { mkToHtml } from "./markdown.js";

let _toHtml = null;
function getToHtml() {
  if (_toHtml === null) {
    _toHtml = mkToHtml(`${MdView.basePath}markdownrswasm.js`);
  }
  return _toHtml;
}

// Largest offset >= `from` such that md.slice(0, offset) can no longer change as
// more text is appended, so it is safe to parse-and-render once ("commit") and never
// touch again. The remainder (the "active tail") is re-parsed on every token.
//
// We only commit at blank-line block boundaries, never inside an open fenced code
// block, and always keep the last block active (it may still grow). The one construct
// that can merge across a blank line is a list (`- a\n\n- b` is a single loose list),
// so a trailing run of list blocks is kept active together. Conservative by design:
// when unsure it commits less, never more. Markdown-rs is whole-document only, so the
// committed delta is parsed in a single call (intra-delta merges stay correct); only
// the committed/active boundary needs protecting.
export function findCommitPoint(md, from) {
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
  const listRe = /^ {0,3}([-*+]|\d{1,9}[.)])([ \t]|$)/;
  const blankRe = /^[ \t]*$/;
  const n = md.length;

  // Block-start offsets (first non-blank line after a blank line) at top level.
  const starts = [];
  let i = from;
  let prevBlank = true; // `from` is always at a clean block boundary
  let inFence = false;
  let fenceMarker = "";
  while (i < n) {
    let end = md.indexOf("\n", i);
    if (end === -1) end = n;
    const line = md.slice(i, end);
    if (inFence) {
      const m = line.match(fenceRe);
      if (
        m && m[1][0] === fenceMarker[0] && m[1].length >= fenceMarker.length &&
        line.slice(m[0].length).trim() === ""
      ) {
        inFence = false;
      }
      prevBlank = false;
    } else if (blankRe.test(line)) {
      prevBlank = true;
    } else {
      if (prevBlank) starts.push(i);
      prevBlank = false;
      const m = line.match(fenceRe);
      if (m) {
        inFence = true;
        fenceMarker = m[1];
      }
    }
    i = end + 1;
  }

  if (starts.length <= 1) return from; // keep the only/last block active

  const startsWithList = (off) => {
    let end = md.indexOf("\n", off);
    if (end === -1) end = n;
    return listRe.test(md.slice(off, end));
  };

  // Commit up to the start of the last block; walk back over a trailing run of lists
  // so a loose list split across the boundary can't render as two separate lists.
  let j = starts.length - 1;
  while (j >= 1 && startsWithList(starts[j]) && startsWithList(starts[j - 1])) j--;
  return starts[j];
}

function makeDefaultStyleSheet() {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { display: block; }
    :host textarea { display: none; }
    h1, h2, h3, h4 { margin: 0.8em 0 0.4em; line-height: 1.25; }
    p { margin: 0.5em 0; }
    ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
    pre {
      background: rgba(127, 127, 127, 0.15);
      padding: 0.5em;
      overflow-x: auto;
    }
    code { font-family: ui-monospace, monospace; }
    pre code { background: transparent; padding: 0; }
    blockquote {
      margin: 0.5em 0;
      padding: 0 0.75em;
      border-left: 3px solid rgba(127, 127, 127, 0.4);
      color: rgba(127, 127, 127, 1);
    }
    table { border-collapse: collapse; }
    th, td {
      border: 1px solid rgba(127, 127, 127, 0.4);
      padding: 0.3em 0.6em;
    }
    a { color: inherit; }
  `);
  return sheet;
}

export class MdView extends HTMLElement {
  static basePath = "./";
  static defaultStyleSheet = makeDefaultStyleSheet();

  constructor() {
    super();
    this._content = "";
    this._committedLen = 0; // md.slice(0, _committedLen) is rendered into _committed
    this._dirty = false;
    this._rendering = false;
    this._loopPromise = null;
    // Auto-finalize: once updates stop for this many ms, run one authoritative full
    // re-parse. Treats a quiet period as "stream ended". 0/negative disables it.
    this._autoFinalizeDelay = 1000;
    this._finalizeTimer = null;
    this._extraSheets = [];
    const root = this.attachShadow({ mode: "open" });
    this._output = document.createElement("div");
    // Two regions: finalized blocks (append-only) and the in-progress tail.
    this._committed = document.createElement("div");
    this._active = document.createElement("div");
    this._output.append(this._committed, this._active);
    root.append(this._output);
    this._applySheets();
  }

  _applySheets() {
    this.shadowRoot.adoptedStyleSheets = [
      MdView.defaultStyleSheet,
      ...this._extraSheets,
    ];
  }

  get stylesheets() {
    return this._extraSheets;
  }

  set stylesheets(sheets) {
    this._extraSheets = Array.isArray(sheets) ? sheets : [];
    this._applySheets();
  }

  get autoFinalizeDelay() {
    return this._autoFinalizeDelay;
  }

  set autoFinalizeDelay(ms) {
    this._autoFinalizeDelay = Number(ms) || 0;
  }

  disconnectedCallback() {
    this._cancelAutoFinalize();
  }

  connectedCallback() {
    if (!this._content) {
      const ta = this.querySelector("textarea");
      if (ta) {
        const md = ta.value;
        ta.remove();
        this.content = md;
        return;
      }
    }
    this._scheduleRender();
  }

  get content() {
    return this._content;
  }

  set content(md) {
    const next = md == null ? "" : String(md);
    if (next === this._content) return;
    // Incremental rendering is only valid when the new value extends the old one
    // (the streaming case). Anything else (clear/replace/shrink) starts fresh.
    if (!next.startsWith(this._content)) this._reset();
    this._content = next;
    this._scheduleRender();
    this._scheduleAutoFinalize();
  }

  _reset() {
    this._committed.innerHTML = "";
    this._active.innerHTML = "";
    this._committedLen = 0;
  }

  // Debounce: restart a timer on every update; it fires only once updates have been
  // quiet for `_autoFinalizeDelay` ms, at which point we treat the stream as ended.
  _scheduleAutoFinalize() {
    this._cancelAutoFinalize();
    if (this._autoFinalizeDelay > 0 && this._content) {
      this._finalizeTimer = setTimeout(() => {
        this._finalizeTimer = null;
        this.finalize();
      }, this._autoFinalizeDelay);
    }
  }

  _cancelAutoFinalize() {
    if (this._finalizeTimer !== null) {
      clearTimeout(this._finalizeTimer);
      this._finalizeTimer = null;
    }
  }

  // Serialize + coalesce: renders are async (WASM init), so run them one at a time and
  // collapse bursts of tokens into a single render of the latest content. This keeps
  // the mutable incremental state consistent and avoids double-appending.
  _scheduleRender() {
    this._dirty = true;
    if (this._rendering) return;
    this._rendering = true;
    this._loopPromise = (async () => {
      try {
        while (this._dirty) {
          this._dirty = false;
          await this._renderOnce();
        }
      } finally {
        this._rendering = false;
      }
    })();
  }

  async _renderOnce() {
    const md = this._content;
    if (!md) {
      this._reset();
      return;
    }
    try {
      const toHtml = getToHtml();
      // Commit newly-finalized blocks once, then re-render only the active tail.
      const p = findCommitPoint(md, this._committedLen);
      if (p > this._committedLen) {
        const html = await toHtml(md.slice(this._committedLen, p));
        this._appendCommitted(html);
        this._committedLen = p;
      }
      this._active.innerHTML = await toHtml(md.slice(this._committedLen));
    } catch (err) {
      this._handleError(err, md);
    }
  }

  _appendCommitted(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    this._committed.append(tpl.content);
  }

  // One authoritative full re-parse, e.g. on stream end. Corrects any conservative
  // commit-boundary approximation and cross-region references. Safe to call anytime;
  // aborts if a newer update lands while it is parsing (that update reschedules it).
  async finalize() {
    this._cancelAutoFinalize();
    const md = this._content;
    try {
      if (this._loopPromise) await this._loopPromise;
      const html = md ? await getToHtml()(md) : "";
      if (this._content !== md) return; // superseded by a newer update
      this._committed.innerHTML = html;
      this._active.innerHTML = "";
      this._committedLen = md.length;
    } catch (err) {
      if (this._content === md) this._handleError(err, md);
    }
  }

  _handleError(err, md) {
    console.error("[md-view] render failed:", err);
    const msg = (err && (err.message || String(err))) || "render failed";
    // textContent, not innerHTML — the error string is untrusted.
    this._active.textContent = `md-view: ${msg}`;
    this.dispatchEvent(new CustomEvent("md-view-error", {
      detail: { error: err, content: md },
      bubbles: true,
      composed: true,
    }));
  }
}

export function register(name = "md-view") {
  if (!customElements.get(name)) customElements.define(name, MdView);
}
