import { describe, expect, test } from "bun:test";
import { format } from "prettier";
import { component, html, IMap } from "../index.js";
import {
  BindStep,
  DynEachStep,
  DynStep,
  EachBindStep,
  EachRenderItStep,
  FieldStep,
  Path,
  SeqAccessStep,
  SeqStep,
} from "../src/path.js";
import { renderToHTMLNode } from "../src/util/render.js";
import { HeadlessParseContext, setupJsdom } from "./dom.js";
import {
  getComponents,
  JsonArray,
  JsonBool,
  JsonNull,
  JsonNumber,
  JsonObject,
  JsonObjectKeyVal,
  JsonString,
} from "./json.js";

const document = setupJsdom();

const TARGET = "target-bool";
const SELECTOR = `[data-test-id="${TARGET}"]`;
async function formatHTML(html) {
  return await format(html, { parser: "html" });
}

const renderNode = (rootState) =>
  renderToHTMLNode(document, getComponents(), null, rootState, HeadlessParseContext);

describe("Path - find JsonBool by uid", () => {
  test("flat boolean", () => {
    const target = JsonBool.make({ uid: TARGET, value: true });
    const { container, app, cleanup } = renderNode(target);
    const node = container.querySelector(SELECTOR);
    expect(node).not.toBeNull();
    const [path, events] = Path.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    expect(path.steps.length).toBe(0);
    expect(events.length).toBe(1);
    expect(path.lookup(target)).toBe(target);
    cleanup();
  });

  test("boolean inside JsonObject with siblings", () => {
    const target = JsonBool.make({ uid: TARGET, value: true });
    const rootValue = JsonObject.make({
      uid: "obj",
      items: [
        JsonObjectKeyVal.make({
          uid: "kv-str",
          key: "name",
          value: JsonString.make({ uid: "str-1", value: "hello" }),
        }),
        JsonObjectKeyVal.make({
          uid: "kv-bool",
          key: "flag",
          value: target,
        }),
        JsonObjectKeyVal.make({
          uid: "kv-num",
          key: "count",
          value: JsonNumber.make({ uid: "num-1" }),
        }),
      ],
    });
    const { container, app, cleanup } = renderNode(rootValue);
    const node = container.querySelector(SELECTOR);
    expect(node).not.toBeNull();
    const [path, events] = Path.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    console.log(path.steps);
    expect(path.steps.length).toBe(2);
    expect(events.length).toBe(1);
    expect(path.lookup(rootValue)).toBe(target);
    cleanup();
  });

  test("boolean inside array inside object with siblings", async () => {
    const target = JsonBool.make({ uid: TARGET, value: true });
    const rootValue = JsonObject.make({
      uid: "obj",
      items: [
        JsonObjectKeyVal.make({
          uid: "kv-arr",
          key: "mixed",
          value: JsonArray.make({
            uid: "arr",
            items: [
              JsonNull.make({ uid: "null-1" }),
              target,
              JsonString.make({ uid: "str-2", value: "world" }),
            ],
          }),
        }),
        JsonObjectKeyVal.make({
          uid: "kv-num",
          key: "sibling",
          value: JsonNumber.make({ uid: "num-2" }),
        }),
      ],
    });
    const { container, app, cleanup } = renderNode(rootValue);
    const node = container.querySelector(SELECTOR);
    expect(node).not.toBeNull();
    const [path, events] = Path.fromNodeAndEventName(node, "click", container, Infinity, app.comps);
    console.log(await formatHTML(container.innerHTML));
    console.log(path.steps);
    expect(path.steps.length).toBe(3);
    expect(events.length).toBe(1);
    expect(path.lookup(rootValue)).toBe(target);
    cleanup();
  });
});

describe("Path.compact", () => {
  test("drops BindStep and EachBindStep, preserves lookup and setValue", () => {
    const root = IMap({ a: IMap({ b: 42 }) });
    const original = new Path([
      new BindStep({}),
      new FieldStep("a"),
      new EachBindStep(null, "k"),
      new FieldStep("b"),
    ]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(2);
    expect(compact.steps[0]).toBeInstanceOf(FieldStep);
    expect(compact.steps[1]).toBeInstanceOf(FieldStep);

    expect(original.lookup(root)).toBe(42);
    expect(compact.lookup(root)).toBe(42);

    const updated = original.setValue(root, 100);
    const updatedCompact = compact.setValue(root, 100);
    expect(updated.get("a").get("b")).toBe(100);
    expect(updatedCompact.get("a").get("b")).toBe(100);
  });

  test("path of only frame-only steps compacts to empty path", () => {
    const root = IMap({ x: 1 });
    const original = new Path([new BindStep({}), new EachBindStep(null, "k")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(0);
    expect(original.lookup(root)).toBe(root);
    expect(compact.lookup(root)).toBe(root);
  });

  test("abstracts EachRenderItStep to a SeqStep, preserving lookup/setValue", () => {
    const root = IMap({ items: IMap({ k: IMap({ v: 7 }) }) });
    const original = new Path([new EachRenderItStep("items", "k"), new FieldStep("v")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(2);
    expect(compact.steps[0]).toBeInstanceOf(SeqStep);
    expect(compact.steps[0]).not.toBeInstanceOf(EachRenderItStep);
    expect(compact.steps[0].field).toBe("items");
    expect(compact.steps[0].key).toBe("k");

    expect(original.lookup(root)).toBe(7);
    expect(compact.lookup(root)).toBe(7);

    const updated = original.setValue(root, 99);
    const updatedCompact = compact.setValue(root, 99);
    expect(updated.get("items").get("k").get("v")).toBe(99);
    expect(updatedCompact.get("items").get("k").get("v")).toBe(99);
  });

  test("preserves SeqStep (traverses through field+key)", () => {
    const root = IMap({ items: IMap({ k: IMap({ v: 7 }) }) });
    const original = new Path([new BindStep({}), new SeqStep("items", "k"), new FieldStep("v")]);
    const compact = original.compact();

    expect(compact.steps.length).toBe(2);
    expect(original.lookup(root)).toBe(7);
    expect(compact.lookup(root)).toBe(7);
  });
});

describe("@value inside @each click handler", () => {
  test("button beside <x render-it> with @value arg — list", () => {
    let received = "<not-called>";
    const Item = component({ name: "Item", fields: { uid: "" } });
    const List = component({
      name: "List",
      fields: { items: [] },
      input: {
        noteClicked(item) {
          received = item;
          return this;
        },
      },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click="noteClicked @value">x</button>
        </div>
      </div>`,
    });
    const root = List.make({ items: [Item.make({ uid: "a" }), Item.make({ uid: "b" })] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List, Item],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(received).not.toBe("<not-called>");
    expect(received?.uid).toBe("b");
    cleanup();
  });

  test("remove-item handler in @each updates root state (todo regression)", () => {
    const Item = component({ name: "Item", fields: { uid: "" } });
    const List = component({
      name: "List",
      fields: { items: [] },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click="$removeInItemsAt @key">x</button>
        </div>
      </div>`,
    });
    const root = List.make({ items: [Item.make({ uid: "a" }), Item.make({ uid: "b" })] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List, Item],
      null,
      root,
      HeadlessParseContext,
    );
    expect(app.state.val.items.size).toBe(2);
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.items.size).toBe(1);
    expect(app.state.val.items.get(0).uid).toBe("a");
    cleanup();
  });

  test("frame boundary: @key/@value bound by @each are NOT visible inside a render-it child", () => {
    let receivedKey = "<not-set>";
    let receivedValue = "<not-set>";
    const Item = component({
      name: "Item",
      fields: { uid: "" },
      input: {
        // Handler is on Item (the rendered child). It tries to read @key/@value
        // which the surrounding @each scope binds. The render-it pushes a frame
        // between that scope and the child view, so the lookup must STOP at the
        // frame and return null — NOT walk through to the iteration's binds.
        recordIt(k, v) {
          receivedKey = k;
          receivedValue = v;
          return this;
        },
      },
      view: html`<button :data-uid=".uid" @on.click="recordIt @key @value">x</button>`,
    });
    const List = component({
      name: "List",
      fields: { items: [] },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
        </div>
      </div>`,
    });
    const root = List.make({ items: [Item.make({ uid: "a" }), Item.make({ uid: "b" })] });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [List, Item],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    // Frame boundary held: lookup hit the empty frame pushed by RenderItNode and
    // returned null instead of falling through to the iteration scope below it.
    expect(receivedKey).toBeNull();
    expect(receivedValue).toBeNull();
    cleanup();
  });

  test("button beside <x render-it> with @key + @value args — map", () => {
    let receivedKey = null;
    let receivedValue = null;
    const Item = component({ name: "Item", fields: { uid: "" } });
    const Bag = component({
      name: "Bag",
      fields: { items: IMap() },
      input: {
        noteClicked(k, v) {
          receivedKey = k;
          receivedValue = v;
          return this;
        },
      },
      view: html`<div>
        <div @each=".items">
          <x render-it></x>
          <button :data-uid=".uid" @on.click="noteClicked @key @value">x</button>
        </div>
      </div>`,
    });
    const root = Bag.make({
      items: IMap({ alpha: Item.make({ uid: "alpha" }), beta: Item.make({ uid: "beta" }) }),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Bag, Item],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector('[data-uid="beta"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();

    expect(receivedKey).toBe("beta");
    expect(receivedValue?.uid).toBe("beta");
    cleanup();
  });
});

describe("@on.drop bubbles to ancestor components", () => {
  function makeApp() {
    const captured = { type: "<not-called>", self: null };
    const Child = component({
      name: "Child",
      fields: { uid: "" },
      view: html`<div :data-uid=".uid"><span class="inner">drop here</span></div>`,
    });
    const Parent = component({
      name: "Parent",
      fields: { child: Child.make({ uid: "c1" }) },
      input: {
        onDrop(e) {
          captured.type = e.type;
          captured.self = this;
          return this;
        },
      },
      view: html`<section @on.drop="onDrop event" data-droptarget="x">
        <x render=".child"></x>
      </section>`,
    });
    const ctx = renderToHTMLNode(
      document,
      [Parent, Child],
      null,
      Parent.make(),
      HeadlessParseContext,
    );
    return { ...ctx, captured };
  }

  test("Path.fromNodeAndEventName finds the ancestor @on.drop and resolves to its value", () => {
    const { container, app, cleanup } = makeApp();
    const inner = container.querySelector(".inner");
    expect(inner).not.toBeNull();
    const [path, handlers] = Path.fromNodeAndEventName(
      inner,
      "drop",
      container,
      Infinity,
      app.comps,
    );
    expect(handlers).not.toBeNull();
    expect(handlers.length).toBe(1);
    // Parent is the app root, so the path is empty and resolves to the Parent value.
    expect(path.steps.length).toBe(0);
    expect(path.lookup(app.state.val)).toBe(app.state.val);
    cleanup();
  });

  test("non-bubbling event (click) still bails at the leaf component", () => {
    const { container, app, cleanup } = makeApp();
    const inner = container.querySelector(".inner");
    const [path, handlers] = Path.fromNodeAndEventName(
      inner,
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(path).toBeNull();
    expect(handlers).toBeNull();
    cleanup();
  });

  test("dispatching a drop event inside a nested component invokes the ancestor handler", () => {
    const { container, app, captured, cleanup } = makeApp();
    const inner = container.querySelector(".inner");
    const Event = container.ownerDocument.defaultView.Event;
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(ev.defaultPrevented).toBe(true);
    expect(captured.type).toBe("drop");
    expect(captured.self).toBe(app.state.val);
    cleanup();
  });
});

describe("dragInfo.lookupBind for @each items", () => {
  // A drag that starts inside an `@each` must keep the row's frame-only binds
  // (`key`/`value`) reachable from the drop handler — `compact()` strips them
  // from the dispatch path, so the DragInfo stack is built from a path that
  // retains them.
  test("drop handler resolves the source row's key bind", () => {
    let sourceKey = "<not-called>";
    const Reorder = component({
      name: "Reorder",
      fields: { items: ["a", "b", "c"] },
      input: {
        onDropOnItem(_targetKey, dragInfo) {
          sourceKey = dragInfo.lookupBind("key");
          return this;
        },
      },
      view: html`<div>
        <div
          class="row"
          @each=".items"
          draggable="true"
          data-dragtype="x"
          data-droptarget="x"
          @on.drop="onDropOnItem @key dragInfo"
        >
          <x text="@value"></x>
        </div>
      </div>`,
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Reorder],
      null,
      Reorder.make(),
      HeadlessParseContext,
    );
    const rows = container.querySelectorAll(".row");
    const Event = container.ownerDocument.defaultView.Event;
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    rows[1].dispatchEvent(dragStart);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    rows[2].dispatchEvent(drop);
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(sourceKey).toBe(1);
    cleanup();
  });
});

describe("dynamic variable as a path segment", () => {
  // Workspace (producer of *active = .sheet) -> Panel -> Toolbar (consumer that
  // does `<x render="*active">`) -> Sheet. The Sheet's data physically lives at
  // Workspace.sheet, NOT under Toolbar.
  function workspaceApp() {
    const Sheet = component({
      name: "Sheet",
      fields: { title: "untitled" },
      input: {
        rename() {
          return this.setTitle("renamed");
        },
      },
      view: html`<div class="sheet">
        <button class="rename" @on.click="rename">x</button>
      </div>`,
    });
    const Toolbar = component({
      name: "Toolbar",
      fields: {},
      lookup: { active: { for: "Workspace.active", default: ".missing" } },
      view: html`<div class="toolbar"><x render="*active"></x></div>`,
    });
    const Panel = component({
      name: "Panel",
      fields: { toolbar: null },
      view: html`<div class="panel"><x render=".toolbar"></x></div>`,
    });
    const Workspace = component({
      name: "Workspace",
      fields: { sheet: null, panel: null },
      provide: { active: ".sheet" },
      view: html`<div class="workspace"><x render=".panel"></x></div>`,
    });
    const root = Workspace.make({
      sheet: Sheet.make({ title: "untitled" }),
      panel: Panel.make({ toolbar: Toolbar.make() }),
    });
    return renderToHTMLNode(
      document,
      [Workspace, Panel, Toolbar, Sheet],
      null,
      root,
      HeadlessParseContext,
    );
  }

  test("<x render='*dyn'> renders and reconstructs an expanded path", () => {
    const { container, app, cleanup } = workspaceApp();
    const button = container.querySelector(".rename");
    expect(button).not.toBeNull();
    const [path] = Path.fromNodeAndEventName(button, "click", container, Infinity, app.comps);
    // dispatch path keeps a step per crossed component (.panel, .toolbar, DynStep)
    expect(path.steps.length).toBe(3);
    expect(path.steps[2]).toBeInstanceOf(DynStep);
    cleanup();
  });

  test("transaction path teleports past intermediate components to the producer", () => {
    const { container, app, cleanup } = workspaceApp();
    const button = container.querySelector(".rename");
    const [path] = Path.fromNodeAndEventName(button, "click", container, Infinity, app.comps);
    const txn = path.toTransactionPath();
    // Workspace -> .sheet : intermediate Panel/Toolbar steps skipped.
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(FieldStep);
    expect(txn.steps[0].field).toBe("sheet");
    expect(txn.lookup(app.state.val)).toBe(app.state.val.sheet);
    cleanup();
  });

  test("clicking inside a dynamically-rendered component mutates the producer's data", () => {
    const { container, app, cleanup } = workspaceApp();
    expect(app.state.val.sheet.title).toBe("untitled");
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.sheet.title).toBe("renamed");
    cleanup();
  });

  test("producer is also the consumer (own provide): interiorCids is just itself", () => {
    const Doc = component({
      name: "Doc",
      fields: { title: "untitled" },
      input: {
        rename() {
          return this.setTitle("renamed");
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });
    const Solo = component({
      name: "Solo",
      fields: { doc: null },
      provide: { d: ".doc" },
      view: html`<div class="solo"><x render="*d"></x></div>`,
    });
    const root = Solo.make({ doc: Doc.make() });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Solo, Doc],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = Path.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0].field).toBe("doc");
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.doc.title).toBe("renamed");
    cleanup();
  });

  test("@each='*dyn' with <x render-it> teleports the iterated item to the producer", () => {
    const Row = component({
      name: "Row",
      fields: { label: "" },
      input: {
        bump() {
          return this.setLabel(`${this.label}!`);
        },
      },
      view: html`<button class="row" :data-row=".label" @on.click="bump">r</button>`,
    });
    const Inner = component({
      name: "Inner",
      fields: {},
      lookup: { rows: { for: "Grid.rows", default: ".missing" } },
      view: html`<div class="inner">
        <div @each="*rows"><x render-it></x></div>
      </div>`,
    });
    const Grid = component({
      name: "Grid",
      fields: { rows: IMap(), inner: null },
      provide: { rows: ".rows" },
      view: html`<div class="grid"><x render=".inner"></x></div>`,
    });
    const root = Grid.make({
      rows: IMap({ a: Row.make({ label: "a" }), b: Row.make({ label: "b" }) }),
      inner: Inner.make(),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Grid, Inner, Row],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = Path.fromNodeAndEventName(
      container.querySelector('[data-row="b"]'),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(SeqStep);
    expect(txn.steps[0].field).toBe("rows");
    expect(txn.steps[0].key).toBe("b");
    container.querySelector('[data-row="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.rows.get("b").label).toBe("b!");
    expect(app.state.val.rows.get("a").label).toBe("a");
    cleanup();
  });

  test("toTransactionPath: DynStep rewinds by interiorCids and splices producer steps", () => {
    const panel = new FieldStep("panel");
    panel._originCid = 1; // producer (Workspace)
    const toolbar = new FieldStep("toolbar");
    toolbar._originCid = 2; // intermediate (Panel)
    const dyn = new DynStep(1, [new FieldStep("sheet")]);
    dyn.interiorCids = new Set([1, 2, 3]); // producer + intermediates + consumer
    const txn = new Path([panel, toolbar, dyn]).toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(FieldStep);
    expect(txn.steps[0].field).toBe("sheet");
  });

  test("toTransactionPath: DynEachStep splices a keyed SeqStep", () => {
    const dyn = new DynEachStep(1, [new FieldStep("rows")], "b");
    dyn.interiorCids = new Set([1]);
    const txn = new Path([dyn]).toTransactionPath();
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0]).toBeInstanceOf(SeqStep);
    expect(txn.steps[0].field).toBe("rows");
    expect(txn.steps[0].key).toBe("b");
  });

  test("toTransactionPath is a no-op for paths without a DynStep", () => {
    const p = new Path([new FieldStep("a"), new SeqStep("b", "k")]);
    expect(p.toTransactionPath()).toBe(p);
  });

  test("a bubbling event visits the intermediate components, then the producer", () => {
    const visited = [];
    const Sheet = component({
      name: "Sheet",
      fields: { title: "untitled" },
      input: {
        ping(ctx) {
          ctx.bubble("ping");
          return this;
        },
      },
      view: html`<button class="ping" @on.click="ping">x</button>`,
    });
    const mkBubble = (name) => ({
      ping() {
        visited.push(name);
        return this;
      },
    });
    const Toolbar = component({
      name: "Toolbar",
      fields: {},
      lookup: { active: { for: "Workspace.active", default: ".missing" } },
      bubble: mkBubble("Toolbar"),
      view: html`<div class="toolbar"><x render="*active"></x></div>`,
    });
    const Panel = component({
      name: "Panel",
      fields: { toolbar: null },
      bubble: mkBubble("Panel"),
      view: html`<div class="panel"><x render=".toolbar"></x></div>`,
    });
    const Workspace = component({
      name: "Workspace",
      fields: { sheet: null, panel: null },
      provide: { active: ".sheet" },
      bubble: mkBubble("Workspace"),
      view: html`<div class="workspace"><x render=".panel"></x></div>`,
    });
    const root = Workspace.make({
      sheet: Sheet.make(),
      panel: Panel.make({ toolbar: Toolbar.make() }),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Workspace, Panel, Toolbar, Sheet],
      null,
      root,
      HeadlessParseContext,
    );
    container.querySelector(".ping").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    // The dispatch path keeps every crossed component, so the bubble visits the
    // intermediate Toolbar and Panel before reaching the producer Workspace.
    expect(visited).toEqual(["Toolbar", "Panel", "Workspace"]);
    cleanup();
  });

  test("a seq-access dynamic (.a[.b]) teleports to the producer's keyed item", () => {
    const Sheet = component({
      name: "Sheet",
      fields: { title: "untitled" },
      input: {
        rename() {
          return this.setTitle("renamed");
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });
    const Toolbar = component({
      name: "Toolbar",
      fields: {},
      lookup: { active: { for: "Workspace.active", default: ".missing" } },
      view: html`<div class="toolbar"><x render="*active"></x></div>`,
    });
    const Workspace = component({
      name: "Workspace",
      fields: { sheets: IMap(), selId: "", toolbar: null },
      provide: { active: ".sheets[.selId]" },
      view: html`<div class="workspace"><x render=".toolbar"></x></div>`,
    });
    const root = Workspace.make({
      sheets: IMap({ a: Sheet.make({ title: "a" }), b: Sheet.make({ title: "b" }) }),
      selId: "b",
      toolbar: Toolbar.make(),
    });
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Workspace, Toolbar, Sheet],
      null,
      root,
      HeadlessParseContext,
    );
    const [path] = Path.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    const txn = path.toTransactionPath();
    // Teleports straight to the producer's `.sheets[.selId]` seq-access.
    expect(txn.steps.length).toBe(1);
    expect(txn.steps[0].seqField).toBe("sheets");
    expect(txn.steps[0].keyField).toBe("selId");
    expect(txn.lookup(app.state.val)).toBe(app.state.val.sheets.get("b"));
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.sheets.get("b").title).toBe("renamed");
    expect(app.state.val.sheets.get("a").title).toBe("a");
    cleanup();
  });

  test("pinKeys freezes a SeqAccessStep's key into a literal SeqStep", () => {
    const root = IMap({ sheets: IMap({ a: 1, b: 2 }), selId: "b" });
    const path = new Path([new SeqAccessStep("sheets", "selId")]);
    const pinned = path.pinKeys(root);
    expect(pinned).not.toBe(path);
    expect(pinned.steps[0]).toBeInstanceOf(SeqStep);
    expect(pinned.steps[0].field).toBe("sheets");
    expect(pinned.steps[0].key).toBe("b");
    // Frozen: a later key change no longer moves where the pinned path resolves.
    expect(pinned.lookup(root.set("selId", "a"))).toBe(2);
  });

  test("pinKeys returns the same Path when there is nothing to pin", () => {
    const root = IMap({ a: IMap({ b: 1 }) });
    const path = new Path([new FieldStep("a"), new FieldStep("b")]);
    expect(path.pinKeys(root)).toBe(path);
  });

  test("two components rendering the same *items sequence do not alias in the cache", () => {
    const Entry = component({
      name: "Entry",
      fields: { name: "" },
      view: html`<span class="entry" @text=".name"></span>`,
    });
    const Child = component({
      name: "Child",
      fields: {},
      lookup: { items: { for: "Owner.items", default: ".missing" } },
      view: html`<div class="child">
        <div @each="*items" class="child-row"><x render-it></x></div>
      </div>`,
    });
    const Owner = component({
      name: "Owner",
      fields: { items: IMap(), child: null, picked: "" },
      provide: { items: ".items" },
      input: {
        pick(k) {
          return this.setPicked(k);
        },
      },
      view: html`<div class="owner">
        <div @each="*items" class="owner-row">
          <x render-it></x>
          <button class="pick" :data-k="@key" @on.click="pick @key">pick</button>
        </div>
        <x render=".child"></x>
      </div>`,
    });
    const root = Owner.make({
      items: IMap({ a: Entry.make({ name: "A" }), b: Entry.make({ name: "B" }) }),
      child: Child.make(),
    });
    // Render with the DOM cache ON (the bug only surfaces with caching): the
    // owner and child both iterate the *same* `*items` values, and per-view node
    // ids collide, so the child's @each used to alias the owner's rows.
    const { container, app, cleanup } = renderToHTMLNode(
      document,
      [Owner, Child, Entry],
      null,
      root,
      HeadlessParseContext,
      { noCache: false },
    );
    expect(container.querySelectorAll(".owner > .owner-row").length).toBe(2);
    expect(container.querySelectorAll(".child .child-row").length).toBe(2);
    // The child list must NOT inherit the owner's select buttons.
    expect(container.querySelectorAll(".child .pick").length).toBe(0);
    // Reconstructing an event path from a child entry must not crash.
    const childEntry = container.querySelector(".child .entry");
    expect(() =>
      Path.fromNodeAndEventName(childEntry, "click", container, Infinity, app.comps, false),
    ).not.toThrow();
    // The owner's own select button still works.
    container.querySelector('.owner > .owner-row .pick[data-k="b"]').click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.picked).toBe("b");
    cleanup();
  });
});

describe("passthrough component (bare <x render> as the whole view)", () => {
  // A component whose view is just `<x render=".child">` produces no DOM
  // element of its own to carry `data-cid`; its boundary is recorded only in
  // the `Comp` meta comment. Path reconstruction must still cross it.
  function passthroughApp(parentView) {
    const Child = component({
      name: "Child",
      fields: { title: "untitled" },
      input: {
        rename() {
          return this.setTitle("renamed");
        },
      },
      view: html`<button class="rename" @on.click="rename">x</button>`,
    });
    const Parent = component({
      name: "Parent",
      fields: { child: null },
      view: parentView,
    });
    const root = Parent.make({ child: Child.make() });
    return renderToHTMLNode(document, [Parent, Child], null, root, HeadlessParseContext);
  }

  test("reconstructs the path through a bare-render parent", () => {
    const { container, app, cleanup } = passthroughApp(html`<x render=".child"></x>`);
    const [path] = Path.fromNodeAndEventName(
      container.querySelector(".rename"),
      "click",
      container,
      Infinity,
      app.comps,
    );
    expect(path.steps.length).toBe(1);
    expect(path.steps[0]).toBeInstanceOf(FieldStep);
    expect(path.steps[0].field).toBe("child");
    cleanup();
  });

  test("dispatch mutates the child through a bare-render parent", () => {
    const { container, app, cleanup } = passthroughApp(html`<x render=".child"></x>`);
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.child.title).toBe("renamed");
    cleanup();
  });

  test("still works when the parent wraps the child in an element", () => {
    const { container, app, cleanup } = passthroughApp(
      html`<div class="wrap"><x render=".child"></x></div>`,
    );
    container.querySelector(".rename").click();
    while (app.transactor.hasPendingTransactions) app.transactor.transactNext();
    expect(app.state.val.child.title).toBe("renamed");
    cleanup();
  });
});
