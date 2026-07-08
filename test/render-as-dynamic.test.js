// `as=` accepts dynamic values (like `@push-view`): a `.field` / `*dyn` / etc.
// is evaluated against the host (enclosing) stack at render time to pick the
// view for that one render site. A bare literal (`as="edit"`) still works, and
// an evaluated name with no matching view falls back to `main`. `render-each`
// is sugar for `@each` + `<x render-it>`, so its `as=` is evaluated per item
// inside the iteration scope — each item can select its own view from its own
// fields.
import { describe, expect, test } from "bun:test";
import { component, html } from "../index.js";
import { Components } from "../src/components.js";
import { Renderer } from "../src/renderer.js";
import { Stack } from "../src/stack.js";
import { VComment, VFragment, VNode, VText } from "../src/vdom.js";
import { HeadlessParseContext } from "./dom.js";

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

// A child with a `main` and an `edit` view, each emitting a distinct marker.
function makeChild(comps, name) {
  return registered(
    comps,
    component({
      name,
      fields: {},
      view: html`<span>marker-main</span>`,
      views: { edit: html`<span>marker-edit</span>` },
    }),
  );
}

describe("dynamic as= view selection", () => {
  test('literal as="edit" still selects the edit view (regression)', () => {
    const comps = new Components();
    const Child = makeChild(comps, "ChildLit");
    const Host = registered(
      comps,
      component({
        name: "HostLit",
        fields: { child: null },
        view: html`<div><x render=".child" as="edit"></x></div>`,
      }),
    );
    const rx = new Renderer(comps);
    const host = Host.make({ child: Child.make({}) });
    const out = textOf(rx.renderRoot(Stack.root(comps, host), host));
    expect(out).toContain("marker-edit");
    expect(out).not.toContain("marker-main");
  });

  test('as=".mode" picks the view from a parent field at render time', () => {
    const comps = new Components();
    const Child = makeChild(comps, "ChildDyn");
    const Host = registered(
      comps,
      component({
        name: "HostDyn",
        fields: { mode: "main", child: null },
        view: html`<div><x render=".child" as=".mode"></x></div>`,
      }),
    );
    const rx = new Renderer(comps);
    const child = Child.make({}); // shared across both renders => one cache
    const hEdit = Host.make({ mode: "edit", child });
    const hMain = Host.make({ mode: "main", child });

    const outEdit = textOf(rx.renderRoot(Stack.root(comps, hEdit), hEdit));
    const outMain = textOf(rx.renderRoot(Stack.root(comps, hMain), hMain));

    expect(outEdit).toContain("marker-edit");
    expect(outMain).toContain("marker-main");
    expect(outMain).not.toContain("marker-edit");
  });

  test("an evaluated name with no matching view falls back to main", () => {
    const comps = new Components();
    const Child = makeChild(comps, "ChildFallback");
    const Host = registered(
      comps,
      component({
        name: "HostFallback",
        fields: { mode: "doesNotExist", child: null },
        view: html`<div><x render=".child" as=".mode"></x></div>`,
      }),
    );
    const rx = new Renderer(comps);
    const host = Host.make({ child: Child.make({}) });
    const out = textOf(rx.renderRoot(Stack.root(comps, host), host));
    expect(out).toContain("marker-main");
    expect(out).not.toContain("marker-edit");
  });

  test("render-each as= is evaluated per item against the item's own field", () => {
    const comps = new Components();
    // Item carries its own `mode` field, since render-each's `as=` now resolves
    // inside the iteration scope (render-each === @each + <x render-it>).
    const Item = registered(
      comps,
      component({
        name: "ItemEach",
        fields: { mode: "main" },
        view: html`<span>marker-main</span>`,
        views: { edit: html`<span>marker-edit</span>` },
      }),
    );
    const List = registered(
      comps,
      component({
        name: "ListEach",
        fields: { items: [] },
        view: html`<div><x render-each=".items" as=".mode"></x></div>`,
      }),
    );
    const rx = new Renderer(comps);
    const list = List.make({ items: [Item.make({ mode: "edit" }), Item.make({ mode: "main" })] });

    const out = textOf(rx.renderRoot(Stack.root(comps, list), list));

    // each item picks its own view from its own `mode` field
    expect(out.match(/marker-edit/g)?.length).toBe(1);
    expect(out.match(/marker-main/g)?.length).toBe(1);
  });

  test("absent as= still resolves via lookupBestView (main)", () => {
    const comps = new Components();
    const Child = makeChild(comps, "ChildNoAs");
    const Host = registered(
      comps,
      component({
        name: "HostNoAs",
        fields: { child: null },
        view: html`<div><x render=".child"></x></div>`,
      }),
    );
    const rx = new Renderer(comps);
    const host = Host.make({ child: Child.make({}) });
    const out = textOf(rx.renderRoot(Stack.root(comps, host), host));
    expect(out).toContain("marker-main");
    expect(out).not.toContain("marker-edit");
  });
});
