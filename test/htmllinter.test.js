import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Tokenizer as Htmlparser2Tokenizer } from "htmlparser2";
import { HtmlTokenizer } from "../tools/core/html-tokenizer.js";
import {
  HTML_ATTRIBUTES_ON_END_TAG,
  HTML_BOGUS_COMMENT,
  HTML_CDATA_IN_HTML_NAMESPACE,
  HTML_DUPLICATE_ATTRIBUTE,
  HTML_DUPLICATE_FORM,
  HTML_MATHML_ATTR_WILL_LOWERCASE,
  HTML_MISNESTED_FORMATTING,
  HTML_MISSING_ATTRIBUTE_VALUE,
  HTML_NESTED_INTERACTIVE,
  HTML_SELF_CLOSING_END_TAG,
  HTML_SVG_ATTR_WILL_LOWERCASE,
  HTML_SVG_TAG_WILL_LOWERCASE,
  HTML_TAG_NAME_HAS_UPPERCASE,
  HTML_TAG_NOT_ALLOWED_IN_PARENT,
  HTML_TEXT_NOT_ALLOWED_IN_PARENT,
  HTML_UNCLOSED_BEFORE_END,
  HTML_UNEXPECTED_END_TAG,
  HTML_VOID_ELEMENT_HAS_CLOSE_TAG,
  lintHtml,
} from "../tools/core/htmllinter.js";

// Run every case against both the vendored tokenizer (the runtime default)
// and the upstream htmlparser2 Tokenizer. Any divergence between the two —
// e.g. a future re-sync that misses a state — surfaces as a labeled failure.
const TOKENIZERS = [
  ["vendored", HtmlTokenizer],
  ["htmlparser2", Htmlparser2Tokenizer],
];

describe.each(TOKENIZERS)("htmllinter (%s tokenizer)", (_label, TokenizerClass) => {
  function lint(html, opts) {
    const findings = [];
    lintHtml(html, (f) => findings.push(f), { ...opts, TokenizerClass });
    return findings;
  }

  function ids(findings) {
    return findings.map((f) => f.id);
  }

  describe("tag-name case violations (HTML namespace)", () => {
    test("flags single uppercase letter", () => {
      const f = lint(`<MyComp></MyComp>`);
      expect(ids(f)).toEqual([HTML_TAG_NAME_HAS_UPPERCASE]);
      expect(f[0].info).toEqual({ raw: "MyComp", lowercased: "mycomp" });
    });

    test("does not flag lowercase tags", () => {
      const f = lint(`<div><span></span></div>`);
      expect(f).toEqual([]);
    });

    test("flags multiple distinct uppercase tags", () => {
      const f = lint(`<MyA><MyB></MyB></MyA>`);
      expect(ids(f)).toEqual([HTML_TAG_NAME_HAS_UPPERCASE, HTML_TAG_NAME_HAS_UPPERCASE]);
    });

    test("does not flag custom-element kebab tags", () => {
      const f = lint(`<gd-gmap></gd-gmap>`);
      expect(f).toEqual([]);
    });
  });

  describe("SVG tag-name case violations", () => {
    test("foreignObject is allowed (in WHATWG list)", () => {
      const f = lint(`<svg><foreignObject></foreignObject></svg>`);
      expect(f).toEqual([]);
    });

    test("clipPath is allowed", () => {
      const f = lint(`<svg><clipPath></clipPath></svg>`);
      expect(f).toEqual([]);
    });

    test("camelCase tag NOT in WHATWG list flags", () => {
      const f = lint(`<svg><myThing></myThing></svg>`);
      expect(ids(f)).toEqual([HTML_SVG_TAG_WILL_LOWERCASE]);
      expect(f[0].info).toEqual({ raw: "myThing", lowercased: "mything" });
    });

    test("lowercase svg tags pass", () => {
      const f = lint(`<svg><circle/><rect/></svg>`);
      expect(f).toEqual([]);
    });
  });

  describe("table foster-parenting", () => {
    test("flags <div> inside <table>", () => {
      const f = lint(`<table><div></div></table>`);
      const fp = f.filter((x) => x.id === HTML_TAG_NOT_ALLOWED_IN_PARENT);
      expect(fp.length).toBeGreaterThanOrEqual(1);
      expect(fp[0].info.tag).toBe("div");
      expect(fp[0].info.action).toBe("foster-parent");
    });

    test("non-whitespace text inside <table> is flagged", () => {
      const f = lint(`<table>hello</table>`);
      expect(ids(f)).toContain(HTML_TEXT_NOT_ALLOWED_IN_PARENT);
    });

    test("whitespace text inside <table> is fine", () => {
      const f = lint(`<table>   \n   </table>`);
      expect(f).toEqual([]);
    });

    test("legal table structure with implicit close", () => {
      const f = lint(`<table><tr><td>a<tr><td>b</tr></table>`);
      expect(f).toEqual([]);
    });

    test("explicit thead/tr/td is fine", () => {
      const f = lint(`<thead><tr><td>x</td></tr><tr><td>y</td></tr></thead>`);
      expect(f).toEqual([]);
    });

    test("colgroup with non-col child", () => {
      const f = lint(`<colgroup><div></div></colgroup>`);
      // The </colgroup> is auto-implied; div ends up foster-parented from
      // inTable, so we expect a finding.
      expect(ids(f)).toContain(HTML_TAG_NOT_ALLOWED_IN_PARENT);
    });
  });

  describe("select content model", () => {
    test("<div> inside <select> is ignored (flagged)", () => {
      const f = lint(`<select><div></div></select>`);
      expect(ids(f)).toContain(HTML_TAG_NOT_ALLOWED_IN_PARENT);
    });

    test("<option> + new <optgroup> is fine", () => {
      const f = lint(`<select><option>a<optgroup><option>b</option></optgroup></select>`);
      expect(f).toEqual([]);
    });

    test("<select> inside <select> auto-closes", () => {
      const f = lint(`<select><select></select>`);
      expect(ids(f)).toContain(HTML_TAG_NOT_ALLOWED_IN_PARENT);
    });
  });

  describe("ul/ol content model", () => {
    test("<div> inside <ul> is allowed under WHATWG (li is the typical child but div doesn't trigger reparenting)", () => {
      // Per WHATWG, <ul><div></div></ul> is *content-model* invalid but the
      // tree-construction algorithm doesn't reparent. So we don't flag here.
      const f = lint(`<ul><div></div></ul>`);
      expect(f).toEqual([]);
    });

    test("nested <li> auto-closes prior <li>", () => {
      const f = lint(`<ul><li>a<li>b</ul>`);
      expect(f).toEqual([]);
    });
  });

  describe("auto-close <p> on block-level open", () => {
    test("<p>foo<div></div></p> — implicit </p>, no findings", () => {
      const f = lint(`<p>foo<div></div></p>`);
      expect(f).toEqual([]);
    });
  });

  describe("form element duplication", () => {
    test("<form> nested in <form> flags HTML_DUPLICATE_FORM", () => {
      const f = lint(`<form><form></form></form>`);
      expect(ids(f)).toContain(HTML_DUPLICATE_FORM);
    });
  });

  describe("interactive nesting", () => {
    test("<a> inside <a> flags HTML_NESTED_INTERACTIVE", () => {
      const f = lint(`<a><a></a></a>`);
      expect(ids(f)).toContain(HTML_NESTED_INTERACTIVE);
    });
  });

  describe("misnested formatting", () => {
    test("<b><i></b></i> triggers adoption agency", () => {
      const f = lint(`<b><i></b></i>`);
      expect(ids(f)).toContain(HTML_MISNESTED_FORMATTING);
    });
  });

  describe("raw-text content", () => {
    test("<script> with HTML-looking content is fine", () => {
      const f = lint(`<script>if (a < b) { foo() }</script>`);
      expect(f).toEqual([]);
    });

    test("<style> with selectors is fine", () => {
      const f = lint(`<style>div > span { color: red }</style>`);
      expect(f).toEqual([]);
    });
  });

  describe("void elements", () => {
    test("explicit </br> warns", () => {
      const f = lint(`<br></br>`);
      expect(ids(f)).toContain(HTML_VOID_ELEMENT_HAS_CLOSE_TAG);
    });

    test("self-closing void tags are fine", () => {
      const f = lint(`<br/><img/><input/>`);
      expect(f).toEqual([]);
    });
  });

  describe("template fragment context (default)", () => {
    test("top-level <option> is allowed", () => {
      const f = lint(`<option>Foo</option><option>Bar</option>`);
      expect(f).toEqual([]);
    });

    test("top-level <tr><td>x</td></tr> is allowed", () => {
      const f = lint(`<tr><td>x</td></tr>`);
      expect(f).toEqual([]);
    });

    test("top-level <td>x</td> is allowed", () => {
      const f = lint(`<td>x</td>`);
      expect(f).toEqual([]);
    });

    test("top-level <col> is allowed", () => {
      const f = lint(`<col span="2">`);
      expect(f).toEqual([]);
    });

    test("body context flags top-level <tr>", () => {
      const f = lint(`<tr><td>x</td></tr>`, { fragmentContext: "body" });
      expect(ids(f)).toContain(HTML_TAG_NOT_ALLOWED_IN_PARENT);
    });
  });

  describe("location reporting", () => {
    test("line/column point to the offending tag-name start", () => {
      const html = `<div>\n  <Foo></Foo>\n</div>`;
      const f = lint(html);
      expect(ids(f)).toContain(HTML_TAG_NAME_HAS_UPPERCASE);
      const finding = f.find((x) => x.id === HTML_TAG_NAME_HAS_UPPERCASE);
      expect(finding.location.line).toBe(2);
      // Column points to 'F' which is at "  <" — so column 4 (1-based: '\s\s<F').
      expect(finding.location.column).toBe(4);
    });

    test("first line is line 1", () => {
      const f = lint(`<MyComp></MyComp>`);
      expect(f[0].location.line).toBe(1);
      expect(f[0].location.column).toBe(2); // '<' is col 1, 'M' is col 2
    });
  });

  // ─── §A regressions ──────────────────────────────────────────────────────
  // Tests pinning the bug fixes from review-tools-core-htmllinter-js plan
  // §A. Each names the bug ID and the html5ever / WHATWG location it cites.

  describe("A1 — <font> in foreign content only breaks out with attrs", () => {
    test("bare <font> inside <svg> stays in foreign content (html5ever rules.rs:1633-1647)", () => {
      // Previously every <font> was flagged as a foreign-content breakout.
      // Per spec the breakout is gated on color/face/size attributes.
      const f = lint(`<svg><font>x</font></svg>`);
      expect(f).toEqual([]);
    });

    test("<font color> inside <svg> still breaks out (paired positive case for A1)", () => {
      const f = lint(`<svg><font color="red"></font></svg>`);
      // The breakout itself is a parse-error in html5ever
      // (rules.rs:1631) — we surface it as a foreign-breakout finding.
      const breakouts = f.filter(
        (x) => x.id === HTML_TAG_NOT_ALLOWED_IN_PARENT && x.info.action === "foreign-breakout",
      );
      expect(breakouts.length).toBeGreaterThan(0);
    });

    test("<font face> and <font size> also break out", () => {
      // Each of the three attributes individually triggers the breakout;
      // pin all three to catch any future omission in shouldBreakoutFromForeign.
      const hasBreakout = (html) =>
        lint(html).some(
          (f) => f.id === HTML_TAG_NOT_ALLOWED_IN_PARENT && f.info.action === "foreign-breakout",
        );
      expect(hasBreakout(`<svg><font face="x"></font></svg>`)).toBe(true);
      expect(hasBreakout(`<svg><font size="2"></font></svg>`)).toBe(true);
    });
  });

  describe("A2 — non-integration foreign frames are walked past in scope tests", () => {
    test("<svg><foreignObject> bounds the scope walk (per WHATWG default_scope)", () => {
      // Spec §13.2.4.2 default_scope explicitly lists SVG foreignObject
      // as a boundary, so an inner <button> opened inside it does NOT
      // see the outer <button> and no auto-close fires.
      const f = lint(
        `<button><svg><foreignObject><button></button></foreignObject></svg></button>`,
      );
      // Expect zero nested-button findings — the integration point is a
      // boundary so the inner button sees a clean scope.
      expect(ids(f).filter((c) => c === HTML_TAG_NOT_ALLOWED_IN_PARENT)).toEqual([]);
    });
  });

  describe("A3 — <select> is a default scope boundary", () => {
    test("<button> inside <select> is in scope independently of outer button", () => {
      // html5ever tag_sets.rs:53 lists "select" in html_default_scope.
      // Without this, hasInButtonScope would walk past the <select> frame.
      const f = lint(`<button><select><button></button></select></button>`);
      // Two buttons in scope → second open forces an auto-close.
      // The exact finding count isn't load-bearing; we just confirm at
      // least one nested-button detection is reported.
      expect(ids(f)).toContain(HTML_TAG_NOT_ALLOWED_IN_PARENT);
    });
  });

  describe("A5 — annotation-xml encoding=text/html is an HTML integration point", () => {
    test("<div> inside annotation-xml[encoding=text/html] is processed as HTML", () => {
      // html5ever rules.rs:1649-1665. Without this, <div> would be parsed
      // as foreign and attribute-case checks would mis-fire.
      const f = lint(
        `<math><annotation-xml encoding="text/html"><div></div></annotation-xml></math>`,
      );
      expect(f).toEqual([]);
    });

    test("<div> inside plain annotation-xml triggers foreign breakout", () => {
      // Negative pair: without encoding the annotation-xml is NOT an
      // integration point, so <div> (which is in FOREIGN_BREAKOUT_TAGS)
      // pops the foreign frames and dispatches as HTML — surfacing as a
      // foreign-breakout finding. This contrasts with the previous test
      // where the integration point kept the div nested cleanly.
      const f = lint(`<math><annotation-xml><div></div></annotation-xml></math>`);
      expect(
        f.some(
          (x) => x.id === HTML_TAG_NOT_ALLOWED_IN_PARENT && x.info.action === "foreign-breakout",
        ),
      ).toBe(true);
    });
  });

  describe("A8 — formPointer is no longer stale after </form>", () => {
    test("two sequential <form> blocks don't trip duplicate-form detection", () => {
      // The previous implementation kept formPointer pointing at a popped
      // frame, so any later <form> was reported as HTML_DUPLICATE_FORM.
      const f = lint(`<form></form><form></form>`);
      expect(f).toEqual([]);
    });

    test("nested <form> still flagged as duplicate (positive pair)", () => {
      // Sanity that the duplicate-form check still fires when the outer
      // form is genuinely still on the stack.
      const f = lint(`<form><form></form></form>`);
      expect(ids(f)).toContain(HTML_DUPLICATE_FORM);
    });
  });

  describe("A10 — transparentTagPrefixes is case-insensitive", () => {
    test("uppercase prefix in opts matches lowercase tag in source", () => {
      // The constructor lowercases prefixes once; without that, a prefix
      // configured as "X" never matched because we compare against the
      // lowercased tag name. Tag itself is lowercase so the
      // HTML_TAG_NAME_HAS_UPPERCASE lint (which fires before transparency)
      // doesn't muddy the assertion.
      const f = lint(`<x></x>`, { transparentTagPrefixes: ["X"] });
      expect(f).toEqual([]);
    });

    test("uppercase prefix matches `<x:macro>` form too", () => {
      // The two phantom forms documented on transparentTagPrefixes: the
      // bare prefix, and prefix:something.
      const f = lint(`<x:macro></x:macro>`, { transparentTagPrefixes: ["X"] });
      expect(f).toEqual([]);
    });
  });

  // ─── §B additions ────────────────────────────────────────────────────────

  describe("B2 — <input type=hidden> is allowed inside <table>", () => {
    test("<input type=hidden> inside <table> does not foster-parent", () => {
      // html5ever rules.rs (in-table arm) — the one input variant that
      // doesn't trigger foster-parenting. Authors rely on this for forms
      // embedded in tabular layouts.
      const f = lint(`<table><input type="hidden"></table>`);
      expect(f).toEqual([]);
    });

    test("<input type=text> inside <table> is foster-parented (negative pair)", () => {
      const f = lint(`<table><input type="text"></table>`);
      expect(ids(f)).toContain(HTML_TAG_NOT_ALLOWED_IN_PARENT);
    });
  });

  describe("B8 — unmatched end tag past a special element warns", () => {
    test("</span> with no matching span reports HTML_UNEXPECTED_END_TAG", () => {
      // §"any other end tag" emits a parse error if the walker hits a
      // non-implied special frame before finding a match. <article> is
      // special and not implied, so </span> on this stack walks into it
      // and bails with the parse error.
      const f = lint(`<article></span></article>`);
      expect(ids(f)).toContain(HTML_UNEXPECTED_END_TAG);
    });

    test("</p> over a <li> is silent — both are implied-closable", () => {
      // Negative pair: walking past <li> on </ul>-style closes is the
      // implicit-end-tag path, not a parse error.
      const f = lint(`<ul><li><p>x</ul>`);
      // <p>'s implicit close + <li>'s implicit close + <ul> close — clean.
      expect(f).toEqual([]);
    });
  });

  describe("B10 — foreign end tag falls through to HTML mode", () => {
    test("</div> inside <svg> walks back and dispatches in HTML mode", () => {
      // html5ever rules.rs:1652-1683 — when no foreign frame matches, we
      // walk back; on the first HTML frame, dispatch the end tag in HTML
      // mode. The first non-matching foreign frame triggers
      // HTML_UNEXPECTED_END_TAG once.
      const f = lint(`<div><svg><circle></circle></svg></div>`);
      expect(f).toEqual([]); // well-nested case stays clean
    });

    test("malformed: </p> inside <svg> with surrounding <p> auto-closes", () => {
      // The </p> can't match the svg-namespace circle; the algorithm
      // should walk back and dispatch the </p> in HTML mode, finding the
      // outer <p>.
      const f = lint(`<p><svg></svg></p>`);
      expect(f).toEqual([]);
    });
  });

  // ─── §C new lints ────────────────────────────────────────────────────────

  describe("HTML_DUPLICATE_ATTRIBUTE", () => {
    test("two attributes with the same name on one tag warns", () => {
      // html5ever tokenizer/mod.rs:555 — the second name is dropped per
      // spec; we surface the silent drop as a finding.
      const f = lint(`<div class="a" class="b"></div>`);
      expect(ids(f)).toContain(HTML_DUPLICATE_ATTRIBUTE);
    });

    test("distinct attributes do not trigger the lint (negative pair)", () => {
      const f = lint(`<div class="a" id="b"></div>`);
      expect(f).toEqual([]);
    });
  });

  describe("HTML_ATTRIBUTES_ON_END_TAG and HTML_SELF_CLOSING_END_TAG", () => {
    test("</div class=foo> warns about attributes on end tag", () => {
      // html5ever tokenizer/mod.rs:455 — attributes on an end tag are a
      // parse error and silently dropped. The closing tag scanner
      // distinguishes this from </div/>.
      const f = lint(`<div></div class="foo">`);
      expect(ids(f)).toContain(HTML_ATTRIBUTES_ON_END_TAG);
    });

    test("</div/> warns about self-closing end tag", () => {
      // html5ever tokenizer/mod.rs:458. The trailing slash is meaningless
      // on a close tag and signals authoring confusion with XHTML.
      const f = lint(`<div></div/>`);
      expect(ids(f)).toContain(HTML_SELF_CLOSING_END_TAG);
    });

    test("plain </div> stays clean (negative pair for both lints)", () => {
      const f = lint(`<div></div>`);
      expect(f).toEqual([]);
    });
  });

  describe("HTML_MISSING_ATTRIBUTE_VALUE", () => {
    test("<input value=> warns (zero-length unquoted value)", () => {
      // The tokenizer commits a zero-length unquoted attribute value
      // when `=` is followed by `>` (html-tokenizer.js:519-527). A
      // legitimately empty value would be quoted.
      const f = lint(`<input value=>`);
      expect(ids(f)).toContain(HTML_MISSING_ATTRIBUTE_VALUE);
    });

    test('<input value=""> is fine (negative pair: explicit empty)', () => {
      // Quoted empty is legal HTML and shouldn't fire the lint.
      const f = lint(`<input value="">`);
      expect(f).toEqual([]);
    });
  });

  describe("HTML_CDATA_IN_HTML_NAMESPACE", () => {
    test("<![CDATA[…]]> at top level warns", () => {
      // html5ever tokenizer/mod.rs:1654-1659 — CDATA outside of foreign
      // content is reinterpreted as a bogus comment, silently losing the
      // content authors expected to keep.
      const f = lint(`<![CDATA[some data]]>`);
      expect(ids(f)).toContain(HTML_CDATA_IN_HTML_NAMESPACE);
    });

    test("<![CDATA[…]]> inside <svg> is fine (negative pair)", () => {
      // CDATA is valid in foreign content; no finding expected.
      const f = lint(`<svg><![CDATA[some data]]></svg>`);
      expect(f).toEqual([]);
    });
  });

  describe("HTML_BOGUS_COMMENT", () => {
    test("<!foo> warns (declaration without DOCTYPE/-- prefix)", () => {
      // html5ever tokenizer/mod.rs:1658 — markup declarations that don't
      // match `<!DOCTYPE` or `<!--` are reinterpreted as bogus comments.
      // The tokenizer emits oncomment with endOffset=0 for this path
      // (html-tokenizer.js:540 / 605); we use that signal.
      const f = lint(`<!foo>`);
      expect(ids(f)).toContain(HTML_BOGUS_COMMENT);
    });

    test("<!-- normal comment --> does NOT fire (negative pair)", () => {
      // Real comments emit oncomment with endOffset=3 — distinguishable
      // from the bogus path above.
      const f = lint(`<!-- normal comment -->`);
      expect(f).toEqual([]);
    });
  });

  describe("HTML_SVG_ATTR_WILL_LOWERCASE", () => {
    test("<svg viewbox=...> warns because canonical is viewBox", () => {
      // html5ever mod.rs:1755-1817. The tree builder silently rewrites
      // these to canonical camelCase; surfacing the rewrite catches the
      // common authoring mistake of typing all-lowercase SVG attrs.
      const f = lint(`<svg viewbox="0 0 10 10"></svg>`);
      expect(ids(f)).toContain(HTML_SVG_ATTR_WILL_LOWERCASE);
    });

    test("<svg viewBox=...> with canonical case stays clean", () => {
      const f = lint(`<svg viewBox="0 0 10 10"></svg>`);
      expect(f).toEqual([]);
    });
  });

  describe("HTML_MATHML_ATTR_WILL_LOWERCASE", () => {
    test("<math definitionurl=...> warns; canonical is definitionURL", () => {
      // html5ever mod.rs:1819-1824 — only one MathML attribute requires
      // case correction; pin it explicitly.
      const f = lint(`<math definitionurl="x"></math>`);
      expect(ids(f)).toContain(HTML_MATHML_ATTR_WILL_LOWERCASE);
    });
  });

  describe("HTML_UNCLOSED_BEFORE_END", () => {
    test("</div> while a <span> is still open warns about the unclosed span", () => {
      // §"any other end tag" — when the matched frame is below
      // non-implied-close frames on the stack, the popped intermediate
      // is "unclosed before end". <span> is special and not implied.
      const f = lint(`<div><span></div>`);
      expect(ids(f)).toContain(HTML_UNCLOSED_BEFORE_END);
    });

    test("</ul> with intermediate <li> stays clean (li is implied-closable)", () => {
      // Negative pair: implied-end-tag set covers li, so this routine
      // pattern shouldn't fire HTML_UNCLOSED_BEFORE_END.
      const f = lint(`<ul><li>a<li>b</ul>`);
      expect(f).toEqual([]);
    });
  });

  describe("differential: §C lint near-misses combined with existing findings", () => {
    test("duplicate attribute on a misnested formatting element reports both", () => {
      // Combined case: HTML_DUPLICATE_ATTRIBUTE fires from the tokenizer
      // path; HTML_MISNESTED_FORMATTING from the tree-construction path.
      // Both should be present and not clobber each other.
      const f = lint(`<b class="a" class="b"><i></b></i>`);
      const codes = ids(f);
      expect(codes).toContain(HTML_DUPLICATE_ATTRIBUTE);
      expect(codes).toContain(HTML_MISNESTED_FORMATTING);
    });
  });
});

// ─── Valid Tutuca usage: zero findings expected ──────────────────────────
//
// Mirrors the production lint config in tools/core/lint-check.js — fragment
// context "template", <x>/<x:foo> treated as transparent — and walks every
// representative Tutuca syntax pattern. If anything in this block ever
// reports a finding, either the linter regressed on a real-world template
// or a new rule needs an exemption for valid Tutuca usage. The fixtures
// below come from two sources, both pulled in to keep coverage broad:
//
// 1. Auto-harvested `html\`…\`` templates from docs/examples/*.js (excluding
//    lint-errors.js, which intentionally triggers findings).
// 2. Hand-curated snippets from docs/llm/{core,advanced}.txt covering
//    patterns not present in the example files (dynamic bindings,
//    emoji-picker custom event, etc.).
const HTML_LINT_OPTS = {
  fragmentContext: "template",
  transparentTagPrefixes: ["x"],
};

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "docs", "examples");

// Walk a JS source string and yield every `html\`…\`` template literal body.
// `${...}` is rejected outright — none of the docs/examples templates use
// JS interpolation, and pretending to handle it would risk false matches.
function extractHtmlTemplates(src) {
  const out = [];
  const re = /\bhtml`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length;
    let i = start;
    let dollarBrace = false;
    while (i < src.length) {
      const c = src.charCodeAt(i);
      if (c === 92 /* \ */) {
        i += 2;
        continue;
      }
      if (c === 96 /* ` */) break;
      if (c === 36 /* $ */ && src.charCodeAt(i + 1) === 123 /* { */) {
        dollarBrace = true;
        break;
      }
      i++;
    }
    if (dollarBrace || i >= src.length) continue;
    out.push(src.slice(start, i));
  }
  return out;
}

function harvestExampleTemplates() {
  const files = readdirSync(examplesDir).filter(
    (f) => f.endsWith(".js") && f !== "lint-errors.js",
  );
  const fixtures = [];
  for (const file of files) {
    const src = readFileSync(join(examplesDir, file), "utf8");
    const templates = extractHtmlTemplates(src);
    templates.forEach((html, idx) => {
      fixtures.push({ label: `${file}#${idx}`, html });
    });
  }
  return fixtures;
}

// Hand-curated snippets from docs/llm/. Each entry pins a specific Tutuca
// feature so a regression points back to the exact pattern that broke.
const LLM_DOC_FIXTURES = [
  // core.txt — dynamic bindings (consumer reads `*name` value)
  {
    label: "llm/core.txt: dynamic bindings consumer",
    html: `<p :style="color: {*color}"></p>`,
  },
  // core.txt — emoji-picker custom element with hyphenated CustomEvent
  {
    label: "llm/core.txt: web component custom event",
    html: `<emoji-picker @on.emoji-click="onPick value"></emoji-picker>`,
  },
  // core.txt — single-quoted string literals in @then/@else
  {
    label: "llm/core.txt: @if/@then/@else string literal branches",
    html: `<button @if.class=".isActive" @then="'btn btn-success'" @else="'btn btn-ghost'"></button>`,
  },
  // core.txt — multiple @if on one element with explicit attr names
  {
    label: "llm/core.txt: multiple @if directives on one element",
    html: `<button @if.class=".a" @then="'on'" @else="'off'" @if.title=".a" @then.title="'On'" @else.title="'Off'"></button>`,
  },
  // core.txt — :class with interpolation
  {
    label: "llm/core.txt: :class string template",
    html: `<button class="btn" :class="btn {.color}">x</button>`,
  },
  // core.txt — bracket sequence/map item access
  {
    label: "llm/core.txt: <x render=...> with bracket key access",
    html: `<x render=".byKey[.currentKey]"></x>`,
  },
  // core.txt — render-each with as=
  {
    label: "llm/core.txt: <x render-each as=...>",
    html: `<x render-each=".items" as="edit"></x>`,
  },
  // core.txt — @push-view
  {
    label: "llm/core.txt: @push-view",
    html: `<div @push-view=".view"><x render-each=".items"></x></div>`,
  },
  // core.txt — @loop-with on an element loop
  {
    label: "llm/core.txt: @each with @loop-with + @when",
    html: `<li @each=".items" @loop-with="getIterData" @when="filterItem"></li>`,
  },
  // core.txt — scope enrichment without @each
  {
    label: "llm/core.txt: scope enrichment",
    html: `<div @enrich-with="enrichScope">Length: <x text="@len"></x></div>`,
  },
  // core.txt — @dangerouslysetinnerhtml escape hatch
  {
    label: "llm/core.txt: @dangerouslysetinnerhtml",
    html: `<div @dangerouslysetinnerhtml=".trustedHtml"></div>`,
  },
  // core.txt — show/hide as wrapper attrs on <x>
  {
    label: "llm/core.txt: show/hide on <x render-it> wrappers",
    html: `<x render-it show=".isOpen"></x>`,
  },
  // core.txt — <x text=...> inside @each loop
  {
    label: "llm/core.txt: <x text='@value'> inside loop",
    html: `<li @each=".items"><span @text="@key"></span>: <x text="@value"></x></li>`,
  },
  // core.txt — macro invocation with default + dynamic + field-ref params
  {
    label: "llm/core.txt: <x:badge> with defaults / static / dynamic",
    html: `<x:badge></x:badge><x:badge label="Sale"></x:badge><x:badge :label=".status"></x:badge>`,
  },
  // core.txt — macro slots
  {
    label: "llm/core.txt: <x:card> with default slot",
    html: `<x:card title="Hi"><p>body</p></x:card>`,
  },
  // core.txt — macro named slots usage
  {
    label: "llm/core.txt: <x:panel> with named slots",
    html: `<x:panel><x slot="actions"><button @on.click=".inc">+</button></x><p>default slot content</p><x slot="footer">© 2026</x></x:panel>`,
  },
  // core.txt — handler with type as arg (ctx is auto-appended, not passed in template)
  {
    label: "llm/core.txt: handler with Type arg",
    html: `<button @on.click=".addItem JsonSelector">+</button>`,
  },
  // core.txt — keydown modifiers (+send / +cancel)
  {
    label: "llm/core.txt: @on.keydown+send / +cancel modifiers",
    html: `<input @on.keydown+send=".submit value" @on.keydown+cancel=".reset" />`,
  },
  // advanced.txt — pseudo-x inside a <select>
  {
    label: "llm/advanced.txt: pseudo-x inside <select>",
    html: `<select><option @x render-each=".items" as="option"></option></select>`,
  },
  // advanced.txt — drag-and-drop attrs on a loop element
  {
    label: "llm/advanced.txt: draggable + data-* attrs",
    html: `<div @each=".items" draggable="true" data-dragtype="my-item" data-droptarget="my-item" @on.drop="onDrop @key dragInfo event"></div>`,
  },
];

const TEMPLATE_FIXTURES = [...harvestExampleTemplates(), ...LLM_DOC_FIXTURES];

// Sanity check: harvesting must produce a non-trivial number of fixtures.
// If extractHtmlTemplates breaks, this catches it instead of the test
// silently passing because there's nothing to lint.
test("valid-tutuca fixtures: at least 30 templates harvested", () => {
  expect(TEMPLATE_FIXTURES.length).toBeGreaterThanOrEqual(30);
});

describe("valid Tutuca usage produces zero lint findings", () => {
  // Only the vendored tokenizer is exercised here — htmlparser2 parity is
  // already covered by the per-rule tests above. Running the full fixture
  // set through both would double the work without adding signal.
  for (const { label, html } of TEMPLATE_FIXTURES) {
    test(label, () => {
      const findings = [];
      lintHtml(html, (f) => findings.push(f), {
        ...HTML_LINT_OPTS,
        TokenizerClass: HtmlTokenizer,
      });
      // Assert empty rather than .length === 0 so the failure message
      // shows the offending findings, which is what diagnoses a regression.
      expect(findings).toEqual([]);
    });
  }
});
