// Regression tests for the render-cache key dropping the effective view
// context. A cached subtree must be reused only when BOTH the explicit per-site
// view selector (`as=`) AND the inherited `@push-view` ancestor stack match —
// otherwise a value-identical child rendered under a different effective
// ancestor view is served stale (descendants never see the view change).
import { describe, expect, test } from "vitest";
import { component, html } from "../index.js";
import { Components } from "../src/components.js";
import { Renderer } from "../src/renderer.js";
import { Stack } from "../src/stack.js";
import { VComment, VFragment, VNode, VText } from "../src/vdom.js";
import { HeadlessParseContext } from "./dom.js";

// Flatten a rendered VDOM tree to a single string of its text content so we can
// assert which view's marker text the descendants ended up rendering.
function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (node instanceof VText) return node.text;
  if (node instanceof VComment) return "";
  if (node instanceof VFragment) return node.childs.map(textOf).join("");
  if (node instanceof VNode) return node.childs.map(textOf).join("");
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

function registered(comps, comp) {
  comp.compile(HeadlessParseContext);
  comps.registerComponent(comp);
  return comp;
}

describe("render cache keys on the full effective view context", () => {
  test("@push-view + as= toggle reaches descendants (component path)", () => {
    const comps = new Components();
    // Inner resolves its own view from the inherited pushed-view stack: under
    // `@push-view="edit"` it renders the `edit` marker, otherwise `main`.
    const Inner = registered(
      comps,
      component({
        name: "Inner",
        fields: {},
        view: html`<span>mode-main</span>`,
        views: { edit: html`<span>mode-edit</span>` },
      }),
    );
    // Outer.compact renders Inner with NO `as=`, so Inner inherits whatever view
    // the ancestor pushed.
    const Outer = registered(
      comps,
      component({
        name: "Outer",
        fields: { inner: null },
        view: html`<div>outer-main</div>`,
        views: { compact: html`<div><x render=".inner"></x></div>` },
      }),
    );
    // Wrapper pushes a view chosen at runtime, then renders Outer as="compact".
    const Wrapper = registered(
      comps,
      component({
        name: "Wrapper",
        fields: { mode: "main", outer: null },
        view: html`<div @push-view=".mode"><x render=".outer" as="compact"></x></div>`,
      }),
    );

    // ONE renderer => ONE shared cache across both renders (the crux).
    const rx = new Renderer(comps);
    const inner = Inner.make({});
    const outer = Outer.make({ inner }); // shared, ===-identical across renders
    const wEdit = Wrapper.make({ mode: "edit", outer });
    const wMain = Wrapper.make({ mode: "main", outer });

    const outEdit = textOf(rx.renderRoot(Stack.root(comps, wEdit), wEdit));
    const outMain = textOf(rx.renderRoot(Stack.root(comps, wMain), wMain));

    expect(outEdit).toContain("mode-edit");
    // Buggy cache returns the cached `compact` subtree (still mode-edit) here:
    expect(outMain).toContain("mode-main");
    expect(outMain).not.toContain("mode-edit");
  });

  test("@push-view reaches @each subtree descendants (renderEachWhen path)", () => {
    const comps = new Components();
    const Item = registered(
      comps,
      component({
        name: "Item",
        fields: {},
        view: html`<span>item-main</span>`,
        views: { edit: html`<span>item-edit</span>` },
      }),
    );
    // The @each repeats a plain element whose subtree renders Item with no
    // `as=`; the element subtree is cached by renderEachWhen.
    const List = registered(
      comps,
      component({
        name: "List",
        fields: { mode: "main", items: [] },
        view: html`<div @push-view=".mode"><div @each=".items"><x render-it></x></div></div>`,
      }),
    );

    const rx = new Renderer(comps);
    const items = [Item.make({})]; // shared item instances across both renders
    const lEdit = List.make({ mode: "edit", items });
    const lMain = List.make({ mode: "main", items });

    const outEdit = textOf(rx.renderRoot(Stack.root(comps, lEdit), lEdit));
    const outMain = textOf(rx.renderRoot(Stack.root(comps, lMain), lMain));

    expect(outEdit).toContain("item-edit");
    expect(outMain).toContain("item-main");
    expect(outMain).not.toContain("item-edit");
  });
});
