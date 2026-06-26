import { describe, expect, test } from "bun:test";
import { component, html, IMap } from "../index.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";

const document = setupJsdom();

// `@each` over a sequence of plain values (no component instances) renders each
// item through the DOM cache, keyed on the value itself. The cache uses a
// WeakMap, which can only hold objects/functions — primitives are uncacheable
// but must degrade gracefully (render fresh, no crash). `null` is the tricky
// one: `typeof null === "object"`, so it used to slip past the primitive guard
// and crash `WeakMap.set(null, …)` with "Invalid value used as weak map key".
describe("@each over primitive values (DOM cache enabled)", () => {
  const List = component({
    name: "List",
    fields: { items: [] },
    view: html`<ul><li @each=".items"><x render-it></x></li></ul>`,
  });
  // A trivial component so each item has *something* to render-it into; the
  // crash is independent of this and happens before item rendering.
  const Leaf = component({ name: "Leaf", fields: {} });

  const renderItems = (items) => {
    const root = List.make({ items });
    // noCache:false -> real WeakMapDomCache, the configuration the bug needs.
    const { container, cleanup } = renderToHTMLNode(
      document,
      [List, Leaf],
      null,
      root,
      HeadlessParseContext,
      { noCache: false },
    );
    const count = container.querySelectorAll("li").length;
    cleanup();
    return count;
  };

  for (const [label, items] of [
    ["[null]", [null]],
    ["[null, 'X']", [null, "X"]],
    ["['A', null, 'B']", ["A", null, "B"]],
    ["all strings", ["A", "B"]],
    ["all numbers", [1, 2, 3]],
    ["[undefined, 'X']", [undefined, "X"]],
    ["[true, false]", [true, false]],
  ]) {
    test(`${label} renders without crashing`, () => {
      expect(() => renderItems(items)).not.toThrow();
      expect(renderItems(items)).toBe(items.length);
    });
  }

  // A keyed map whose *values* are null (e.g. `{ a: null }`) goes through the
  // same cache path with the value as the weak key; it must not crash either.
  test("keyed map with null values renders without crashing", () => {
    const Keyed = component({
      name: "Keyed",
      fields: { items: IMap() },
      view: html`<ul><li @each="*items">@key</li></ul>`,
    });
    const root = Keyed.make({ items: IMap({ a: null, b: 1 }) });
    expect(() => {
      const { cleanup } = renderToHTMLNode(document, [Keyed], null, root, HeadlessParseContext, {
        noCache: false,
      });
      cleanup();
    }).not.toThrow();
  });
});
