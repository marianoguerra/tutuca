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

import { HtmlTokenizer, QuoteType } from "./html-tokenizer.js";
import {
  FORMATTING_ELEMENTS,
  FOREIGN_BREAKOUT_TAGS,
  FRAGMENT_CONTEXT_MODES,
  MATHML_TEXT_INTEGRATION_POINTS,
  MATHML_TEXT_INTEGRATION_POINT_NAMES,
  MODES,
  NS,
  RAW_TEXT_ELEMENTS,
  SCOPE_BUTTON,
  SCOPE_DEFAULT,
  SCOPE_LIST_ITEM,
  SCOPE_TABLE,
  SELECT_BREAKOUT_TAGS,
  SPECIAL_ELEMENTS,
  MATHML_ATTR_LOWERCASE_TO_CAMEL,
  STANDARD_SVG_CAMEL_ELEMENTS,
  SVG_ATTR_LOWERCASE_TO_CAMEL,
  SVG_HTML_INTEGRATION_POINT_NAMES,
  VOID_ELEMENTS,
} from "./htmllinter-tables.js";

export const HTML_TAG_NAME_HAS_UPPERCASE = "HTML_TAG_NAME_HAS_UPPERCASE";
export const HTML_SVG_TAG_WILL_LOWERCASE = "HTML_SVG_TAG_WILL_LOWERCASE";
export const HTML_SVG_ATTR_WILL_LOWERCASE = "HTML_SVG_ATTR_WILL_LOWERCASE";
export const HTML_MATHML_ATTR_WILL_LOWERCASE = "HTML_MATHML_ATTR_WILL_LOWERCASE";
export const HTML_TAG_NOT_ALLOWED_IN_PARENT = "HTML_TAG_NOT_ALLOWED_IN_PARENT";
export const HTML_TEXT_NOT_ALLOWED_IN_PARENT = "HTML_TEXT_NOT_ALLOWED_IN_PARENT";
export const HTML_VOID_ELEMENT_HAS_CLOSE_TAG = "HTML_VOID_ELEMENT_HAS_CLOSE_TAG";
export const HTML_DUPLICATE_FORM = "HTML_DUPLICATE_FORM";
export const HTML_NESTED_INTERACTIVE = "HTML_NESTED_INTERACTIVE";
export const HTML_MISNESTED_FORMATTING = "HTML_MISNESTED_FORMATTING";
export const HTML_UNEXPECTED_END_TAG = "HTML_UNEXPECTED_END_TAG";
export const HTML_DUPLICATE_ATTRIBUTE = "HTML_DUPLICATE_ATTRIBUTE";
export const HTML_ATTRIBUTES_ON_END_TAG = "HTML_ATTRIBUTES_ON_END_TAG";
export const HTML_SELF_CLOSING_END_TAG = "HTML_SELF_CLOSING_END_TAG";
export const HTML_MISSING_ATTRIBUTE_VALUE = "HTML_MISSING_ATTRIBUTE_VALUE";
export const HTML_CDATA_IN_HTML_NAMESPACE = "HTML_CDATA_IN_HTML_NAMESPACE";
export const HTML_BOGUS_COMMENT = "HTML_BOGUS_COMMENT";
export const HTML_UNCLOSED_BEFORE_END = "HTML_UNCLOSED_BEFORE_END";

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

// §13.2.6.4.7 "generate implied end tags". Frames with these names can be
// silently popped without emitting HTML_UNCLOSED_BEFORE_END.
const IMPLIED_END_TAGS = new Set([
  "dd",
  "dt",
  "li",
  "optgroup",
  "option",
  "p",
  "rb",
  "rp",
  "rt",
  "rtc",
]);

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
    this.templateInsertionModes = ctxName === "template" ? [MODES.inTemplate] : [];
    this.activeFormatting = []; // entries: frame ref or null marker
    this.framesetOk = true;

    this.svgCamelElements = opts.svgCamelElements ?? STANDARD_SVG_CAMEL_ELEMENTS;
    // Tags treated as phantom (skipped from stack/dispatch). Used for Tutuca's
    // <x> and <x:macroname> templating tags, whose actual rendered output
    // can't be predicted at lint time. Matched as `name === prefix` or
    // `name.startsWith(prefix + ":")`. Lowercased once because the comparison
    // is against the lowercased tag name.
    this.transparentTagPrefixes = (opts.transparentTagPrefixes ?? []).map((p) => p.toLowerCase());

    // Per-token scratch.
    this.currentTagName = "";
    this.currentTagRawName = "";
    this.currentTagStart = 0;
    this.currentAttrs = []; // [{ name, rawName, nameStart, value, valueStart, valueEnd, quote }]
    this.currentAttr = null; // partial attribute being built
    this.tokenizer = null;
  }

  // ─── Tokenizer.Callbacks ──────────────────────────────────────────────────

  onopentagname(start, end) {
    const raw = this.html.slice(start, end);
    this.currentTagRawName = raw;
    // The Tokenizer doesn't lowercase; we lowercase for matching but keep raw
    // for case-violation reporting.
    this.currentTagName = raw.toLowerCase();
    this.currentTagStart = start;
    this.currentAttrs = [];
    this.currentAttr = null;
  }

  onattribname(start, end) {
    const rawName = this.html.slice(start, end);
    this.currentAttr = {
      name: rawName.toLowerCase(),
      rawName,
      nameStart: start,
      value: null,
      valueStart: -1,
      valueEnd: -1,
      quote: QuoteType.NoValue,
    };
  }

  onattribdata(start, end) {
    if (!this.currentAttr) return;
    this.currentAttr.valueStart = start;
    this.currentAttr.valueEnd = end;
    this.currentAttr.value = this.html.slice(start, end);
  }

  onattribend(quote, _end) {
    const a = this.currentAttr;
    if (!a) return;
    a.quote = quote;
    // Drop duplicates per spec but report — matches html5ever
    // tokenizer/mod.rs:555 ("Duplicate attribute").
    const dup = this.currentAttrs.find((x) => x.name === a.name);
    if (dup) {
      this.report(HTML_DUPLICATE_ATTRIBUTE, LEVEL_WARN, a.nameStart, {
        name: a.name,
        firstAt: dup.nameStart,
      });
    } else {
      this.currentAttrs.push(a);
    }
    // <input value=> with `>` immediately after `=` produces a zero-length
    // unquoted value (html-tokenizer.js:519-527). A real empty value would
    // be quoted (`value=""`) — flag the unquoted case as missing-value.
    if (a.quote === QuoteType.Unquoted && a.value === "") {
      this.report(HTML_MISSING_ATTRIBUTE_VALUE, LEVEL_WARN, a.nameStart, {
        name: a.name,
      });
    }
    this.currentAttr = null;
  }

  onattribentity(_cp) {}
  ontextentity(_cp, _end) {}

  getAttr(name) {
    const a = this.currentAttrs.find((x) => x.name === name);
    return a ? a.value : null;
  }

  hasAttr(name) {
    return this.currentAttrs.some((x) => x.name === name);
  }

  onopentagend(endIndex) {
    this.handleStartTag(false, endIndex);
  }

  onselfclosingtag(endIndex) {
    this.handleStartTag(true, endIndex);
  }

  onclosetag(start, end) {
    const raw = this.html.slice(start, end);
    const name = raw.toLowerCase();
    // Tokenizer doesn't expose attributes/self-close on end tags — scan
    // forward from the name end to the next `>` ourselves. html5ever flags
    // both as parse errors (tokenizer/mod.rs:455 "Attributes on an end
    // tag", :458 "Self-closing end tag").
    let i = end;
    let lastNonWs = -1;
    while (i < this.html.length) {
      const c = this.html.charCodeAt(i);
      if (c === 62 /* > */) break;
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) lastNonWs = i;
      i++;
    }
    if (lastNonWs >= 0) {
      // Self-closing end tag: the only non-whitespace content is a single
      // `/` immediately before `>`. Anything else means attributes.
      if (this.html.charCodeAt(lastNonWs) === 47 /* / */ && lastNonWs === i - 1) {
        // Disambiguate `</div/>` from `</div foo/>` by checking whether
        // there's any non-whitespace content before the trailing slash.
        let firstNonWs = -1;
        for (let j = end; j < lastNonWs; j++) {
          const c2 = this.html.charCodeAt(j);
          if (c2 !== 32 && c2 !== 9 && c2 !== 10 && c2 !== 13 && c2 !== 12) {
            firstNonWs = j;
            break;
          }
        }
        if (firstNonWs < 0) {
          this.report(HTML_SELF_CLOSING_END_TAG, LEVEL_WARN, start, { tag: name });
        } else {
          this.report(HTML_ATTRIBUTES_ON_END_TAG, LEVEL_WARN, start, { tag: name });
        }
      } else {
        this.report(HTML_ATTRIBUTES_ON_END_TAG, LEVEL_WARN, start, { tag: name });
      }
    }
    this.handleEndTag(name, start);
  }

  ontext(start, end) {
    if (start >= end) return;
    // Inside a foreign frame that isn't an integration point, text is always
    // allowed (foreign content's insertion-mode rules ignore text-in-table
    // and similar HTML-mode constraints). Integration points fall through to
    // HTML-mode handling.
    const top = this.currentNode();
    if (top && top.ns !== NS.html && !this.isIntegrationPoint(top)) return;
    this.handleText(start, end);
  }

  oncomment(start, _end, endOffset) {
    // The vendored Tokenizer encodes the closing-sequence length in
    // endOffset: 3 for a real `<!-- … -->` (html-tokenizer.js:306), 0 for a
    // bogus declaration like `<!foo>` or `</1foo>` reinterpreted as a
    // comment (html-tokenizer.js:540, 605).
    if (endOffset === 0) {
      this.report(HTML_BOGUS_COMMENT, LEVEL_WARN, start, {
        mode: this.insertionMode,
      });
    }
  }

  oncdata(start, _end, _endOffset) {
    // CDATA is only valid in foreign content; in HTML it's reinterpreted
    // as a bogus comment (html5ever tokenizer/mod.rs:1654-1659).
    if (this.currentNamespace() === NS.html) {
      this.report(HTML_CDATA_IN_HTML_NAMESPACE, LEVEL_WARN, start, {
        mode: this.insertionMode,
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
      if (f.ns === NS.html) {
        if (scopeSet.has(f.name)) return false;
      } else if (this.isScopeBoundary(f)) {
        // Integration points + MathML annotation-xml are listed in the
        // default scope (WHATWG §13.2.4.2). Other foreign frames (svg/g/
        // circle/etc.) are *walked past* — the original "all foreign →
        // boundary" was over-restrictive vs. the spec.
        return false;
      }
    }
    return false;
  }

  // Foreign frame names that bound scope walks per spec (§13.2.4.2 default
  // scope list). This is broader than isHtmlIntegrationPoint: every MathML
  // annotation-xml is a boundary regardless of encoding, even though only
  // those with encoding=text/html dispatch as HTML.
  isScopeBoundary(frame) {
    if (frame.ns === NS.math) {
      return MATHML_TEXT_INTEGRATION_POINT_NAMES.has(frame.name) || frame.name === "annotation-xml";
    }
    if (frame.ns === NS.svg) {
      return SVG_HTML_INTEGRATION_POINT_NAMES.has(frame.name);
    }
    return false;
  }

  // Frames that re-enter HTML token dispatch (not the same as scope
  // boundaries — annotation-xml only re-enters HTML when its encoding is
  // text/html or application/xhtml+xml; html5ever rules.rs:1649-1665).
  isIntegrationPoint(frame) {
    if (frame.ns === NS.math) {
      if (MATHML_TEXT_INTEGRATION_POINT_NAMES.has(frame.name)) return true;
      if (frame.name === "annotation-xml" && frame.htmlIntegration) return true;
      return false;
    }
    if (frame.ns === NS.svg) {
      return SVG_HTML_INTEGRATION_POINT_NAMES.has(frame.name);
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

    // Per-attribute case correction for foreign content. Applies when the
    // element being opened is in (or about to enter) the SVG / MathML
    // namespace — html5ever mod.rs:1755-1817 (SVG), :1819-1824 (MathML).
    // Root <svg>/<math> tags themselves get adjusted, so check the target
    // namespace, not just the parent's.
    const targetNs = ns !== NS.html ? ns : name === "svg" ? NS.svg : name === "math" ? NS.math : NS.html;
    if (targetNs === NS.svg) {
      for (const a of this.currentAttrs) {
        const canonical = SVG_ATTR_LOWERCASE_TO_CAMEL.get(a.name);
        if (canonical && a.rawName !== canonical) {
          this.report(HTML_SVG_ATTR_WILL_LOWERCASE, LEVEL_ERROR, a.nameStart, {
            raw: a.rawName,
            canonical,
          });
        }
      }
    } else if (targetNs === NS.math) {
      for (const a of this.currentAttrs) {
        const canonical = MATHML_ATTR_LOWERCASE_TO_CAMEL.get(a.name);
        if (canonical && a.rawName !== canonical) {
          this.report(HTML_MATHML_ATTR_WILL_LOWERCASE, LEVEL_ERROR, a.nameStart, {
            raw: a.rawName,
            canonical,
          });
        }
      }
    }

    // Phantom tags (e.g. Tutuca's <x>, <x:macroname>) are skipped: they're
    // replaced at render time, so their position in the parent is whatever
    // their expansion produces. Case checks above still applied.
    if (this.isTransparentTag(name)) return;

    // Foreign content has its own algorithm — but integration points
    // dispatch with HTML rules instead (html5ever rules.rs gates
    // step_foreign on the current node not being an integration point).
    const top = this.currentNode();
    const inForeign = ns !== NS.html && !(top && this.isIntegrationPoint(top));
    if (inForeign && !this.shouldBreakoutFromForeign(name)) {
      this.startTagInForeign(name, raw, selfClosing, start);
      return;
    }
    if (inForeign && this.shouldBreakoutFromForeign(name)) {
      // Foreign-breakout: pop until current is HTML. Surface the silent
      // reparenting as a finding (html5ever rules.rs:1631 emits
      // unexpected_start_tag_in_foreign_content here).
      this.report(HTML_TAG_NOT_ALLOWED_IN_PARENT, LEVEL_WARN, start, {
        tag: raw,
        parent: this.currentNode()?.name ?? "(root)",
        mode: this.insertionMode,
        action: "foreign-breakout",
      });
      while (this.openElements.length && this.currentNode()?.ns !== NS.html) {
        this.openElements.pop();
      }
    }

    this.dispatchStartTag(name, raw, selfClosing, start, endIndex);
  }

  shouldBreakoutFromForeign(name) {
    if (FOREIGN_BREAKOUT_TAGS.has(name)) return true;
    if (name === "font") {
      // §13.2.6.5 / html5ever rules.rs:1633-1647 — only <font> with one of
      // color/face/size escapes foreign content; bare <font> stays.
      return this.hasAttr("color") || this.hasAttr("face") || this.hasAttr("size");
    }
    return false;
  }

  startTagInForeign(name, raw, selfClosing, start) {
    // Adjust namespace transitions: <svg> stays svg, nested <math> inside svg.
    const ns = name === "svg" ? NS.svg : name === "math" ? NS.math : this.currentNamespace();

    // Integration points re-enter HTML (MathML text + SVG html integration
    // points + annotation-xml with an html encoding). mglyph/malignmark are
    // excluded per WHATWG §13.2.6.5.
    const top = this.currentNode();
    if (top && this.isIntegrationPoint(top) && name !== "mglyph" && name !== "malignmark") {
      this.dispatchStartTag(name, raw, selfClosing, start, start + raw.length);
      return;
    }

    if (selfClosing) return; // don't push
    // Store the lowercased form. The HTML_SVG_TAG_WILL_LOWERCASE finding
    // emitted earlier already preserved the source case for reporting; the
    // stack only needs the canonical name for subsequent lookups.
    const frame = { name, ns, start };
    // annotation-xml acts as an HTML integration point if encoding is
    // text/html or application/xhtml+xml (html5ever rules.rs:1649-1665).
    // Capture the flag at push time so isIntegrationPoint can read it.
    if (ns === NS.math && name === "annotation-xml") {
      const enc = (this.getAttr("encoding") ?? "").toLowerCase();
      if (enc === "text/html" || enc === "application/xhtml+xml") {
        frame.htmlIntegration = true;
      }
    }
    this.openElements.push(frame);
  }

  dispatchStartTag(name, raw, selfClosing, start, endIndex) {
    switch (this.insertionMode) {
      case MODES.inTemplate:
        return this.startInTemplate(name, raw, selfClosing, start, endIndex);
      case MODES.inBody:
        return this.startInBody(name, raw, selfClosing, start, endIndex);
      case MODES.inTable:
        return this.startInTable(name, raw, selfClosing, start, endIndex);
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
      // A form inside a template is fine because templates have their own
      // scope; outside a template, a still-open <form> on the stack means
      // this <form> would be silently dropped by the real parser.
      if (this.openElementsHas("form") && !this.openElementsHas("template")) {
        this.report(HTML_DUPLICATE_FORM, LEVEL_ERROR, start, {
          tag: raw,
          mode: this.insertionMode,
        });
        return;
      }
      if (this.hasInButtonScope("p")) this.implicitlyClose("p", start, raw);
      this.push(raw, NS.html, start);
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
      // §13.2.6.4.7 "in body" — only the *active formatting list* triggers
      // adoption-agency for <a>; the open-elements stack alone doesn't.
      if (this.activeFormattingHas("a")) {
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
      // Same precondition shape as <a>: html5ever's <nobr> handler runs the
      // adoption agency only when nobr is in the active formatting list.
      if (this.activeFormattingHas("nobr")) {
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

  // Simplified adoption agency. The real algorithm clones the formatting
  // element, splices it after the furthest block, and *keeps* the entry on
  // the active formatting list (replaced via bookmark — html5ever
  // mod.rs:713-921). We don't build a DOM, but we mirror the bookkeeping
  // shape: pop the open-elements entry and leave the active-formatting
  // entry in place so a subsequent same-name tag still sees it (which is
  // what triggers the next adoption-agency run / nested-interactive lint).
  runAdoptionAgency(name) {
    for (let i = this.activeFormatting.length - 1; i >= 0; i--) {
      const e = this.activeFormatting[i];
      if (e === null) break;
      if (e.name === name) {
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
      // §"in table" — <input type=hidden> is the one input allowed inside a
      // table without foster-parenting (html5ever rules.rs handles this in
      // the inTable arm). Any other type triggers foster-parent.
      const type = (this.getAttr("type") ?? "").toLowerCase();
      if (type === "hidden") return;
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

    // Foreign-content end tag (html5ever rules.rs:1652-1683): walk down,
    // case-insensitive match against foreign frames; on the first HTML
    // frame *after* a non-matching foreign top, dispatch in HTML mode
    // without popping anything. Emit HTML_UNEXPECTED_END_TAG once if the
    // top foreign frame doesn't match.
    if (ns !== NS.html) {
      let stackIdx = this.openElements.length - 1;
      let first = true;
      while (stackIdx > 0) {
        const f = this.openElements[stackIdx];
        if (!first && f.ns === NS.html) break; // fall through to HTML dispatch
        if (f.ns !== NS.html && f.name.toLowerCase() === name) {
          this.openElements.length = stackIdx;
          return;
        }
        if (first) {
          this.report(HTML_UNEXPECTED_END_TAG, LEVEL_WARN, start, {
            tag: name,
            mode: this.insertionMode,
          });
          first = false;
        }
        stackIdx--;
      }
      // Fall through: HTML mode dispatch.
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

    // §"any other end tag" in body: walk the stack; if we hit a special
    // element before finding the match, emit a parse error and ignore the
    // tag (html5ever mod.rs:1340+).
    const endIsTableStructural = TABLE_SCOPE_TAGS.has(name);
    for (let i = this.openElements.length - 1; i >= 0; i--) {
      const f = this.openElements[i];
      if (f.ns === NS.html && f.name === name) {
        // Anything between i+1 and the top is being implicitly closed by
        // this end tag. The spec emits a parse error if those frames
        // aren't in the implied-end-tags set (dd/dt/li/option/optgroup/p/
        // rb/rp/rt/rtc). html5ever mod.rs:1311-1316 "expected to close <X>
        // with cell" has the same shape. Table-structural end tags
        // additionally close cells/rows/sections silently.
        for (let j = this.openElements.length - 1; j > i; j--) {
          const popped = this.openElements[j];
          if (
            popped.ns === NS.html &&
            popped.name !== name &&
            !IMPLIED_END_TAGS.has(popped.name) &&
            !(endIsTableStructural && TABLE_SCOPE_TAGS.has(popped.name))
          ) {
            this.report(HTML_UNCLOSED_BEFORE_END, LEVEL_WARN, start, {
              tag: name,
              unclosed: popped.name,
              mode: this.insertionMode,
            });
            break;
          }
        }
        this.openElements.length = i;
        if (TABLE_SCOPE_TAGS.has(name) || name === "select" || name === "template") {
          this.resetInsertionModeAppropriately();
        }
        return;
      }
      if (
        f.ns === NS.html &&
        SPECIAL_ELEMENTS.has(f.name) &&
        !IMPLIED_END_TAGS.has(f.name) &&
        !(endIsTableStructural && TABLE_SCOPE_TAGS.has(f.name))
      ) {
        // Implied-end-tag frames (li/p/etc.) and table-structural frames
        // closed by table-structural end tags are silently popped; only
        // non-implied special elements trigger the parse error.
        this.report(HTML_UNEXPECTED_END_TAG, LEVEL_WARN, start, {
          tag: name,
          mode: this.insertionMode,
        });
        return;
      }
    }
    // No match anywhere in the stack — silently ignore (browsers do).
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
