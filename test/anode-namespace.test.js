import { describe, expect, test } from "vitest";
import { component, html, macro } from "../index.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
const HTML_NS = "http://www.w3.org/1999/xhtml";

function renderState(document, components, state, macros = null) {
  const { container, cleanup } = renderToHTMLNode(
    document,
    components,
    macros,
    state,
    HeadlessParseContext,
  );
  return { container, cleanup };
}

describe("SVG namespace from templates", () => {
  const document = setupJsdom();

  test("svg element and descendants get the SVG namespace", () => {
    const Comp = component({
      name: "SvgComp",
      fields: {},
      view: html`<div>
        <svg viewBox="0 0 10 10"><rect x="1" y="1"></rect><circle></circle></svg>
      </div>`,
    });
    const { container, cleanup } = renderState(document, [Comp], Comp.make());
    const div = container.querySelector("div");
    const svg = container.querySelector("svg");
    const rect = container.querySelector("rect");
    expect(div.namespaceURI).toBe(HTML_NS);
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(rect.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector("circle").namespaceURI).toBe(SVG_NS);
    cleanup();
  });

  test("camelCase SVG tag and attribute names survive", () => {
    const Comp = component({
      name: "GradientComp",
      fields: {},
      view: html`<svg viewBox="0 0 10 10">
        <defs>
          <linearGradient id="g"><stop offset="0%"></stop></linearGradient>
        </defs>
      </svg>`,
    });
    const { container, cleanup } = renderState(document, [Comp], Comp.make());
    const grad = container.querySelector("linearGradient");
    expect(grad).not.toBe(null);
    expect(grad.namespaceURI).toBe(SVG_NS);
    expect(container.querySelector("svg").getAttribute("viewBox")).toBe("0 0 10 10");
    cleanup();
  });

  test("dynamic attribute binding renders as an attribute on an SVG node", () => {
    const Comp = component({
      name: "BarComp",
      fields: { h: 20 },
      view: html`<svg viewBox="0 0 10 100">
        <rect x="0" :height=".h" width="10"></rect>
      </svg>`,
    });
    const tall = renderState(document, [Comp], Comp.make({ h: 80 }));
    expect(tall.container.querySelector("rect").getAttribute("height")).toBe("80");
    tall.cleanup();
    const short = renderState(document, [Comp], Comp.make({ h: 5 }));
    expect(short.container.querySelector("rect").getAttribute("height")).toBe("5");
    short.cleanup();
  });
});

describe("macro calls inside the SVG namespace", () => {
  const document = setupJsdom();

  // The HTML parser lowercases tag names inside SVG/MathML foreign content, so
  // a `<x:bar>` macro call arrives as `x:bar` (not the `X:BAR` it would be in an
  // HTML context). The macro dispatch must recognize the lowercase prefix or the
  // call is dropped as `<!--Error: InvalidTagName x:bar-->`.
  const macros = {
    bar: macro({}, html`<rect x="1" y="1"></rect>`),
    group: macro({}, html`<g><circle></circle></g>`),
  };

  test("a macro call inside <svg> is expanded, not dropped (lowercase x:)", () => {
    const Comp = component({
      name: "SvgMacroComp",
      fields: {},
      view: html`<svg viewBox="0 0 10 10"><x:bar></x:bar></svg>`,
    });
    const { container, cleanup } = renderState(document, [Comp], Comp.make(), macros);
    expect(container.innerHTML).not.toContain("InvalidTagName");
    expect(container.querySelector("rect")).not.toBe(null);
    cleanup();
  });

  test("a macro call inside <svg> works when authored uppercase (X:)", () => {
    const Comp = component({
      name: "SvgMacroUpperComp",
      fields: {},
      view: html`<svg viewBox="0 0 10 10"><X:bar></X:bar></svg>`,
    });
    const { container, cleanup } = renderState(document, [Comp], Comp.make(), macros);
    expect(container.innerHTML).not.toContain("InvalidTagName");
    expect(container.querySelector("rect")).not.toBe(null);
    cleanup();
  });

  test("expanded macro children inherit the SVG namespace at render", () => {
    const Comp = component({
      name: "SvgMacroNsComp",
      fields: {},
      view: html`<svg viewBox="0 0 10 10"><x:group></x:group></svg>`,
    });
    const { container, cleanup } = renderState(document, [Comp], Comp.make(), macros);
    expect(container.querySelector("g").namespaceURI).toBe(SVG_NS);
    expect(container.querySelector("circle").namespaceURI).toBe(SVG_NS);
    cleanup();
  });
});

describe("MathML namespace from templates", () => {
  const document = setupJsdom();

  test("math element and descendants get the MathML namespace", () => {
    const Comp = component({
      name: "MathComp",
      fields: { a: 3 },
      view: html`<math>
        <mfrac><mn @text=".a"></mn><mn>2</mn></mfrac>
      </math>`,
    });
    const { container, cleanup } = renderState(document, [Comp], Comp.make({ a: 7 }));
    const math = container.querySelector("math");
    expect(math.namespaceURI).toBe(MATHML_NS);
    expect(container.querySelector("mfrac").namespaceURI).toBe(MATHML_NS);
    expect(container.querySelector("mn").namespaceURI).toBe(MATHML_NS);
    expect(container.querySelector("mn").textContent.trim()).toBe("7");
    cleanup();
  });
});
