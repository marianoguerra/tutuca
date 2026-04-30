// HTML structural linter built on htmlparser2's Tokenizer. Walks an HTML
// fragment once and reports tag-case violations, insertion-mode rejections
// (foster-parenting, ignored tokens, implicit closes), text-in-table
// violations, and misnested formatting elements.
//
// The state machine implements WHATWG §13.2.6 tree-construction at the
// fidelity needed to predict where the real parser would silently rearrange
// the DOM. We don't build a DOM — we just track the algorithm's bookkeeping
// (open-elements stack, active-formatting list, insertion mode, template
// modes, form pointer, framesetOk) and emit a finding wherever the spec says
// "parse error" or describes a silent reparenting.

import { HtmlTokenizer } from "./html-tokenizer.js";
import {
  FORMATTING_ELEMENTS,
  FOREIGN_BREAKOUT_TAGS,
  FRAGMENT_CONTEXT_MODES,
  MATHML_TEXT_INTEGRATION_POINTS,
  MODES,
  NS,
  RAW_TEXT_ELEMENTS,
  SCOPE_BUTTON,
  SCOPE_DEFAULT,
  SCOPE_LIST_ITEM,
  SCOPE_TABLE,
  SELECT_BREAKOUT_TAGS,
  SPECIAL_ELEMENTS,
  STANDARD_SVG_CAMEL_ELEMENTS,
  VOID_ELEMENTS,
} from "./htmllinter-tables.js";

export const HTML_TAG_NAME_HAS_UPPERCASE = "HTML_TAG_NAME_HAS_UPPERCASE";
export const HTML_SVG_TAG_WILL_LOWERCASE = "HTML_SVG_TAG_WILL_LOWERCASE";
export const HTML_TAG_NOT_ALLOWED_IN_PARENT = "HTML_TAG_NOT_ALLOWED_IN_PARENT";
export const HTML_TEXT_NOT_ALLOWED_IN_PARENT = "HTML_TEXT_NOT_ALLOWED_IN_PARENT";
export const HTML_VOID_ELEMENT_HAS_CLOSE_TAG = "HTML_VOID_ELEMENT_HAS_CLOSE_TAG";
export const HTML_DUPLICATE_FORM = "HTML_DUPLICATE_FORM";
export const HTML_NESTED_INTERACTIVE = "HTML_NESTED_INTERACTIVE";
export const HTML_MISNESTED_FORMATTING = "HTML_MISNESTED_FORMATTING";
export const HTML_UNEXPECTED_END_TAG = "HTML_UNEXPECTED_END_TAG";

const LEVEL_ERROR = "error";
const LEVEL_WARN = "warn";

const TABLE_SCOPE_TAGS = new Set([
  "caption",
  "colgroup",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "table",
]);

const TABLE_BODY_CELL_TAGS = new Set(["td", "th"]);

export function lintHtml(html, onFinding, opts = {}) {
  const TokenizerClass = opts.TokenizerClass ?? HtmlTokenizer;
  const ctx = new LinterCtx(html, onFinding, opts);
  const tokenizer = new TokenizerClass(
    { xmlMode: false, decodeEntities: false, recognizeSelfClosing: true },
    ctx,
  );
  ctx.tokenizer = tokenizer;
  tokenizer.write(html);
  tokenizer.end();
  return ctx.findingCount;
}

class LinterCtx {
  constructor(html, onFinding, opts) {
    this.html = html;
    this.onFinding = onFinding;
    this.findingCount = 0;
    this.lineStarts = computeLineStarts(html);

    const ctxName = opts.fragmentContext ?? "template";
    const ctxInfo = FRAGMENT_CONTEXT_MODES[ctxName] ?? FRAGMENT_CONTEXT_MODES.template;

    this.openElements = [];
    if (ctxName === "tr") {
      this.openElements.push({ name: "table", ns: NS.html, start: -1 });
      this.openElements.push({ name: "tbody", ns: NS.html, start: -1 });
    } else if (ctxName === "tbody" || ctxName === "thead" || ctxName === "tfoot") {
      this.openElements.push({ name: "table", ns: NS.html, start: -1 });
    } else if (ctxName === "td" || ctxName === "th") {
      this.openElements.push({ name: "table", ns: NS.html, start: -1 });
      this.openElements.push({ name: "tbody", ns: NS.html, start: -1 });
      this.openElements.push({ name: "tr", ns: NS.html, start: -1 });
    } else if (ctxName === "caption") {
      this.openElements.push({ name: "table", ns: NS.html, start: -1 });
    } else if (ctxName === "colgroup") {
      this.openElements.push({ name: "table", ns: NS.html, start: -1 });
    } else if (ctxName === "svg") {
      this.openElements.push({ name: "svg", ns: NS.svg, start: -1 });
    } else if (ctxName === "math") {
      this.openElements.push({ name: "math", ns: NS.math, start: -1 });
    } else if (ctxName === "select") {
      this.openElements.push({ name: "select", ns: NS.html, start: -1 });
    }

    this.insertionMode = ctxInfo.mode;
    this.originalInsertionMode = MODES.inBody;
    this.templateInsertionModes = ctxName === "template" ? [MODES.inTemplate] : [];
    this.activeFormatting = []; // entries: frame ref or null marker
    this.formPointer = null;
    this.framesetOk = true;

    this.svgCamelElements = opts.svgCamelElements ?? STANDARD_SVG_CAMEL_ELEMENTS;
    // Tags treated as phantom (skipped from stack/dispatch). Used for Tutuca's
    // <x> and <x:macroname> templating tags, whose actual rendered output
    // can't be predicted at lint time. Matched as `name === prefix` or
    // `name.startsWith(prefix + ":")`.
    this.transparentTagPrefixes = opts.transparentTagPrefixes ?? [];

    // Per-token scratch.
    this.currentTagName = "";
    this.currentTagRawName = "";
    this.currentTagStart = 0;
    this.tokenizer = null;
    // For text mode: track the element we're inside so end-tag matches.
    this.textRestoreMode = null;
  }

  // ─── Tokenizer.Callbacks ──────────────────────────────────────────────────

  onopentagname(start, end) {
    const raw = this.html.slice(start, end);
    this.currentTagRawName = raw;
    // The Tokenizer doesn't lowercase; we lowercase for matching but keep raw
    // for case-violation reporting.
    this.currentTagName = raw.toLowerCase();
    this.currentTagStart = start;
  }

  onattribname(_start, _end) {
    // Attributes aren't used for the rules we currently emit. Kept as stub
    // so future attribute-casing rule can hook here.
  }
  onattribdata(_start, _end) {}
  onattribentity(_cp) {}
  onattribend(_quote, _end) {}
  ontextentity(_cp, _end) {}

  onopentagend(endIndex) {
    this.handleStartTag(false, endIndex);
  }

  onselfclosingtag(endIndex) {
    this.handleStartTag(true, endIndex);
  }

  onclosetag(start, end) {
    const raw = this.html.slice(start, end);
    const name = raw.toLowerCase();
    this.handleEndTag(name, start);
  }

  ontext(start, end) {
    if (start >= end) return;
    this.handleText(start, end);
  }

  oncomment(_start, _end, _endOffset) {
    // Comments are valid in every insertion mode we care about.
  }

  oncdata(start, _end, _endOffset) {
    // CDATA outside foreign content is reinterpreted as a bogus comment.
    if (this.currentNamespace() === NS.html) {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_WARN, start, {
        tag: "[CDATA[",
        mode: this.insertionMode,
        action: "ignored",
      });
    }
  }

  ondeclaration(_start, _end) {}
  onprocessinginstruction(_start, _end) {}

  isInForeignContext() {
    return this.currentNamespace() !== NS.html;
  }

  onend() {
    // Fragment parsing — open elements at end is normal.
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  report(id, level, offset, info) {
    this.findingCount++;
    const { line, column } = offsetToLineCol(this.lineStarts, offset);
    this.onFinding({
      id,
      level,
      info,
      location: { start: offset, end: offset + (info.tag?.length ?? 0), line, column },
    });
  }

  currentNode() {
    return this.openElements[this.openElements.length - 1] ?? null;
  }

  currentNamespace() {
    const top = this.currentNode();
    return top ? top.ns : NS.html;
  }

  push(name, ns, start) {
    this.openElements.push({ name, ns, start });
  }

  pop() {
    return this.openElements.pop();
  }

  hasInScope(target, scopeSet) {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const f = this.openElements[i];
      if (f.name === target && f.ns === NS.html) return true;
      if (f.ns === NS.html && scopeSet.has(f.name)) return false;
      if (f.ns !== NS.html) {
        // SVG/MathML are scope boundaries except integration points.
        return false;
      }
    }
    return false;
  }

  hasInDefaultScope(target) {
    return this.hasInScope(target, SCOPE_DEFAULT);
  }
  hasInButtonScope(target) {
    return this.hasInScope(target, SCOPE_BUTTON);
  }
  hasInListItemScope(target) {
    return this.hasInScope(target, SCOPE_LIST_ITEM);
  }
  hasInTableScope(target) {
    return this.hasInScope(target, SCOPE_TABLE);
  }
  hasInSelectScope(target) {
    // Inverted: only optgroup/option are NOT boundaries.
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const f = this.openElements[i];
      if (f.ns !== NS.html) return false;
      if (f.name === target) return true;
      if (f.name !== "optgroup" && f.name !== "option") return false;
    }
    return false;
  }

  popUntilName(name) {
    while (this.openElements.length) {
      const f = this.openElements.pop();
      if (f.name === name) return f;
    }
    return null;
  }

  generateImpliedEndTags(except = null) {
    const implied = new Set(["dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"]);
    while (this.openElements.length) {
      const top = this.currentNode();
      if (top.ns !== NS.html) break;
      if (!implied.has(top.name) || top.name === except) break;
      this.openElements.pop();
    }
  }

  // ─── Start tag dispatch ───────────────────────────────────────────────────

  isTransparentTag(name) {
    for (const prefix of this.transparentTagPrefixes) {
      if (name === prefix || name.startsWith(`${prefix}:`)) return true;
    }
    return false;
  }

  handleStartTag(selfClosing, endIndex) {
    const name = this.currentTagName;
    const raw = this.currentTagRawName;
    const start = this.currentTagStart;
    const ns = this.currentNamespace();

    // Case-violation checks happen on every open tag.
    if (ns === NS.html) {
      if (raw !== name) {
        this.report(HTML_TAG_NAME_HAS_UPPERCASE, LEVEL_ERROR, start, {
          raw,
          lowercased: name,
        });
      }
    } else if (ns === NS.svg) {
      if (raw !== raw.toLowerCase() && !this.svgCamelElements.has(raw)) {
        this.report(HTML_SVG_TAG_WILL_LOWERCASE, LEVEL_ERROR, start, {
          raw,
          lowercased: name,
        });
      }
    }

    // Phantom tags (e.g. Tutuca's <x>, <x:macroname>) are skipped: they're
    // replaced at render time, so their position in the parent is whatever
    // their expansion produces. Case checks above still applied.
    if (this.isTransparentTag(name)) return;

    // Foreign content has its own algorithm.
    if (ns !== NS.html && !this.shouldBreakoutFromForeign(name)) {
      this.startTagInForeign(name, raw, selfClosing, start);
      return;
    }
    if (ns !== NS.html && this.shouldBreakoutFromForeign(name)) {
      // Pop foreign nodes until current is HTML.
      while (this.openElements.length && this.currentNode()?.ns !== NS.html) {
        this.openElements.pop();
      }
      // Fall through to normal HTML processing.
    }

    this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
  }

  shouldBreakoutFromForeign(name) {
    if (FOREIGN_BREAKOUT_TAGS.has(name)) return true;
    if (name === "font") return true; // covered by attr check in spec; flag conservatively
    return false;
  }

  startTagInForeign(name, raw, selfClosing, start) {
    // Adjust namespace transitions: <svg> stays svg, nested <math> inside svg.
    const ns = name === "svg" ? NS.svg : name === "math" ? NS.math : this.currentNamespace();

    // MathML text integration points re-enter HTML.
    const top = this.currentNode();
    if (
      top &&
      top.ns === NS.math &&
      MATHML_TEXT_INTEGRATION_POINTS.has(top.name) &&
      name !== "mglyph" &&
      name !== "malignmark"
    ) {
      // Treat as HTML.
      this.dispatchStartTag(name, raw, selfClosing, start, start + raw.length);
      return;
    }

    if (selfClosing) return; // don't push
    this.push(raw, ns, start);
  }

  dispatchStartTag(name, raw, selfClosing, start, endIndex) {
    switch (this.insertionMode) {
      case MODES.inTemplate:
        return this.startInTemplate(name, raw, selfClosing, start, endIndex);
      case MODES.inBody:
        return this.startInBody(name, raw, selfClosing, start, endIndex);
      case MODES.inTable:
        return this.startInTable(name, raw, selfClosing, start, endIndex);
      case MODES.inTableText:
        this.flushTableText();
        this.insertionMode = this.originalInsertionMode;
        return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
      case MODES.inCaption:
        return this.startInCaption(name, raw, selfClosing, start, endIndex);
      case MODES.inColumnGroup:
        return this.startInColumnGroup(name, raw, selfClosing, start, endIndex);
      case MODES.inTableBody:
        return this.startInTableBody(name, raw, selfClosing, start, endIndex);
      case MODES.inRow:
        return this.startInRow(name, raw, selfClosing, start, endIndex);
      case MODES.inCell:
        return this.startInCell(name, raw, selfClosing, start, endIndex);
      case MODES.inSelect:
        return this.startInSelect(name, raw, selfClosing, start, endIndex);
      case MODES.inSelectInTable:
        return this.startInSelectInTable(name, raw, selfClosing, start, endIndex);
      case MODES.text:
        // Tokenizer keeps us out of tag mode while in raw text. Should not happen.
        return;
    }
  }

  // ─── inBody ───────────────────────────────────────────────────────────────

  startInBody(name, raw, selfClosing, start, _endIndex) {
    // §13.2.6.4.7 — large dispatch.
    if (
      name === "html" ||
      name === "head" ||
      name === "body" ||
      name === "frame" ||
      name === "frameset"
    ) {
      // Rare in fragments; ignore but flag as unexpected.
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_WARN, start, {
        tag: raw,
        mode: this.insertionMode,
        action: "ignored",
      });
      return;
    }

    if (
      name === "address" ||
      name === "article" ||
      name === "aside" ||
      name === "blockquote" ||
      name === "center" ||
      name === "details" ||
      name === "dialog" ||
      name === "dir" ||
      name === "div" ||
      name === "dl" ||
      name === "fieldset" ||
      name === "figcaption" ||
      name === "figure" ||
      name === "footer" ||
      name === "header" ||
      name === "hgroup" ||
      name === "main" ||
      name === "menu" ||
      name === "nav" ||
      name === "ol" ||
      name === "p" ||
      name === "search" ||
      name === "section" ||
      name === "summary" ||
      name === "ul"
    ) {
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      return;
    }

    if (
      name === "h1" ||
      name === "h2" ||
      name === "h3" ||
      name === "h4" ||
      name === "h5" ||
      name === "h6"
    ) {
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      const top = this.currentNode();
      if (top && /^h[1-6]$/.test(top.name)) {
        this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
          tag: raw,
          parent: top.name,
          mode: this.insertionMode,
          action: "auto-close-implicit",
        });
        this.openElements.pop();
      }
      this.push(raw, NS.html, start);
      return;
    }

    if (name === "pre" || name === "listing") {
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      this.framesetOk = false;
      return;
    }

    if (name === "form") {
      if (this.formPointer !== null && !this.openElementsHas("template")) {
        this.report(HTML_DUPLICATE_FORM, LEVEL_ERROR, start, {
          tag: raw,
          mode: this.insertionMode,
        });
        return;
      }
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      this.formPointer = this.currentNode();
      return;
    }

    if (name === "li") {
      this.framesetOk = false;
      // §"in body" — if li is in list item scope, generate implied end tags except for li, then close.
      for (let i = this.openElements.length - 1; i >= 0; i--) {
        const f = this.openElements[i];
        if (f.ns !== NS.html) break;
        if (f.name === "li") {
          this.generateImpliedEndTags("li");
          while (this.openElements.length) {
            const popped = this.openElements.pop();
            if (popped.name === "li") break;
          }
          break;
        }
        if (
          SPECIAL_ELEMENTS.has(f.name) &&
          f.name !== "address" &&
          f.name !== "div" &&
          f.name !== "p"
        ) {
          break;
        }
      }
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      return;
    }

    if (name === "dd" || name === "dt") {
      this.framesetOk = false;
      for (let i = this.openElements.length - 1; i >= 0; i--) {
        const f = this.openElements[i];
        if (f.ns !== NS.html) break;
        if (f.name === "dd" || f.name === "dt") {
          this.generateImpliedEndTags(f.name);
          while (this.openElements.length) {
            const popped = this.openElements.pop();
            if (popped.name === f.name) break;
          }
          break;
        }
        if (
          SPECIAL_ELEMENTS.has(f.name) &&
          f.name !== "address" &&
          f.name !== "div" &&
          f.name !== "p"
        ) {
          break;
        }
      }
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      return;
    }

    if (name === "plaintext") {
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      // Tokenizer enters plaintext via its own state; we just track stack.
      return;
    }

    if (name === "button") {
      if (this.hasInDefaultScope("button")) {
        this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
          tag: raw,
          parent: "button",
          mode: this.insertionMode,
          action: "auto-close-implicit",
        });
        this.generateImpliedEndTags();
        this.popUntilName("button");
      }
      this.push(raw, NS.html, start);
      this.framesetOk = false;
      return;
    }

    if (name === "a") {
      // Adoption-agency precondition: an existing <a> in active formatting list.
      if (this.openElementsHas("a") || this.activeFormattingHas("a")) {
        this.report(HTML_NESTED_INTERACTIVE, LEVEL_WARN, start, {
          tag: raw,
          mode: this.insertionMode,
        });
        this.runAdoptionAgency("a");
      }
      this.push(raw, NS.html, start);
      this.activeFormatting.push(this.currentNode());
      return;
    }

    if (FORMATTING_ELEMENTS.has(name)) {
      this.push(raw, NS.html, start);
      this.activeFormatting.push(this.currentNode());
      return;
    }

    if (name === "nobr") {
      if (this.hasInDefaultScope("nobr")) {
        this.report(HTML_NESTED_INTERACTIVE, LEVEL_WARN, start, {
          tag: raw,
          mode: this.insertionMode,
        });
        this.runAdoptionAgency("nobr");
      }
      this.push(raw, NS.html, start);
      this.activeFormatting.push(this.currentNode());
      return;
    }

    if (name === "table") {
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      this.framesetOk = false;
      this.insertionMode = MODES.inTable;
      return;
    }

    if (
      name === "area" ||
      name === "br" ||
      name === "embed" ||
      name === "img" ||
      name === "keygen" ||
      name === "wbr" ||
      name === "input" ||
      name === "param" ||
      name === "source" ||
      name === "track" ||
      name === "hr" ||
      name === "meta" ||
      name === "link" ||
      name === "col" ||
      name === "base"
    ) {
      // Void elements — don't push.
      this.framesetOk = false;
      return;
    }

    if (name === "select") {
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
      this.framesetOk = false;
      // §"in body": if current insertion mode is one of inTable/inCaption/...
      // switch to inSelectInTable, else inSelect. We were in inBody so:
      this.insertionMode = MODES.inSelect;
      return;
    }

    if (name === "option" || name === "optgroup") {
      if (this.currentNode()?.name === "option") {
        this.openElements.pop();
      }
      this.push(raw, NS.html, start);
      return;
    }

    if (name === "textarea" || name === "title" || RAW_TEXT_ELEMENTS.has(name)) {
      this.push(raw, NS.html, start);
      // Tokenizer handles raw-text content; we just need stack tracking.
      return;
    }

    if (name === "math" || name === "svg") {
      this.push(raw, name === "svg" ? NS.svg : NS.math, start);
      this.framesetOk = false;
      return;
    }

    if (
      name === "caption" ||
      name === "col" ||
      name === "colgroup" ||
      name === "frame" ||
      name === "tbody" ||
      name === "td" ||
      name === "tfoot" ||
      name === "th" ||
      name === "thead" ||
      name === "tr"
    ) {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
        tag: raw,
        parent: this.currentNode()?.name ?? "(root)",
        mode: this.insertionMode,
        action: "ignored",
      });
      return;
    }

    // Generic catch-all: any other start tag — push.
    if (selfClosing) return;
    this.push(raw, NS.html, start);
  }

  openElementsHas(name) {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const f = this.openElements[i];
      if (f.ns === NS.html && f.name === name) return true;
    }
    return false;
  }

  activeFormattingHas(name) {
    for (let i = this.activeFormatting.length - 1; i >= 0; i--) {
      const e = this.activeFormatting[i];
      if (e === null) return false; // marker
      if (e.name === name) return true;
    }
    return false;
  }

  // Simplified adoption agency: just remove the entry from active formatting
  // and from open elements stack. Real algorithm reorders nodes; we only need
  // bookkeeping integrity to keep tracking subsequent tags.
  runAdoptionAgency(name) {
    for (let i = this.activeFormatting.length - 1; i >= 0; i--) {
      const e = this.activeFormatting[i];
      if (e === null) break;
      if (e.name === name) {
        this.activeFormatting.splice(i, 1);
        const idx = this.openElements.indexOf(e);
        if (idx >= 0) this.openElements.splice(idx, 1);
        return;
      }
    }
  }

  implicitlyClose(name, _start, _newTagRaw) {
    while (this.openElements.length) {
      const popped = this.openElements.pop();
      if (popped.name === name) break;
    }
  }

  // ─── inTemplate ───────────────────────────────────────────────────────────

  startInTemplate(name, raw, selfClosing, start, endIndex) {
    let next;
    if (
      name === "caption" ||
      name === "colgroup" ||
      name === "tbody" ||
      name === "tfoot" ||
      name === "thead"
    ) {
      next = MODES.inTable;
    } else if (name === "col") {
      next = MODES.inColumnGroup;
    } else if (name === "tr") {
      next = MODES.inTableBody;
    } else if (name === "td" || name === "th") {
      next = MODES.inRow;
    } else {
      // Everything else dispatches in body.
      this.popTemplateMode();
      this.pushTemplateMode(MODES.inBody);
      this.insertionMode = MODES.inBody;
      return this.startInBody(name, raw, selfClosing, start, endIndex);
    }
    this.popTemplateMode();
    this.pushTemplateMode(next);
    this.insertionMode = next;
    return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
  }

  popTemplateMode() {
    if (this.templateInsertionModes.length) this.templateInsertionModes.pop();
  }
  pushTemplateMode(mode) {
    this.templateInsertionModes.push(mode);
  }

  // ─── inTable ──────────────────────────────────────────────────────────────

  startInTable(name, raw, selfClosing, start, endIndex) {
    if (name === "caption") {
      this.clearStackBackToTable();
      this.activeFormatting.push(null); // marker
      this.push(raw, NS.html, start);
      this.insertionMode = MODES.inCaption;
      return;
    }
    if (name === "colgroup") {
      this.clearStackBackToTable();
      this.push(raw, NS.html, start);
      this.insertionMode = MODES.inColumnGroup;
      return;
    }
    if (name === "col") {
      this.clearStackBackToTable();
      this.push("colgroup", NS.html, start);
      this.insertionMode = MODES.inColumnGroup;
      return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
    }
    if (name === "tbody" || name === "thead" || name === "tfoot") {
      this.clearStackBackToTable();
      this.push(raw, NS.html, start);
      this.insertionMode = MODES.inTableBody;
      return;
    }
    if (name === "td" || name === "th" || name === "tr") {
      this.clearStackBackToTable();
      this.push("tbody", NS.html, start);
      this.insertionMode = MODES.inTableBody;
      return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
    }
    if (name === "table") {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
        tag: raw,
        parent: "table",
        mode: this.insertionMode,
        action: "auto-close-implicit",
      });
      if (this.hasInTableScope("table")) {
        this.popUntilName("table");
        this.resetInsertionModeAppropriately();
        return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
      }
      return;
    }
    if (name === "style" || name === "script" || name === "template") {
      return this.startInBody(name, raw, selfClosing, start, endIndex);
    }
    if (name === "input") {
      // Per spec, type=hidden is allowed; otherwise foster-parent.
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_WARN, start, {
        tag: raw,
        parent: "table",
        mode: this.insertionMode,
        action: "foster-parent",
      });
      return;
    }
    if (name === "form") {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
        tag: raw,
        parent: "table",
        mode: this.insertionMode,
        action: "ignored",
      });
      return;
    }

    // Foster-parent: anything else.
    this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
      tag: raw,
      parent: this.currentNode()?.name ?? "table",
      mode: this.insertionMode,
      action: "foster-parent",
    });
    // Continue parsing but treat the tag as "in body" for state purposes,
    // popping nothing — the spec says foster-parent the *node* but parse the
    // *tokens* per "in body".
    return this.startInBody(name, raw, selfClosing, start, endIndex);
  }

  clearStackBackToTable() {
    while (this.openElements.length) {
      const top = this.currentNode();
      if (!top) break;
      if (top.name === "table" || top.name === "template") break;
      this.openElements.pop();
    }
  }

  // ─── inTableText ──────────────────────────────────────────────────────────

  flushTableText() {
    if (!this.pendingTableText) return;
    const { hasNonWhitespace, start, snippet } = this.pendingTableText;
    if (hasNonWhitespace) {
      this.report(HTML_TEXT_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
        mode: this.originalInsertionMode,
        snippet,
      });
    }
    this.pendingTableText = null;
  }

  // ─── inCaption ────────────────────────────────────────────────────────────

  startInCaption(name, raw, selfClosing, start, endIndex) {
    if (
      name === "caption" ||
      name === "col" ||
      name === "colgroup" ||
      name === "tbody" ||
      name === "td" ||
      name === "tfoot" ||
      name === "th" ||
      name === "thead" ||
      name === "tr"
    ) {
      if (this.hasInTableScope("caption")) {
        this.generateImpliedEndTags();
        this.popUntilName("caption");
        this.clearActiveFormattingToMarker();
        this.insertionMode = MODES.inTable;
        return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
      }
      return;
    }
    return this.startInBody(name, raw, selfClosing, start, endIndex);
  }

  clearActiveFormattingToMarker() {
    while (this.activeFormatting.length) {
      const e = this.activeFormatting.pop();
      if (e === null) return;
    }
  }

  // ─── inColumnGroup ────────────────────────────────────────────────────────

  startInColumnGroup(name, raw, selfClosing, start, endIndex) {
    if (name === "col") {
      // void
      return;
    }
    if (name === "template") {
      return this.startInBody(name, raw, selfClosing, start, endIndex);
    }
    // Anything else: implicit </colgroup>, reprocess in inTable.
    if (this.currentNode()?.name === "colgroup") {
      this.openElements.pop();
      this.insertionMode = MODES.inTable;
      return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
    }
    this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
      tag: raw,
      parent: "colgroup",
      mode: this.insertionMode,
      action: "ignored",
    });
  }

  // ─── inTableBody ──────────────────────────────────────────────────────────

  startInTableBody(name, raw, selfClosing, start, endIndex) {
    if (name === "tr") {
      this.clearStackBackToTableBody();
      this.push(raw, NS.html, start);
      this.insertionMode = MODES.inRow;
      return;
    }
    if (TABLE_BODY_CELL_TAGS.has(name)) {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_WARN, start, {
        tag: raw,
        parent: this.currentNode()?.name ?? "tbody",
        mode: this.insertionMode,
        action: "auto-close-implicit",
      });
      this.clearStackBackToTableBody();
      this.push("tr", NS.html, start);
      this.insertionMode = MODES.inRow;
      return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
    }
    if (
      name === "caption" ||
      name === "col" ||
      name === "colgroup" ||
      name === "tbody" ||
      name === "tfoot" ||
      name === "thead"
    ) {
      if (
        this.hasInTableScope("tbody") ||
        this.hasInTableScope("thead") ||
        this.hasInTableScope("tfoot")
      ) {
        this.clearStackBackToTableBody();
        this.openElements.pop();
        this.insertionMode = MODES.inTable;
        return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
      }
      return;
    }
    return this.startInTable(name, raw, selfClosing, start, endIndex);
  }

  clearStackBackToTableBody() {
    while (this.openElements.length) {
      const top = this.currentNode();
      if (!top) break;
      if (
        top.name === "tbody" ||
        top.name === "thead" ||
        top.name === "tfoot" ||
        top.name === "template" ||
        top.name === "table"
      )
        break;
      this.openElements.pop();
    }
  }

  // ─── inRow ────────────────────────────────────────────────────────────────

  startInRow(name, raw, selfClosing, start, endIndex) {
    if (TABLE_BODY_CELL_TAGS.has(name)) {
      this.clearStackBackToTableRow();
      this.push(raw, NS.html, start);
      this.insertionMode = MODES.inCell;
      this.activeFormatting.push(null);
      return;
    }
    if (
      name === "caption" ||
      name === "col" ||
      name === "colgroup" ||
      name === "tbody" ||
      name === "tfoot" ||
      name === "thead" ||
      name === "tr"
    ) {
      if (this.hasInTableScope("tr")) {
        this.clearStackBackToTableRow();
        this.openElements.pop();
        this.insertionMode = MODES.inTableBody;
        return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
      }
      return;
    }
    return this.startInTable(name, raw, selfClosing, start, endIndex);
  }

  clearStackBackToTableRow() {
    while (this.openElements.length) {
      const top = this.currentNode();
      if (!top) break;
      if (top.name === "tr" || top.name === "template" || top.name === "table") break;
      this.openElements.pop();
    }
  }

  // ─── inCell ───────────────────────────────────────────────────────────────

  startInCell(name, raw, selfClosing, start, endIndex) {
    if (
      name === "caption" ||
      name === "col" ||
      name === "colgroup" ||
      name === "tbody" ||
      name === "td" ||
      name === "tfoot" ||
      name === "th" ||
      name === "thead" ||
      name === "tr"
    ) {
      if (this.hasInTableScope("td") || this.hasInTableScope("th")) {
        this.closeCell();
        return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
      }
      return;
    }
    return this.startInBody(name, raw, selfClosing, start, endIndex);
  }

  closeCell() {
    this.generateImpliedEndTags();
    while (this.openElements.length) {
      const popped = this.openElements.pop();
      if (popped.name === "td" || popped.name === "th") break;
    }
    this.clearActiveFormattingToMarker();
    this.insertionMode = MODES.inRow;
  }

  // ─── inSelect ─────────────────────────────────────────────────────────────

  startInSelect(name, raw, _selfClosing, start, _endIndex) {
    if (name === "option") {
      if (this.currentNode()?.name === "option") this.openElements.pop();
      this.push(raw, NS.html, start);
      return;
    }
    if (name === "optgroup") {
      if (this.currentNode()?.name === "option") this.openElements.pop();
      if (this.currentNode()?.name === "optgroup") this.openElements.pop();
      this.push(raw, NS.html, start);
      return;
    }
    if (name === "hr") return;
    if (SELECT_BREAKOUT_TAGS.has(name)) {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
        tag: raw,
        parent: "select",
        mode: this.insertionMode,
        action: "auto-close-implicit",
      });
      if (this.hasInSelectScope("select")) {
        this.popUntilName("select");
        this.resetInsertionModeAppropriately();
      }
      // input/keygen/textarea are dropped after closing select per spec for
      // input/keygen; for textarea/select, reprocess.
      if (name === "select") return;
      return this.dispatchStartTag(name, raw, false, start, _endIndex);
    }
    if (name === "script" || name === "template") {
      return this.startInBody(name, raw, false, start, _endIndex);
    }
    // Anything else: ignored.
    this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
      tag: raw,
      parent: "select",
      mode: this.insertionMode,
      action: "ignored",
    });
  }

  // ─── inSelectInTable ──────────────────────────────────────────────────────

  startInSelectInTable(name, raw, selfClosing, start, endIndex) {
    if (
      name === "caption" ||
      name === "table" ||
      name === "tbody" ||
      name === "tfoot" ||
      name === "thead" ||
      name === "tr" ||
      name === "td" ||
      name === "th"
    ) {
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
        tag: raw,
        parent: "select",
        mode: this.insertionMode,
        action: "auto-close-implicit",
      });
      this.popUntilName("select");
      this.resetInsertionModeAppropriately();
      return this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
    }
    return this.startInSelect(name, raw, selfClosing, start, endIndex);
  }

  resetInsertionModeAppropriately() {
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const f = this.openElements[i];
      if (f.ns !== NS.html) continue;
      const last = i === 0;
      switch (f.name) {
        case "select":
          this.insertionMode = MODES.inSelect;
          return;
        case "td":
        case "th":
          if (!last) {
            this.insertionMode = MODES.inCell;
            return;
          }
          break;
        case "tr":
          this.insertionMode = MODES.inRow;
          return;
        case "tbody":
        case "thead":
        case "tfoot":
          this.insertionMode = MODES.inTableBody;
          return;
        case "caption":
          this.insertionMode = MODES.inCaption;
          return;
        case "colgroup":
          this.insertionMode = MODES.inColumnGroup;
          return;
        case "table":
          this.insertionMode = MODES.inTable;
          return;
        case "template":
          this.insertionMode =
            this.templateInsertionModes[this.templateInsertionModes.length - 1] ?? MODES.inBody;
          return;
        default:
          break;
      }
    }
    this.insertionMode = MODES.inBody;
  }

  // ─── End tag dispatch ─────────────────────────────────────────────────────

  handleEndTag(name, start) {
    if (this.isTransparentTag(name)) return;
    const ns = this.currentNamespace();

    // Foreign-content end tags.
    if (ns !== NS.html) {
      // Pop matching foreign element (case-insensitive).
      for (let i = this.openElements.length - 1; i >= 0; i--) {
        const f = this.openElements[i];
        if (f.ns === NS.html) break;
        if (f.name.toLowerCase() === name) {
          this.openElements.length = i;
          return;
        }
      }
      // Unknown — try HTML rules.
    }

    if (VOID_ELEMENTS.has(name)) {
      this.report(HTML_VOID_ELEMENT_HAS_CLOSE_TAG, LEVEL_WARN, start, {
        tag: name,
        mode: this.insertionMode,
      });
      return;
    }

    // For misnested formatting elements, trigger adoption-agency detection.
    if (FORMATTING_ELEMENTS.has(name)) {
      const top = this.currentNode();
      if (top && top.ns === NS.html && top.name === name) {
        // Well-nested.
        this.openElements.pop();
        this.removeFromActiveFormattingByRef(top);
        return;
      }
      if (this.activeFormattingHas(name) || this.openElementsHas(name)) {
        this.report(HTML_MISNESTED_FORMATTING, LEVEL_WARN, start, {
          tag: name,
          mode: this.insertionMode,
        });
        this.runAdoptionAgency(name);
        return;
      }
      this.report(HTML_UNEXPECTED_END_TAG, LEVEL_WARN, start, {
        tag: name,
        mode: this.insertionMode,
      });
      return;
    }

    // Generic close: pop until match.
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const f = this.openElements[i];
      if (f.ns === NS.html && f.name === name) {
        this.openElements.length = i;
        if (name === "form") this.formPointer = null;
        // Reset mode if we closed a structural element.
        if (TABLE_SCOPE_TAGS.has(name) || name === "select" || name === "template") {
          this.resetInsertionModeAppropriately();
        }
        return;
      }
      if (f.ns === NS.html && SPECIAL_ELEMENTS.has(f.name)) {
        // Close-tag for non-special is parse-error per spec — we leave silent.
        break;
      }
    }
    // Unmatched — silently ignore (browsers do).
  }

  removeFromActiveFormattingByRef(ref) {
    const idx = this.activeFormatting.indexOf(ref);
    if (idx >= 0) this.activeFormatting.splice(idx, 1);
  }

  // ─── Text dispatch ────────────────────────────────────────────────────────

  handleText(start, end) {
    if (
      this.insertionMode === MODES.inTable ||
      this.insertionMode === MODES.inTableBody ||
      this.insertionMode === MODES.inRow
    ) {
      // Per spec, switch to inTableText, batch chars, then on flush detect non-whitespace.
      const slice = this.html.slice(start, end);
      const hasNonWhitespace = /\S/.test(slice);
      if (hasNonWhitespace) {
        this.report(HTML_TEXT_NOT_ALLOWED_IN_PARENT, LEVEL_ERROR, start, {
          mode: this.insertionMode,
          snippet: slice.length > 40 ? `${slice.slice(0, 40)}…` : slice,
        });
      }
      return;
    }
    if (this.insertionMode === MODES.inColumnGroup) {
      const slice = this.html.slice(start, end);
      if (/\S/.test(slice)) {
        // Implicit </colgroup> + reprocess as inTable.
        if (this.currentNode()?.name === "colgroup") {
          this.openElements.pop();
          this.insertionMode = MODES.inTable;
          return this.handleText(start, end);
        }
      }
      return;
    }
    if (this.insertionMode === MODES.inSelect || this.insertionMode === MODES.inSelectInTable) {
      // Text is allowed in select (it just doesn't render); only `\0` is dropped.
      return;
    }
    // Other modes: text is fine.
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function computeLineStarts(html) {
  const arr = [0];
  for (let i = 0; i < html.length; i++) {
    if (html.charCodeAt(i) === 10) arr.push(i + 1);
  }
  return arr;
}

function offsetToLineCol(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
}
