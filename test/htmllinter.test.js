import { describe, expect, test } from "bun:test";
import {
  HTML_DUPLICATE_FORM,
  HTML_MISNESTED_FORMATTING,
  HTML_NESTED_INTERACTIVE,
  HTML_SVG_TAG_WILL_LOWERCASE,
  HTML_TAG_NAME_HAS_UPPERCASE,
  HTML_TAG_NOT_ALLOWED_IN_PARENT,
  HTML_TEXT_NOT_ALLOWED_IN_PARENT,
  HTML_VOID_ELEMENT_HAS_CLOSE_TAG,
  lintHtml,
} from "../tools/core/htmllinter.js";

function lint(html, opts) {
  const findings = [];
  lintHtml(html, (f) => findings.push(f), opts);
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
